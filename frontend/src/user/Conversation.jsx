
import {
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from "react";

import {
    Link,
    useLocation,
    useNavigate,
    useParams,
} from "react-router-dom";

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

// ================== CONFIGURATION ==================
const MESSAGE_LIMIT = 20;

const RETRYABLE_STATUSES = new Set([
    "failed",
    "stopped",
    "incomplete",
]);

// ================== ERROR MESSAGE ==================
function getErrorMessage(error, fallback) {
    return (
        error?.response?.data?.message ||
        error?.message ||
        fallback
    );
}

// ================== CONVERSATION ==================
function Conversation() {
    const { conversationId } = useParams();
    const location = useLocation();
    const navigate = useNavigate();

    // ================== CONVERSATION STATE ==================
    const [conversation, setConversation] = useState(null);
    const [messages, setMessages] = useState([]);
    const [message, setMessage] = useState("");
    const [attachments, setAttachments] = useState([]);

    // ================== REQUEST STATE ==================
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [sending, setSending] = useState(false);
    const [queuePosition, setQueuePosition] = useState(null);
    const [error, setError] = useState("");

    // ================== PAGINATION STATE ==================
    const [hasMore, setHasMore] = useState(false);
    const [nextCursor, setNextCursor] = useState(null);
    const [reloadKey, setReloadKey] = useState(0);

    // ================== REFERENCES ==================
    const messagesRef = useRef(null);
    const inputRef = useRef(null);
    const requestIdRef = useRef(null);
    const busyRef = useRef(false);
    const streamControllerRef = useRef(null);
    const autoStartedRef = useRef(null);
    const scrollToBottomRef = useRef(true);
    const restoreScrollRef = useRef(null);
    const conversationIdRef = useRef(conversationId);

    // ================== STOP OLD STREAM ==================
    useEffect(() => {
        conversationIdRef.current = conversationId;

        return () => {
            streamControllerRef.current?.abort();
            streamControllerRef.current = null;
            busyRef.current = false;
        };
    }, [conversationId]);

    // ================== LOAD CONVERSATION ==================
    useEffect(() => {
        let active = true;

        async function loadConversation() {
            setLoading(true);
            setError("");
            setConversation(null);
            setMessages([]);
            setHasMore(false);
            setNextCursor(null);
            setQueuePosition(null);
            setSending(false);

            scrollToBottomRef.current = true;
            restoreScrollRef.current = null;

            try {
                const [conversationData, messageData] =
                    await Promise.all([
                        getConversation(conversationId),
                        getMessageHistory(conversationId, {
                            limit: MESSAGE_LIMIT,
                        }),
                    ]);

                if (!active) return;

                setConversation(conversationData.conversation);
                setMessages(messageData.messages || []);

                setHasMore(
                    Boolean(messageData.pagination?.hasMore)
                );

                setNextCursor(
                    messageData.pagination?.nextCursor || null
                );
            } catch (error) {
                if (!active) return;

                setError(
                    getErrorMessage(
                        error,
                        "Unable to load conversation."
                    )
                );
            } finally {
                if (active) {
                    setLoading(false);
                }
            }
        }

        loadConversation();

        return () => {
            active = false;
        };
    }, [conversationId, reloadKey]);

    // ================== RESET CHAT DRAFT ==================
    useEffect(() => {
        setMessage("");
        setAttachments([]);

        requestIdRef.current = null;
        autoStartedRef.current = null;
    }, [conversationId]);

    // ================== SCROLL MANAGEMENT ==================
    useLayoutEffect(() => {
        const container = messagesRef.current;

        if (!container) return;

        // ================== RESTORE SCROLL ==================
        if (restoreScrollRef.current) {
            const { height, top } =
                restoreScrollRef.current;

            container.scrollTop =
                container.scrollHeight - height + top;

            restoreScrollRef.current = null;
            return;
        }

        // ================== SCROLL TO BOTTOM ==================
        if (scrollToBottomRef.current) {
            container.scrollTop = container.scrollHeight;
            scrollToBottomRef.current = false;
        }
    }, [messages]);

    // ================== CHECK SCROLL POSITION ==================
    function markScrollIfNearBottom() {
        const container = messagesRef.current;

        scrollToBottomRef.current =
            !container ||
            container.scrollHeight -
                container.scrollTop -
                container.clientHeight < 110;
    }

    // ================== LOAD EARLIER MESSAGES ==================
    async function handleLoadMore() {
        if (
            !hasMore ||
            !nextCursor ||
            loadingMore ||
            loading
        ) {
            return;
        }

        setLoadingMore(true);

        try {
            const response = await getMessageHistory(
                conversationId,
                {
                    before: nextCursor,
                    limit: MESSAGE_LIMIT,
                }
            );

            const olderMessages = response.messages || [];
            const container = messagesRef.current;

            if (olderMessages.length && container) {
                restoreScrollRef.current = {
                    height: container.scrollHeight,
                    top: container.scrollTop,
                };
            }

            // ================== MERGE MESSAGES ==================
            setMessages((current) => {
                const existingIds = new Set(
                    current.map((item) => item._id)
                );

                const uniqueMessages = olderMessages.filter(
                    (item) => !existingIds.has(item._id)
                );

                return [
                    ...uniqueMessages,
                    ...current,
                ];
            });

            setHasMore(
                Boolean(response.pagination?.hasMore)
            );

            setNextCursor(
                response.pagination?.nextCursor || null
            );
        } catch (error) {
            toast.error(
                getErrorMessage(
                    error,
                    "Unable to load earlier messages."
                )
            );
        } finally {
            setLoadingMore(false);
        }
    }

    // ================== AI STREAM ==================
    async function runAIStream(
        userMessageId,
        { regenerate = false } = {}
    ) {
        const controller = new AbortController();
        const activeConversationId = conversationId;

        streamControllerRef.current = controller;

        let assistantMessageId = null;
        let assistantHasContent = false;
        let finished = false;

        setQueuePosition(null);

        try {
            await generateAIResponse(
                activeConversationId,
                userMessageId,
                {
                    signal: controller.signal,
                    regenerate,

                    // ================== HANDLE STREAM EVENTS ==================
                    onEvent: ({ type, data }) => {
                        if (
                            controller.signal.aborted ||
                            conversationIdRef.current !==
                                activeConversationId
                        ) {
                            return;
                        }

                        // ================== QUEUED ==================
                        if (type === "queued") {
                            setQueuePosition(
                                data?.position || 1
                            );
                            return;
                        }

                        // ================== START ==================
                        if (
                            type === "start" &&
                            data?.messageId
                        ) {
                            assistantMessageId = data.messageId;

                            setQueuePosition(null);
                            markScrollIfNearBottom();

                            setMessages((current) => {
                                const exists = current.some(
                                    (item) =>
                                        item._id === data.messageId
                                );

                                if (exists) {
                                    return current;
                                }

                                return [
                                    ...current,
                                    {
                                        _id: data.messageId,
                                        conversationId:
                                            activeConversationId,
                                        replyToMessageId:
                                            userMessageId,
                                        role: "assistant",
                                        content: "",
                                        status: "queued",
                                        provider: null,
                                        model: null,
                                        createdAt:
                                            new Date().toISOString(),
                                    },
                                ];
                            });

                            return;
                        }

                        // ================== PROVIDER ==================
                        if (
                            type === "provider" &&
                            assistantMessageId
                        ) {
                            setMessages((current) =>
                                current.map((item) =>
                                    item._id === assistantMessageId
                                        ? {
                                              ...item,
                                              provider:
                                                  data?.provider || null,
                                              model:
                                                  data?.model || null,
                                              status: "streaming",
                                          }
                                        : item
                                )
                            );

                            return;
                        }

                        // ================== RESPONSE DELTA ==================
                        if (
                            type === "delta" &&
                            assistantMessageId
                        ) {
                            const text =
                                typeof data?.text === "string"
                                    ? data.text
                                    : "";

                            if (!text) return;

                            assistantHasContent = true;
                            markScrollIfNearBottom();

                            setMessages((current) =>
                                current.map((item) =>
                                    item._id === assistantMessageId
                                        ? {
                                              ...item,
                                              content:
                                                  item.content + text,
                                              status: "streaming",
                                          }
                                        : item
                                )
                            );

                            return;
                        }

                        // ================== COMPLETE ==================
                        if (
                            type === "done" &&
                            assistantMessageId
                        ) {
                            finished = true;

                            setMessages((current) =>
                                current.map((item) =>
                                    item._id === assistantMessageId
                                        ? {
                                              ...item,
                                              status:
                                                  data?.status ||
                                                  "incomplete",
                                              provider:
                                                  data?.provider ||
                                                  item.provider,
                                              model:
                                                  data?.model ||
                                                  item.model,
                                          }
                                        : item
                                )
                            );
                        }
                    },
                }
            );
        } catch (error) {
            const stopped = controller.signal.aborted;

            // ================== UPDATE FAILED MESSAGE ==================
            if (
                assistantMessageId &&
                conversationIdRef.current ===
                    activeConversationId
            ) {
                setMessages((current) =>
                    current.map((item) =>
                        item._id === assistantMessageId &&
                        !finished
                            ? {
                                  ...item,
                                  status: stopped
                                      ? "stopped"
                                      : assistantHasContent
                                        ? "incomplete"
                                        : "failed",
                              }
                            : item
                    )
                );
            }

            // ================== ERROR NOTIFICATION ==================
            if (
                !stopped &&
                conversationIdRef.current ===
                    activeConversationId
            ) {
                toast.error(
                    getErrorMessage(
                        error,
                        "AI generation failed. Please retry."
                    )
                );
            }
        } finally {
            // ================== CLEANUP ==================
            if (streamControllerRef.current === controller) {
                streamControllerRef.current = null;
                setQueuePosition(null);
            }
        }
    }

    // ================== MESSAGE INPUT ==================
    function handleMessageChange(event) {
        setMessage(event.target.value);
        requestIdRef.current = null;
    }

    // ================== ATTACHMENTS ==================
    function handleAttachmentsChange(files) {
        setAttachments(files);
    }

    // ================== SEND MESSAGE ==================
    async function handleSubmit(event) {
        event.preventDefault();

        if (
            busyRef.current ||
            loading ||
            !conversation
        ) {
            return;
        }

        const content = message.trim();

        if (!content && !attachments.length) {
            return;
        }

        // ================== DOCUMENTS PENDING ==================
        if (attachments.length > 0) {
            toast.info(
                "PDF and Word document sending will be available after upload integration."
            );
            return;
        }

        busyRef.current = true;
        setSending(true);

        const activeConversationId = conversationId;

        try {
            // ================== REQUEST ID ==================
            if (!requestIdRef.current) {
                requestIdRef.current =
                    generateChatRequestId();
            }

            // ================== SAVE USER MESSAGE ==================
            const response = await sendMessage(
                activeConversationId,
                content,
                requestIdRef.current
            );

            const savedMessage = response.userMessage;

            if (!savedMessage?._id) {
                throw new Error(
                    "Saved message was not returned."
                );
            }

            if (
                conversationIdRef.current !==
                activeConversationId
            ) {
                return;
            }

            // ================== UPDATE CHAT ==================
            scrollToBottomRef.current = true;

            setMessages((current) => {
                const alreadyExists = current.some(
                    (item) =>
                        item._id === savedMessage._id
                );

                if (alreadyExists) {
                    return current;
                }

                return [
                    ...current,
                    savedMessage,
                ];
            });

            // ================== RESET INPUT ==================
            setMessage("");
            requestIdRef.current = null;

            // ================== START AI RESPONSE ==================
            await runAIStream(savedMessage._id);
        } catch (error) {
            if (
                conversationIdRef.current ===
                activeConversationId
            ) {
                toast.error(
                    getErrorMessage(
                        error,
                        "Unable to send message. Please retry."
                    )
                );
            }
        } finally {
            if (
                conversationIdRef.current ===
                activeConversationId
            ) {
                busyRef.current = false;
                setSending(false);

                inputRef.current?.focus();
            }
        }
    }

    // ================== GENERATE / RETRY / REGENERATE ==================
    async function handleGenerateSavedMessage(
        userMessageId,
        { regenerate = false } = {}
    ) {
        if (busyRef.current || loading) {
            return;
        }

        busyRef.current = true;
        setSending(true);

        const activeConversationId = conversationId;

        try {
            await runAIStream(userMessageId, {
                regenerate,
            });
        } finally {
            if (
                conversationIdRef.current ===
                activeConversationId
            ) {
                busyRef.current = false;
                setSending(false);
            }
        }
    }

    // ================== INITIAL CHAT HANDOFF ==================
    useEffect(() => {
        const pendingId =
            location.state?.autoGenerateMessageId;

        if (
            !pendingId ||
            loading ||
            !conversation ||
            error
        ) {
            return;
        }

        const key = `${conversationId}:${pendingId}`;

        if (autoStartedRef.current === key) {
            return;
        }

        // ================== FIND CURRENT MESSAGE ==================
        const latestUser = [...messages]
            .reverse()
            .find((item) => item.role === "user");

        if (
            !latestUser ||
            latestUser._id !== pendingId
        ) {
            return;
        }

        autoStartedRef.current = key;

        // ================== CLEAR NAVIGATION STATE ==================
        navigate(location.pathname, {
            replace: true,
            state: null,
        });

        // ================== CHECK EXISTING RESPONSE ==================
        const existingReply = messages.some(
            (item) =>
                item.role === "assistant" &&
                item.replyToMessageId === pendingId &&
                !RETRYABLE_STATUSES.has(item.status)
        );

        if (!existingReply) {
            void handleGenerateSavedMessage(pendingId);
        }
    }, [
        conversationId,
        conversation,
        error,
        loading,
        location.pathname,
        location.state,
        messages,
        navigate,
    ]);

    // ================== LATEST USER MESSAGE ==================
    const lastUserMessage = [...messages]
        .reverse()
        .find((item) => item.role === "user");

    // ================== LATEST AI RESPONSE ==================
    const lastReply = lastUserMessage
        ? [...messages]
              .reverse()
              .find(
                  (item) =>
                      item.role === "assistant" &&
                      item.replyToMessageId ===
                          lastUserMessage._id
              )
        : null;

    // ================== GENERATE / RETRY AVAILABILITY ==================
    const canGenerateReply = Boolean(
        lastUserMessage &&
        !sending &&
        (
            !lastReply ||
            RETRYABLE_STATUSES.has(lastReply.status)
        )
    );

    // ================== REGENERATE AVAILABILITY ==================
    const canRegenerateReply = Boolean(
        lastUserMessage &&
        lastReply?.status === "completed" &&
        !sending &&
        !loading
    );

    // ================== LOADING ==================
    if (loading) {
        return (
            <div
                className="conversation-feedback"
                role="status"
            >
                <i
                    className="fa-solid fa-spinner fa-spin"
                    aria-hidden="true"
                />

                <p>Loading conversation...</p>
            </div>
        );
    }

    // ================== ERROR ==================
    if (error || !conversation) {
        return (
            <div className="conversation-feedback">
                <i
                    className="fa-regular fa-circle-xmark"
                    aria-hidden="true"
                />

                <h2>Conversation unavailable</h2>

                <p>
                    {error || "Conversation not found."}
                </p>

                <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() =>
                        setReloadKey(
                            (current) => current + 1
                        )
                    }
                >
                    Try Again
                </button>

                <Link
                    to="/chat"
                    className="btn btn-link"
                >
                    New Chat
                </Link>
            </div>
        );
    }

    return (
        <section
            className="conversation-page"
            aria-labelledby="conversation-title"
        >
            <h1
                id="conversation-title"
                className="visually-hidden"
            >
                {conversation.title}
            </h1>

            {/* ================== MESSAGE HISTORY ================== */}
            <div
                ref={messagesRef}
                className="conversation-messages"
                role="log"
                aria-label="Conversation messages"
            >
                <MessageList
                    messages={messages}
                    hasMore={hasMore}
                    loadingMore={loadingMore}
                    onLoadMore={handleLoadMore}
                />
            </div>

            {/* ================== STREAM CONTROLS ================== */}
            <div className="conversation-composer-wrap">

                {/* ================== STOP GENERATION ================== */}
                {sending && (
                    <div
                        className="conversation-load-more"
                        role="status"
                    >
                        <button
                            type="button"
                            onClick={() =>
                                streamControllerRef.current?.abort()
                            }
                            disabled={!streamControllerRef.current}
                        >
                            <i
                                className="fa-solid fa-stop"
                                aria-hidden="true"
                            />
                            {" "}
                            Stop Generation

                            {queuePosition
                                ? ` · Queue #${queuePosition}`
                                : ""}
                        </button>
                    </div>
                )}

                {/* ================== RETRY AI RESPONSE ================== */}
                {canGenerateReply && (
                    <div className="conversation-load-more">
                        <button
                            type="button"
                            onClick={() =>
                                handleGenerateSavedMessage(
                                    lastUserMessage._id
                                )
                            }
                        >
                            <i
                                className="fa-solid fa-rotate-right"
                                aria-hidden="true"
                            />
                            {" "}
                            {lastReply
                                ? "Retry AI Response"
                                : "Generate AI Response"}
                        </button>
                    </div>
                )}

                {/* ================== REGENERATE AI RESPONSE ================== */}
                {canRegenerateReply && (
                    <div className="conversation-load-more">
                        <button
                            type="button"
                            onClick={() =>
                                handleGenerateSavedMessage(
                                    lastUserMessage._id,
                                    {
                                        regenerate: true,
                                    }
                                )
                            }
                            aria-label="Regenerate AI response"
                        >
                            <i
                                className="fa-solid fa-arrows-rotate"
                                aria-hidden="true"
                            />
                            {" "}
                            Regenerate Response
                        </button>
                    </div>
                )}

                {/* ================== MESSAGE COMPOSER ================== */}
                <MessageComposer
                    inputId="conversation-message"
                    inputRef={inputRef}
                    value={message}
                    onChange={handleMessageChange}
                    attachments={attachments}
                    onAttachmentsChange={
                        handleAttachmentsChange
                    }
                    onSubmit={handleSubmit}
                    placeholder="Message QueryNest AI..."
                    sending={sending}
                />

                {/* ================== FOOTNOTE ================== */}
                <p className="chat-dashboard-note">
                    QueryNest AI can make mistakes.
                    Verify important information.
                </p>
            </div>
        </section>
    );
}

// ================== EXPORT ==================
export default Conversation;
