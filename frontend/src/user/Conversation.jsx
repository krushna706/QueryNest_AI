import { DOCUMENT_LIMITS } from "../config/appConfig";
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import { toast } from "react-toastify";

import MessageComposer from "../components/chat/MessageComposer";
import MessageList from "../components/chat/MessageList";

import {
    generateChatRequestId,
    generateAIResponse,
    getConversation,
    getMessageHistory,
    sendMessage,
} from "../services/chatService";

import { uploadDocuments, getDocuments } from "../services/documentService";

// Configuration
const MESSAGE_LIMIT = 20;
const MAX_DOCUMENTS = DOCUMENT_LIMITS.maxFiles;

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

const RETRYABLE_STATUSES = new Set(["failed", "stopped", "incomplete"]);

// Cancelled request
function isCancelledRequest(error) {
    return error?.name === "AbortError" || error?.name === "CanceledError" || error?.code === "ERR_CANCELED";
}

// Retry wait time
function getRetryWait(error) {
    const data = error?.response?.data;

    const seconds = Number(data?.retryAfterSeconds ?? data?.retryAfter ?? error?.response?.headers?.["retry-after"]);

    if (!Number.isFinite(seconds) || seconds <= 0) {
        return "";
    }

    if (seconds < 60) {
        return ` Please try again in ${Math.ceil(seconds)} seconds.`;
    }

    return ` Please try again in ${Math.ceil(seconds / 60)} minutes.`;
}

// User friendly error
function getFriendlyError(error, fallback) {
    const status = error?.response?.status;

    const code = String(error?.response?.data?.code || error?.code || "").toUpperCase();

    const details = String(error?.response?.data?.message || error?.message || "").toLowerCase();

    const retryWait = getRetryWait(error);

    if (
        [
            "CHAT_READ_RATE_LIMIT",
            "CHAT_WRITE_RATE_LIMIT",
            "CHAT_DAILY_WRITE_LIMIT",
            "DOCUMENT_UPLOAD_RATE_LIMIT",
        ].includes(code)
    ) {
        return (error.response?.data?.message || fallback) + retryWait;
    }

    if (status === 401 || code === "SESSION_EXPIRED") {
        return "Your session has expired. Please log in again.";
    }

    if (status === 403) {
        return "You don't have permission to perform this action.";
    }

    if (status === 404) {
        return "This conversation or document is no longer available.";
    }

    if (
        code === "USER_DAILY_LIMIT" ||
        code === "DAILY_REQUEST_LIMIT" ||
        (details.includes("daily") && details.includes("limit"))
    ) {
        return "You've reached your daily AI request limit." + retryWait;
    }

    if (
        code === "USER_MINUTE_LIMIT" ||
        code === "MINUTE_REQUEST_LIMIT" ||
        (details.includes("per minute") && details.includes("limit"))
    ) {
        return "You're sending requests too quickly." + (retryWait || " Please try again shortly.");
    }

    if (
        code === "PROVIDER_QUOTA_EXCEEDED" ||
        code === "PROVIDER_TOKEN_LIMIT" ||
        (details.includes("token") && (details.includes("quota") || details.includes("limit")))
    ) {
        return "The AI service has reached its token or usage limit." + (retryWait || " Please try again later.");
    }

    if (code === "PROVIDER_RATE_LIMIT" || (details.includes("provider") && details.includes("rate limit"))) {
        return "The AI service is receiving too many requests." + (retryWait || " Please try again shortly.");
    }

    if (
        code === "DOCUMENT_LIMIT" ||
        code === "MAX_DOCUMENTS_EXCEEDED" ||
        details.includes("maximum 3") ||
        details.includes("supported document limit") ||
        details.includes("up to 3 documents")
    ) {
        return "You can upload up to 3 documents per chat. Start a new chat to upload more.";
    }

    if (code === "FILE_TOO_LARGE" || (details.includes("file") && details.includes("5 mb"))) {
        return "Each document must be smaller than 5 MB.";
    }

    if (status === 413) {
        return "This document or request is too large. Please try a smaller one.";
    }

    if (status === 415 || code === "UNSUPPORTED_FILE_TYPE" || details.includes("unsupported file")) {
        return "Please upload a valid PDF or Word document.";
    }

    if (
        code === "DOCUMENT_EXTRACTION_FAILED" ||
        details.includes("no readable text") ||
        details.includes("could not extract") ||
        details.includes("no relevant text")
    ) {
        return "We couldn't read enough information from your document. Try another file or a more specific question.";
    }

    if (
        code === "REQUEST_TIMEOUT" ||
        code === "ECONNABORTED" ||
        details.includes("timed out") ||
        details.includes("timeout")
    ) {
        return "Your request took too long. Please try again.";
    }

    if (
        code === "ERR_NETWORK" ||
        details.includes("failed to fetch") ||
        details.includes("network error") ||
        (typeof navigator !== "undefined" && navigator.onLine === false)
    ) {
        return "Connection lost. Please check your internet and try again.";
    }

    if (details.includes("already in progress") || details.includes("response already exists")) {
        return "This response is already being generated or has been completed.";
    }

    if (["STREAM_INTERRUPTED", "INVALID_STREAM_RESPONSE", "STREAM_UNAVAILABLE"].includes(code)) {
        return "The AI response was interrupted. Please try again.";
    }

    if (["REQUEST_REJECTED", "GENERATION_CONFLICT"].includes(code) && status >= 400 && status < 500) {
        const serverMessage = error?.response?.data?.message;

        if (typeof serverMessage === "string" && serverMessage.trim() && serverMessage.length <= 250) {
            return serverMessage.trim();
        }

        return "This request couldn't be completed. Please refresh the conversation and try again.";
    }

    if (status === 409) {
        return "The response state has changed. Please refresh the conversation and try again.";
    }

    if (status === 429) {
        return "Too many requests right now." + (retryWait || " Please try again later.");
    }

    if (status >= 500) {
        return "The AI service is temporarily unavailable. Please try again.";
    }

    return fallback;
}

