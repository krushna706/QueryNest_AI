// Stream configuration
const DEFAULT_HEARTBEAT_MS = 15000;
const EVENT_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

// Abort error
function createAbortError() {
    const error = new Error("AI stream connection closed.");
    error.name = "AbortError";

    return error;
}

// Create sse stream
function createStreamResponse(req, res, { heartbeatMs = DEFAULT_HEARTBEAT_MS } = {}) {
    if (!req || !res || res.headersSent) {
        throw new Error("Cannot initialize AI stream response.");
    }

    if (!Number.isInteger(heartbeatMs) || heartbeatMs < 0 || (heartbeatMs > 0 && heartbeatMs < 1000)) {
        throw new Error("Invalid SSE heartbeat interval.");
    }

    // Initialize only after authentication,
    // validation and usage checks are complete.
    res.status(200);

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");

    res.setHeader("Cache-Control", "no-cache, no-transform");

    res.setHeader("X-Accel-Buffering", "no");

    res.flushHeaders();

    const abortController = new AbortController();

    let ended = false;
    let heartbeat = null;

    function cleanup() {
        if (heartbeat) {
            clearInterval(heartbeat);
            heartbeat = null;
        }

        req.off("aborted", onDisconnect);
        res.off("close", onDisconnect);
        res.off("error", onDisconnect);
    }

    function onDisconnect() {
        if (ended) return;

        ended = true;

        cleanup();
        abortController.abort();
    }

    req.once("aborted", onDisconnect);
    res.once("close", onDisconnect);
    res.once("error", onDisconnect);

    function waitForDrain() {
        return new Promise((resolve, reject) => {
            function removeListeners() {
                res.off("drain", onDrain);
                res.off("close", onClose);
                res.off("error", onError);

                abortController.signal.removeEventListener("abort", onClose);
            }

            function onDrain() {
                removeListeners();
                resolve();
            }

            function onClose() {
                removeListeners();
                reject(createAbortError());
            }

            function onError(error) {
                removeListeners();
                reject(error);
            }

            res.once("drain", onDrain);
            res.once("close", onClose);
            res.once("error", onError);

            abortController.signal.addEventListener("abort", onClose, { once: true });

            if (ended || res.destroyed || abortController.signal.aborted) {
                onClose();
            }
        });
    }

    async function send(event, payload) {
        if (!EVENT_NAME_PATTERN.test(event)) {
            throw new Error("Invalid SSE event name.");
        }

        if (ended || res.writableEnded || res.destroyed) {
            throw createAbortError();
        }

        const data = JSON.stringify(payload);

        if (data === undefined) {
            throw new Error("SSE payload must be JSON serializable.");
        }

        const ready = res.write(`event: ${event}\ndata: ${data}\n\n`);

        if (!ready) {
            await waitForDrain();
        }
    }

    if (heartbeatMs > 0) {
        heartbeat = setInterval(() => {
            if (ended || res.writableEnded || res.destroyed || res.writableNeedDrain) {
                return;
            }

            try {
                res.write(": heartbeat\n\n");
            } catch {
                onDisconnect();
            }
        }, heartbeatMs);

        heartbeat.unref?.();
    }

    function end() {
        if (ended) return;

        ended = true;

        cleanup();

        if (!res.writableEnded && !res.destroyed) {
            res.end();
        }
    }

    return {
        signal: abortController.signal,
        send,
        end,
        isClosed: () => ended,
    };
}

// Export
module.exports = {
    createStreamResponse,
};
