
import {
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "react-toastify";

import MessageComposer from "../components/chat/MessageComposer";

import {
    generateChatRequestId,
    getConversation,
    getMessageHistory,
    sendMessage,
} from "../services/chatService";

// ================== CONFIGURATION ==================
const MESSAGE_LIMIT = 20;

// ================== CONVERSATION ==================
function Conversation() {
    const { conversationId } = useParams();

    const [conversation, setConversation] = useState(null);
    const [messages, setMessages] = useState([]);
    const [message, setMessage] = useState("");
    const [attachments, setAttachments] = useState([]);

    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState("");

    const [hasMore, setHasMore] = useState(false);
    const [nextCursor, setNextCursor] = useState(null);
    const [reloadKey, setReloadKey] = useState(0);

    const messagesRef = useRef(null);
    const inputRef = useRef(null);
    const requestIdRef = useRef(null);
    const sendingRef = useRef(false);
    const scrollToBottomRef = useRef(true);
    const restoreScrollRef = useRef(null);

    // ================== LOAD CONVERSATION ==================
    useEffect(() => {
        let active = true;

        const loadConversation = async () => {
            setLoading(true);
            setError("");
            setConversation(null);
            setMessages([]);
            setHasMore(false);
            setNextCursor(null);

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
                    error.response?.data?.message ||
                    "Unable to load conversation."
                );
            } finally {
                if (active) {
                    setLoading(false);
                }
            }
        };

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
    }, [conversationId]);

    // ================== SCROLL MANAGEMENT ==================
    useLayoutEffect(() => {
        const container = messagesRef.current;

        if (!container) return;

        if (restoreScrollRef.current) {
            const { height, top } = restoreScrollRef.current;

            container.scrollTop =
                container.scrollHeight - height + top;

            restoreScrollRef.current = null;
            return;
        }

        if (scrollToBottomRef.current) {
            container.scrollTop = container.scrollHeight;
            scrollToBottomRef.current = false;
        }
    }, [messages]);

    // ================== LOAD EARLIER MESSAGES ==================
    const handleLoadMore = async () => {
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

            setMessages((current) => {
                const existingIds = new Set(
                    current.map((item) => item._id)
                );

                const uniqueMessages = olderMessages.filter(
                    (item) => !existingIds.has(item._id)
                );

                return [...uniqueMessages, ...current];
            });

            setHasMore(
                Boolean(response.pagination?.hasMore)
            );
            setNextCursor(
                response.pagination?.nextCursor || null
            );
        } catch (error) {
            toast.error(
                error.response?.data?.message ||
                "Unable to load earlier messages."
            );
        } finally {
            setLoadingMore(false);
        }
    };

    // ================== MESSAGE INPUT ==================
    const handleMessageChange = (event) => {
        setMessage(event.target.value);
        requestIdRef.current = null;
    };

    // ================== ATTACHMENTS ==================
    const handleAttachmentsChange = (files) => {
        setAttachments(files);
    };

    // ================== SEND MESSAGE ==================
    const handleSubmit = async (event) => {
        event.preventDefault();

        if (sendingRef.current || loading) return;

        const content = message.trim();

        if (!content && !attachments.length) return;

        // Document upload API integration is pending.
        if (attachments.length > 0) {
            toast.info(
                "PDF and Word document sending will be available after upload integration."
            );
            return;
        }

        sendingRef.current = true;
        setSending(true);

        try {
            if (!requestIdRef.current) {
                requestIdRef.current = generateChatRequestId();
            }

            const response = await sendMessage(
                conversationId,
                content,
                requestIdRef.current
            );

            const savedMessage = response.userMessage;

            if (!savedMessage?._id) {
                throw new Error("Message was not returned.");
            }

            scrollToBottomRef.current = true;

            setMessages((current) => {
                const alreadyExists = current.some(
                    (item) => item._id === savedMessage._id
                );

                if (alreadyExists) {
                    return current;
                }

                return [...current, savedMessage];
            });

            setMessage("");
            requestIdRef.current = null;

            inputRef.current?.focus();
        } catch (error) {
            toast.error(
                error.response?.data?.message ||
                error.message ||
                "Unable to send message. Please try again."
            );
        } finally {
            sendingRef.current = false;
            setSending(false);
        }
    };

    // ================== MESSAGE TIME ==================
    const formatTime = (date) => {
        if (!date) return "";

        const value = new Date(date);

        if (Number.isNaN(value.getTime())) return "";

        return value.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
        });
    };

    // ================== LOADING ==================
    if (loading) {
        return (
            <div className="conversation-feedback" role="status">
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
                        setReloadKey((current) => current + 1)
                    }
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
                <div className="conversation-message-list">

                    {/* Earlier Messages */}
                    {hasMore && (
                        <div className="conversation-load-more">
                            <button
                                type="button"
                                onClick={handleLoadMore}
                                disabled={loadingMore}
                            >
                                {loadingMore
                                    ? "Loading..."
                                    : "Load Earlier Messages"}
                            </button>
                        </div>
                    )}

                    {/* Empty Conversation */}
                    {messages.length === 0 && (
                        <div className="conversation-empty">
                            <i
                                className="fa-regular fa-comments"
                                aria-hidden="true"
                            />

                            <h2>Start your conversation</h2>

                            <p>
                                Type a message to begin.
                            </p>
                        </div>
                    )}

                    {/* Messages */}
                    {messages.map((item) => (
                        <article
                            key={item._id}
                            className={`conversation-message conversation-message-${item.role}`}
                        >
                            <div className="conversation-message-heading">
                                <span>
                                    {item.role === "user"
                                        ? "You"
                                        : "QueryNest AI"}
                                </span>

                                <time dateTime={item.createdAt}>
                                    {formatTime(item.createdAt)}
                                </time>
                            </div>

                            <div className="conversation-message-content">
                                {item.content}
                            </div>

                            {item.status === "failed" && (
                                <span className="conversation-message-error">
                                    Message processing failed.
                                </span>
                            )}
                        </article>
                    ))}
                </div>
            </div>

            {/* ================== MESSAGE COMPOSER ================== */}
            <div className="conversation-composer-wrap">
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

                <p className="chat-dashboard-note">
                    QueryNest AI can make mistakes.
                    Verify important information.
                </p>
            </div>
        </section>
    );
}

export default Conversation;
