
const mongoose = require("mongoose");

const ExpressError = require("../../utils/ExpressError");

const {
    APP_USAGE_LIMITS,
} = require("../../config/usageLimits");

// ================== SCHEDULER CONFIGURATION ==================
function readPositiveInteger(name, fallback, maximum) {
    const rawValue = process.env[name];

    if (rawValue == null || rawValue.trim() === "") {
        return fallback;
    }

    const value = Number(rawValue);

    if (
        !Number.isSafeInteger(value) ||
        value < 1 ||
        value > maximum
    ) {
        throw new Error(`Invalid scheduler configuration: ${name}.`);
    }

    return value;
}

const MAX_ACTIVE_GENERATIONS = readPositiveInteger(
    "AI_MAX_CONCURRENT_GENERATIONS",
    3,
    25
);

const MAX_QUEUE_WAIT_MS = readPositiveInteger(
    "AI_QUEUE_TIMEOUT_MS",
    30000,
    300000
);

const MAX_ACTIVE_PER_USER =
    APP_USAGE_LIMITS.maxActiveGenerationsPerUser;

const MAX_QUEUED_REQUESTS =
    APP_USAGE_LIMITS.maxQueuedRequests;

if (
    !Number.isSafeInteger(MAX_ACTIVE_PER_USER) ||
    MAX_ACTIVE_PER_USER < 1 ||
    !Number.isSafeInteger(MAX_QUEUED_REQUESTS) ||
    MAX_QUEUED_REQUESTS < 1
) {
    throw new Error("Invalid application concurrency limits.");
}

// ================== SCHEDULER STATE ==================
let activeGenerations = 0;

const activeUsers = new Map();
const waitingQueue = [];

// ================== CANCELLATION ERROR ==================
function createAbortError() {
    const error = new Error("AI request cancelled.");
    error.name = "AbortError";

    return error;
}

// ================== CHECK AVAILABLE SLOT ==================
function canStartRequest(userKey) {
    const userActiveCount = activeUsers.get(userKey) || 0;

    return (
        activeGenerations < MAX_ACTIVE_GENERATIONS &&
        userActiveCount < MAX_ACTIVE_PER_USER
    );
}

// ================== ALLOCATE SLOT ==================
function allocateSlot(userKey) {
    activeGenerations += 1;

    activeUsers.set(
        userKey,
        (activeUsers.get(userKey) || 0) + 1
    );
}

// ================== CLEANUP QUEUED REQUEST ==================
function cleanupQueuedRequest(request) {
    if (request.timeout) {
        clearTimeout(request.timeout);
        request.timeout = null;
    }

    if (request.signal && request.onAbort) {
        request.signal.removeEventListener(
            "abort",
            request.onAbort
        );
    }
}

// ================== CANCEL QUEUED REQUEST ==================
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

// ================== PROCESS WAITING QUEUE ==================
function processWaitingQueue() {
    let index = 0;

    while (
        activeGenerations < MAX_ACTIVE_GENERATIONS &&
        index < waitingQueue.length
    ) {
        const request = waitingQueue[index];

        // ================== CANCELLED REQUEST ==================
        if (request.signal?.aborted) {
            waitingQueue.splice(index, 1);

            request.state = "cancelled";

            cleanupQueuedRequest(request);
            request.reject(createAbortError());

            continue;
        }

        // ================== USER CONCURRENCY ==================
        if (!canStartRequest(request.userKey)) {
            index += 1;
            continue;
        }

        // ================== START REQUEST ==================
        waitingQueue.splice(index, 1);

        request.state = "running";

        cleanupQueuedRequest(request);
        allocateSlot(request.userKey);

        request.resolve();

        // Recheck the queue from the beginning.
        index = 0;
    }
}

// ================== ACQUIRE EXECUTION SLOT ==================
function acquireSlot({
    userKey,
    signal,
    onQueued,
}) {
    if (signal?.aborted) {
        throw createAbortError();
    }

    // ================== PROCESS EXISTING QUEUE ==================
    processWaitingQueue();

    // ================== IMMEDIATE EXECUTION ==================
    if (canStartRequest(userKey)) {
        allocateSlot(userKey);
        return Promise.resolve();
    }

    // ================== QUEUE CAPACITY ==================
    if (waitingQueue.length >= MAX_QUEUED_REQUESTS) {
        throw new ExpressError(
            429,
            "AI request queue is full. Please try again later."
        );
    }

    // ================== WAIT FOR AVAILABLE SLOT ==================
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

        // ================== ABORT LISTENER ==================
        request.onAbort = () => {
            cancelQueuedRequest(
                request,
                createAbortError()
            );
        };

        waitingQueue.push(request);

        if (signal) {
            signal.addEventListener(
                "abort",
                request.onAbort,
                { once: true }
            );
        }

        // ================== QUEUE TIMEOUT ==================
        request.timeout = setTimeout(() => {
            cancelQueuedRequest(
                request,
                new ExpressError(
                    503,
                    "AI request timed out while waiting. Please retry."
                )
            );
        }, MAX_QUEUE_WAIT_MS);

        // ================== CHECK CANCELLATION ==================
        if (signal?.aborted) {
            request.onAbort();
            return;
        }

        // ================== QUEUE NOTIFICATION ==================
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

// ================== RELEASE EXECUTION SLOT ==================
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

// ================== SCHEDULE AI REQUEST ==================
async function scheduleAIRequest({
    userId,
    execute,
    signal,
    onQueued,
} = {}) {
    // ================== VALIDATE USER ==================
    if (!mongoose.isValidObjectId(userId)) {
        throw new ExpressError(400, "Invalid user ID.");
    }

    // ================== VALIDATE CALLBACK ==================
    if (typeof execute !== "function") {
        throw new Error("AI execution callback is required.");
    }

    if (
        onQueued !== undefined &&
        typeof onQueued !== "function"
    ) {
        throw new Error("Invalid queue notification callback.");
    }

    const userKey = String(userId).toLowerCase();

    // ================== WAIT FOR SLOT ==================
    await acquireSlot({
        userKey,
        signal,
        onQueued,
    });

    try {
        // ================== CHECK CANCELLATION ==================
        if (signal?.aborted) {
            throw createAbortError();
        }

        // ================== EXECUTE AI REQUEST ==================
        // The callback must handle provider quota reservation,
        // streaming and cancellation using the supplied signal.
        return await execute({ signal });

    } finally {
        // ================== ALWAYS RELEASE SLOT ==================
        releaseSlot(userKey);
    }
}

// ================== SCHEDULER STATUS ==================
function getSchedulerStatus() {
    return {
        activeGenerations,
        queuedRequests: waitingQueue.length,
        maxActiveGenerations: MAX_ACTIVE_GENERATIONS,
        maxQueuedRequests: MAX_QUEUED_REQUESTS,
    };
}

// ================== EXPORTS ==================
module.exports = {
    scheduleAIRequest,
    getSchedulerStatus,
};
