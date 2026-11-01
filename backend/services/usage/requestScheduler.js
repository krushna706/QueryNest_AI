const mongoose = require("mongoose");

const ExpressError = require("../../utils/ExpressError");

const { APP_USAGE_LIMITS } = require("../../config/usageLimits");

// Scheduler configuration
function readPositiveInteger(name, fallback, maximum) {
    const rawValue = process.env[name];

    if (rawValue == null || rawValue.trim() === "") {
        return fallback;
    }

    const value = Number(rawValue);

    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
        throw new Error(`Invalid scheduler configuration: ${name}.`);
    }

    return value;
}

const MAX_ACTIVE_GENERATIONS = readPositiveInteger("AI_MAX_CONCURRENT_GENERATIONS", 3, 25);

const MAX_QUEUE_WAIT_MS = readPositiveInteger("AI_QUEUE_TIMEOUT_MS", 30000, 300000);

const MAX_ACTIVE_PER_USER = APP_USAGE_LIMITS.maxActiveGenerationsPerUser;

const MAX_QUEUED_REQUESTS = APP_USAGE_LIMITS.maxQueuedRequests;

if (
    !Number.isSafeInteger(MAX_ACTIVE_PER_USER) ||
    MAX_ACTIVE_PER_USER < 1 ||
    !Number.isSafeInteger(MAX_QUEUED_REQUESTS) ||
    MAX_QUEUED_REQUESTS < 1
) {
    throw new Error("Invalid application concurrency limits.");
}

// Scheduler state
let activeGenerations = 0;

const activeUsers = new Map();
const waitingQueue = [];

// Cancellation error
function createAbortError() {
    const error = new Error("AI request cancelled.");
    error.name = "AbortError";

    return error;
}

// Check available slot
function canStartRequest(userKey) {
    const userActiveCount = activeUsers.get(userKey) || 0;

    return activeGenerations < MAX_ACTIVE_GENERATIONS && userActiveCount < MAX_ACTIVE_PER_USER;
}

// Allocate slot
function allocateSlot(userKey) {
    activeGenerations += 1;

    activeUsers.set(userKey, (activeUsers.get(userKey) || 0) + 1);
}

// Cleanup queued request
function cleanupQueuedRequest(request) {
    if (request.timeout) {
        clearTimeout(request.timeout);
        request.timeout = null;
    }

    if (request.signal && request.onAbort) {
        request.signal.removeEventListener("abort", request.onAbort);
    }
}

// Cancel queued request
function cancelQueuedRequest(request, error) {
    if (request.state !== "waiting") {
        return;
    }

    const index = waitingQueue.indexOf(request);

    if (index !== -1) {
        waitingQueue.splice(index, 1);
    }

    request.state = "cancelled";

    cleanupQueuedRequest(request);
    request.reject(error);

    processWaitingQueue();
}

// Process waiting queue
function processWaitingQueue() {
    let index = 0;

    while (activeGenerations < MAX_ACTIVE_GENERATIONS && index < waitingQueue.length) {
        const request = waitingQueue[index];

        if (request.signal?.aborted) {
            waitingQueue.splice(index, 1);

            request.state = "cancelled";

            cleanupQueuedRequest(request);
            request.reject(createAbortError());

            continue;
        }

        if (!canStartRequest(request.userKey)) {
            index += 1;
            continue;
        }

        waitingQueue.splice(index, 1);

        request.state = "running";

        cleanupQueuedRequest(request);
        allocateSlot(request.userKey);

        request.resolve();

        // Recheck the queue from the beginning.
        index = 0;
    }
}

// Acquire execution slot
function acquireSlot({ userKey, signal, onQueued }) {
    if (signal?.aborted) {
        throw createAbortError();
    }

    processWaitingQueue();

    if (canStartRequest(userKey)) {
        allocateSlot(userKey);
        return Promise.resolve();
    }

    if (waitingQueue.length >= MAX_QUEUED_REQUESTS) {
        throw new ExpressError(429, "AI request queue is full. Please try again later.");
    }

    return new Promise((resolve, reject) => {
        const request = {
            userKey,
            signal,
            resolve,
            reject,
            state: "waiting",
            timeout: null,
            onAbort: null,
        };

        request.onAbort = () => {
            cancelQueuedRequest(request, createAbortError());
        };

        waitingQueue.push(request);

        if (signal) {
            signal.addEventListener("abort", request.onAbort, { once: true });
        }

        request.timeout = setTimeout(() => {
            cancelQueuedRequest(request, new ExpressError(503, "AI request timed out while waiting. Please retry."));
        }, MAX_QUEUE_WAIT_MS);

        if (signal?.aborted) {
            request.onAbort();
            return;
        }

        if (typeof onQueued === "function") {
            try {
                onQueued({
                    position: waitingQueue.length,
                });
            } catch (error) {
                cancelQueuedRequest(request, error);
                return;
            }
        }

        processWaitingQueue();
    });
}

// Release execution slot
function releaseSlot(userKey) {
    const activeCount = activeUsers.get(userKey) || 0;

    if (activeCount < 1) {
        return;
    }

    if (activeCount === 1) {
        activeUsers.delete(userKey);
    } else {
        activeUsers.set(userKey, activeCount - 1);
    }

    activeGenerations -= 1;

    // Allow the next eligible request to start.
    processWaitingQueue();
}

// Schedule ai request
async function scheduleAIRequest({ userId, execute, signal, onQueued } = {}) {
    if (!mongoose.isValidObjectId(userId)) {
        throw new ExpressError(400, "Invalid user ID.");
    }

    if (typeof execute !== "function") {
        throw new Error("AI execution callback is required.");
    }

    if (onQueued !== undefined && typeof onQueued !== "function") {
        throw new Error("Invalid queue notification callback.");
    }

    const userKey = String(userId).toLowerCase();

    await acquireSlot({
        userKey,
        signal,
        onQueued,
    });

    try {
        if (signal?.aborted) {
            throw createAbortError();
        }

        // The callback must handle provider quota reservation,
        // streaming and cancellation using the supplied signal.
        return await execute({ signal });
    } finally {
        releaseSlot(userKey);
    }
}

// Scheduler status
function getSchedulerStatus() {
    return {
        activeGenerations,
        queuedRequests: waitingQueue.length,
        maxActiveGenerations: MAX_ACTIVE_GENERATIONS,
        maxQueuedRequests: MAX_QUEUED_REQUESTS,
    };
}

// Exports
module.exports = {
    scheduleAIRequest,
    getSchedulerStatus,
};