// Toast helpers
function showError(message) {
    toast.error(message, {
        toastId: `chat-error:${message}`,
    });
}

function showInfo(message) {
    toast.info(message, {
        toastId: `chat-info:${message}`,
    });
}

// Hide citation markers
function removeCitationMarkers(content) {
    if (typeof content !== "string") {
        return "";
    }

    return content.replace(/\s*\[(?:S\d+)(?:\s*[,;]\s*S\d+)*\]/gi, "").replace(/[ \t]+([,.!?;:])/g, "$1");
}

// Conversation
function Conversation() {
    const { conversationId } = useParams();

    const location = useLocation();
    const navigate = useNavigate();

    const [conversation, setConversation] = useState(null);
    const [messages, setMessages] = useState([]);

    const [message, setMessage] = useState("");
    const [attachments, setAttachments] = useState([]);

    const [documentCount, setDocumentCount] = useState(null);
    const [uploadProgress, setUploadProgress] = useState(null);

    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [sending, setSending] = useState(false);

    const [queuePosition, setQueuePosition] = useState(null);
    const [error, setError] = useState("");

    const [hasMore, setHasMore] = useState(false);
    const [nextCursor, setNextCursor] = useState(null);
    const [reloadKey, setReloadKey] = useState(0);

    const messagesRef = useRef(null);
    const inputRef = useRef(null);

    const requestIdRef = useRef(null);
    const pendingUploadRef = useRef(null);

    const busyRef = useRef(false);

    const streamControllerRef = useRef(null);
    const uploadControllerRef = useRef(null);

    const autoStartedRef = useRef(null);

    const scrollToBottomRef = useRef(true);
    const restoreScrollRef = useRef(null);

    const conversationIdRef = useRef(conversationId);

    useEffect(() => {
        conversationIdRef.current = conversationId;

        return () => {
            uploadControllerRef.current?.abort();
            streamControllerRef.current?.abort();

            uploadControllerRef.current = null;
            streamControllerRef.current = null;

            busyRef.current = false;
        };
    }, [conversationId]);

    useEffect(() => {
        let active = true;

        async function loadConversation() {
            setLoading(true);
            setError("");
            setConversation(null);
            setMessages([]);

            setDocumentCount(null);
            setHasMore(false);
            setNextCursor(null);
            setQueuePosition(null);
            setSending(false);

            scrollToBottomRef.current = true;
            restoreScrollRef.current = null;

            try {
                const [conversationResponse, messageResponse, documentResponse] = await Promise.all([
                    getConversation(conversationId),

                    getMessageHistory(conversationId, {
                        limit: MESSAGE_LIMIT,
                    }),

                    getDocuments(conversationId).catch(() => null),
                ]);

                if (!active) return;

                setConversation(conversationResponse.conversation);

                setMessages(messageResponse.messages || []);

                setHasMore(Boolean(messageResponse.pagination?.hasMore));

                setNextCursor(messageResponse.pagination?.nextCursor || null);

                if (Array.isArray(documentResponse?.documents)) {
                    setDocumentCount(documentResponse.documents.length);
                } else {
                    setDocumentCount(null);

                    showInfo("We couldn't check your uploaded files. You can still continue chatting.");
                }
            } catch (loadError) {
                if (!active) return;

                const friendlyMessage = getFriendlyError(
                    loadError,
                    "Couldn't open this conversation. Please try again."
                );

                setError(friendlyMessage);
                showError(friendlyMessage);
            } finally {
                if (active) {
                    setLoading(false);
                }
            }
        }

        void loadConversation();

        return () => {
            active = false;
        };
    }, [conversationId, reloadKey]);

    useEffect(() => {
        setMessage("");
        setAttachments([]);
        setUploadProgress(null);

        requestIdRef.current = null;
        pendingUploadRef.current = null;
        autoStartedRef.current = null;
    }, [conversationId]);

    const visibleMessages = useMemo(() => {
        return messages.map((item) => {
            if (item.role !== "assistant") {
                return item;
            }

            return {
                ...item,
                content: removeCitationMarkers(item.content),
                sources: [],
            };
        });
    }, [messages]);

    useLayoutEffect(() => {
        const container = messagesRef.current;

        if (!container) return;

        if (restoreScrollRef.current) {
            const { height, top } = restoreScrollRef.current;

            container.scrollTop = container.scrollHeight - height + top;

            restoreScrollRef.current = null;
            return;
        }

        if (scrollToBottomRef.current) {
            container.scrollTop = container.scrollHeight;
            scrollToBottomRef.current = false;
        }
    }, [messages]);

    function markScrollIfNearBottom() {
        const container = messagesRef.current;

        scrollToBottomRef.current =
            !container || container.scrollHeight - container.scrollTop - container.clientHeight < 110;
    }

    async function handleLoadMore() {
        if (!hasMore || !nextCursor || loadingMore || loading) {
            return;
        }

        const activeConversationId = conversationId;

        setLoadingMore(true);

        try {
            const response = await getMessageHistory(activeConversationId, {
                before: nextCursor,
                limit: MESSAGE_LIMIT,
            });

            if (conversationIdRef.current !== activeConversationId) {
                return;
            }

            const olderMessages = response.messages || [];
            const container = messagesRef.current;

            if (olderMessages.length && container) {
                restoreScrollRef.current = {
                    height: container.scrollHeight,
                    top: container.scrollTop,
                };
            }

            setMessages((current) => {
                const existingIds = new Set(current.map((item) => item._id));

                const uniqueMessages = olderMessages.filter((item) => !existingIds.has(item._id));

                return [...uniqueMessages, ...current];
            });

            setHasMore(Boolean(response.pagination?.hasMore));

            setNextCursor(response.pagination?.nextCursor || null);
        } catch (loadError) {
            if (conversationIdRef.current === activeConversationId) {
                showError(getFriendlyError(loadError, "Couldn't load earlier messages. Please try again."));
            }
        } finally {
            if (conversationIdRef.current === activeConversationId) {
                setLoadingMore(false);
            }
        }
    }

    async function runAIStream(userMessageId, { regenerate = false } = {}) {
        const controller = new AbortController();
        const activeConversationId = conversationId;

        streamControllerRef.current = controller;

        let assistantMessageId = null;
        let assistantHasContent = false;
        let finished = false;

        setQueuePosition(null);

        try {
            await generateAIResponse(activeConversationId, userMessageId, {
                signal: controller.signal,
                regenerate,

                onEvent: ({ type, data }) => {
                    if (controller.signal.aborted || conversationIdRef.current !== activeConversationId) {
                        return;
                    }

                    if (type === "queued") {
                        setQueuePosition(data?.position || 1);
                        return;
                    }

                    if (type === "start" && data?.messageId) {
                        assistantMessageId = data.messageId;
                        setQueuePosition(null);

                        markScrollIfNearBottom();

                        setMessages((current) => {
                            if (current.some((item) => item._id === data.messageId)) {
                                return current;
                            }

                            return [
                                ...current,
                                {
                                    _id: data.messageId,

                                    conversationId: activeConversationId,

                                    replyToMessageId: userMessageId,

                                    role: "assistant",
                                    content: "",
                                    status: "queued",

                                    provider: null,
                                    model: null,
                                    sources: [],

                                    createdAt: new Date().toISOString(),
                                },
                            ];
                        });

                        return;
                    }

                    if (type === "provider" && assistantMessageId) {
                        setMessages((current) =>
                            current.map((item) =>
                                item._id === assistantMessageId
                                    ? {
                                          ...item,
                                          provider: data?.provider || null,
                                          model: data?.model || null,
                                          status: "streaming",
                                      }
                                    : item
                            )
                        );

                        return;
                    }

                    if (type === "sources" && assistantMessageId) {
                        const sources = Array.isArray(data?.sources) ? data.sources : [];

                        setMessages((current) =>
                            current.map((item) =>
                                item._id === assistantMessageId
                                    ? {
                                          ...item,
                                          sources,
                                      }
                                    : item
                            )
                        );

                        return;
                    }

                    if (type === "delta" && assistantMessageId) {
                        const text = typeof data?.text === "string" ? data.text : "";

                        if (!text) return;

                        assistantHasContent = true;
                        markScrollIfNearBottom();

                        setMessages((current) =>
                            current.map((item) =>
                                item._id === assistantMessageId
                                    ? {
                                          ...item,
                                          content: item.content + text,
                                          status: "streaming",
                                      }
                                    : item
                            )
                        );

                        return;
                    }

                    if (type === "done" && assistantMessageId) {
                        finished = true;

                        setMessages((current) =>
                            current.map((item) =>
                                item._id === assistantMessageId
                                    ? {
                                          ...item,
                                          status: data?.status || "incomplete",

                                          provider: data?.provider || item.provider,

                                          model: data?.model || item.model,

                                          sources: Array.isArray(data?.sources) ? data.sources : item.sources || [],
                                      }
                                    : item
                            )
                        );
                    }
                },
            });
        } catch (streamError) {
            const stopped = controller.signal.aborted;

            if (assistantMessageId && conversationIdRef.current === activeConversationId) {
                setMessages((current) =>
                    current.map((item) =>
                        item._id === assistantMessageId && !finished
                            ? {
                                  ...item,
                                  status: stopped ? "stopped" : assistantHasContent ? "incomplete" : "failed",
                              }
                            : item
                    )
                );
            }

            if (!stopped && conversationIdRef.current === activeConversationId) {
                showError(
                    getFriendlyError(
                        streamError,
                        regenerate
                            ? "Couldn't regenerate the response. Please try again."
                            : "Couldn't generate a response. Please try again."
                    )
                );
            }
        } finally {
            if (streamControllerRef.current === controller) {
                streamControllerRef.current = null;
                setQueuePosition(null);
            }
        }
    }

    function handleMessageChange(event) {
        if (busyRef.current) return;

        setMessage(event.target.value);

        requestIdRef.current = null;
        pendingUploadRef.current = null;
    }

    function handleAttachmentsChange(files) {
        if (busyRef.current) return;

        setAttachments(files);

        requestIdRef.current = null;
        pendingUploadRef.current = null;
    }

    function handleStopRequest() {
        if (uploadControllerRef.current) {
            uploadControllerRef.current.abort();
            return;
        }

        streamControllerRef.current?.abort();
    }

    async function handleSubmit(event) {
        event.preventDefault();

        if (busyRef.current || loading || !conversation) {
            return;
        }

        const selectedFiles = [...attachments];

        const content = message.trim() || (selectedFiles.length ? "Please summarize the attached document(s)." : "");

        if (!content) return;

        if (selectedFiles.length && documentCount !== null && documentCount + selectedFiles.length > MAX_DOCUMENTS) {
            showError("You can upload up to 3 documents per chat. Start a new chat to upload more.");
            return;
        }

        const activeConversationId = conversationId;

        busyRef.current = true;
        setSending(true);

        try {
            if (!requestIdRef.current) {
                requestIdRef.current = generateChatRequestId();
            }

            const clientRequestId = requestIdRef.current;

            let messageAttachmentIds =
                pendingUploadRef.current?.content === content ? pendingUploadRef.current.documentIds : [];

            if (selectedFiles.length) {
                const controller = new AbortController();

                uploadControllerRef.current = controller;
                setUploadProgress(0);

                let uploaded;

                try {
                    uploaded = await uploadDocuments(selectedFiles, {
                        conversationId: activeConversationId,

                        signal: controller.signal,

                        onUploadProgress: (progress) => {
                            if (!controller.signal.aborted && conversationIdRef.current === activeConversationId) {
                                setUploadProgress(progress);
                            }
                        },
                    });
                } finally {
                    if (uploadControllerRef.current === controller) {
                        uploadControllerRef.current = null;
                    }

                    setUploadProgress(null);
                }

                if (conversationIdRef.current !== activeConversationId) {
                    return;
                }

                const newDocuments = uploaded?.documents || [];

                const newIds = newDocuments.map((document) => document._id);

                if (
                    newIds.length !== selectedFiles.length ||
                    newIds.some((id) => typeof id !== "string" || !OBJECT_ID_PATTERN.test(id)) ||
                    new Set(newIds).size !== newIds.length
                ) {
                    throw new Error("Uploaded document information is incomplete.");
                }

                messageAttachmentIds = newIds;

                pendingUploadRef.current = {
                    content,
                    documentIds: newIds,
                };

                setDocumentCount((current) => (current === null ? null : current + newIds.length));

                setAttachments([]);
                setMessage(content);
            }

            if (conversationIdRef.current !== activeConversationId) {
                return;
            }

            const response = await sendMessage(activeConversationId, content, clientRequestId, messageAttachmentIds);

            const savedMessage = response?.userMessage;

            if (!savedMessage?._id) {
                throw new Error("Saved message was not returned.");
            }

            if (conversationIdRef.current !== activeConversationId) {
                return;
            }

            scrollToBottomRef.current = true;

            setMessages((current) => {
                if (current.some((item) => item._id === savedMessage._id)) {
                    return current;
                }

                return [...current, savedMessage];
            });

            setMessage("");
            setAttachments([]);

            requestIdRef.current = null;
            pendingUploadRef.current = null;

            await runAIStream(savedMessage._id);
        } catch (sendError) {
            if (conversationIdRef.current === activeConversationId) {
                if (isCancelledRequest(sendError)) {
                    showInfo("Document upload cancelled.");
                } else {
                    showError(getFriendlyError(sendError, "Couldn't send your message. Please try again."));
                }
            }
        } finally {
            if (conversationIdRef.current === activeConversationId) {
                busyRef.current = false;
                setSending(false);

                inputRef.current?.focus();
            }
        }
    }

    async function handleGenerateSavedMessage(userMessageId, { regenerate = false } = {}) {
        if (busyRef.current || loading) return;

        busyRef.current = true;
        setSending(true);

        const activeConversationId = conversationId;

        try {
            await runAIStream(userMessageId, { regenerate });
        } finally {
            if (conversationIdRef.current === activeConversationId) {
                busyRef.current = false;
                setSending(false);

                inputRef.current?.focus();
            }
        }
    }

    function handleRegenerate(userMessageId) {
        void handleGenerateSavedMessage(userMessageId, { regenerate: true });
    }

    function handleRetry(userMessageId) {
        void handleGenerateSavedMessage(userMessageId, { regenerate: false });
    }

    const generatePendingMessage = useEffectEvent((messageId) => handleGenerateSavedMessage(messageId));

    useEffect(() => {
        const pendingId = location.state?.autoGenerateMessageId;

        if (!pendingId || loading || !conversation || error) {
            return;
        }

        const key = `${conversationId}:${pendingId}`;

        if (autoStartedRef.current === key) {
            return;
        }

        const latestUser = [...messages].reverse().find((item) => item.role === "user");

        if (!latestUser || latestUser._id !== pendingId) {
            return;
        }

        autoStartedRef.current = key;

        navigate(location.pathname, {
            replace: true,
            state: null,
        });

        const existingReply = messages.some(
            (item) =>
                item.role === "assistant" && item.replyToMessageId === pendingId && !RETRYABLE_STATUSES.has(item.status)
        );

        if (!existingReply) {
            void generatePendingMessage(pendingId);
        }
    }, [conversationId, conversation, error, loading, location.pathname, location.state, messages, navigate]);

    const lastUserMessage = [...messages].reverse().find((item) => item.role === "user");

    const lastReply = lastUserMessage
        ? [...messages]
              .reverse()
              .find((item) => item.role === "assistant" && item.replyToMessageId === lastUserMessage._id)
        : null;

    const canGenerateMissingReply = Boolean(lastUserMessage && !lastReply && !sending && !loading);

    if (loading) {
        return (
            <div className="conversation-feedback" role="status">
                <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />

                <p>Loading conversation...</p>
            </div>
        );
    }

    if (error || !conversation) {
        return (
            <div className="conversation-feedback">
                <i className="fa-regular fa-circle-xmark" aria-hidden="true" />

                <h2>Conversation unavailable</h2>

                <p>{error || "This conversation is unavailable."}</p>

                <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setReloadKey((current) => current + 1)}
                >
                    Try Again
                </button>

                <Link to="/chat" className="btn btn-link">
                    New Chat
                </Link>
            </div>
        );
    }

    return (
        <section className="conversation-page" aria-labelledby="conversation-title">
            <h1 id="conversation-title" className="visually-hidden">
                {conversation.title}
            </h1>
            <div
                ref={messagesRef}
                className="conversation-messages qn-conversation-scroll"
                role="log"
                aria-label="Conversation messages"
            >
                <div className="qn-conversation-content-width">
                    <MessageList
                        messages={visibleMessages}
                        hasMore={hasMore}
                        loadingMore={loadingMore}
                        onLoadMore={handleLoadMore}
                        onRegenerate={handleRegenerate}
                        onRetry={handleRetry}
                        actionsDisabled={sending || loading}
                    />
                    {canGenerateMissingReply && (
                        <div className="d-flex justify-content-start mt-3">
                            <button
                                type="button"
                                className="btn btn-sm btn-outline-secondary qn-conversation-generate-button"
                                onClick={() => handleGenerateSavedMessage(lastUserMessage._id)}
                            >
                                <i className="fa-solid fa-rotate-right me-2" aria-hidden="true" />
                                Generate Response
                            </button>
                        </div>
                    )}
                </div>
            </div>
            <div className="conversation-composer-wrap qn-conversation-composer-area">
                <div className="qn-conversation-composer-width">
                    {uploadProgress !== null && (
                        <div
                            className="d-flex align-items-center justify-content-between gap-3 mb-2 px-2"
                            role="status"
                            aria-live="polite"
                        >
                            <span className="small text-secondary">
                                {uploadProgress < 100 ? `Uploading: ${uploadProgress}%` : "Processing your document..."}
                            </span>

                            <button
                                type="button"
                                className="btn btn-sm btn-link text-secondary p-0"
                                onClick={handleStopRequest}
                            >
                                Cancel
                            </button>
                        </div>
                    )}
                    {sending && uploadProgress === null && (
                        <div className="d-flex justify-content-center mb-2" role="status">
                            {queuePosition && (
                                <span className="small text-secondary me-3">Waiting in queue: {queuePosition}</span>
                            )}

                            {streamControllerRef.current && (
                                <button
                                    type="button"
                                    className="btn btn-sm btn-outline-secondary"
                                    onClick={handleStopRequest}
                                >
                                    <i className="fa-solid fa-stop me-1" aria-hidden="true" />
                                    Stop Generating
                                </button>
                            )}
                        </div>
                    )}
                    <MessageComposer
                        inputId="conversation-message"
                        inputRef={inputRef}
                        value={message}
                        onChange={handleMessageChange}
                        attachments={attachments}
                        onAttachmentsChange={handleAttachmentsChange}
                        onSubmit={handleSubmit}
                        placeholder="Message QueryNest AI..."
                        sending={sending}
                    />
                    <p className="chat-dashboard-note qn-conversation-disclaimer">
                        QueryNest AI can make mistakes. Verify important information.
                    </p>
                </div>
            </div>
        </section>
    );
}

export default Conversation;
