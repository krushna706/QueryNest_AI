import { formatMessageTime } from "../../utils/formatDate";
import { memo, useEffect, useMemo, useState } from "react";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import CodeBlock from "./CodeBlock";
import { getDocuments } from "../../services/documentService";

// Message status
const MESSAGE_STATUSES = {
    queued: "Preparing response...",
    streaming: "Generating response...",
    stopped: "Generation stopped.",
    incomplete: "Response incomplete.",
    failed: "Response failed.",
    cancelled: "Generation cancelled.",
};

const RETRYABLE_STATUSES = new Set(["failed", "stopped", "incomplete"]);

// Markdown components
const markdownComponents = {
    h1: ({ node, ...props }) => <h2 {...props} className="qn-markdown-heading-lg" />,

    h2: ({ node, ...props }) => <h3 {...props} className="qn-markdown-heading-md" />,

    h3: ({ node, ...props }) => <h4 {...props} className="qn-markdown-heading-sm" />,

    p: ({ node, ...props }) => <p {...props} className="qn-markdown-paragraph" />,

    ul: ({ node, ...props }) => <ul {...props} className="qn-markdown-ul" />,

    ol: ({ node, ...props }) => <ol {...props} className="qn-markdown-ol" />,

    li: ({ node, ...props }) => <li {...props} className="qn-markdown-list-item" />,

    code: ({ node, children, className, ...props }) => (
        <code {...props} className={[className, "qn-markdown-inline-code"].filter(Boolean).join(" ")}>
            {children}
        </code>
    ),

    pre: ({ node, children }) => {
        const codeNode = node?.children?.find((child) => child.type === "element" && child.tagName === "code");

        if (!codeNode) {
            return <pre>{children}</pre>;
        }

        const rawClass = codeNode.properties?.className;

        const className = Array.isArray(rawClass) ? rawClass.join(" ") : String(rawClass || "");

        const language = className.match(/language-([a-z0-9+#.-]+)/i)?.[1] || "text";

        const codeText = (codeNode.children || []).map((child) => (child.type === "text" ? child.value : "")).join("");

        return <CodeBlock language={language} code={codeText} />;
    },

    blockquote: ({ node, ...props }) => <blockquote {...props} className="qn-markdown-quote" />,

    table: ({ node, ...props }) => (
        <div className="qn-markdown-table-scroll">
            <table className="qn-markdown-table" {...props} />
        </div>
    ),

    th: ({ node, ...props }) => <th {...props} className="qn-markdown-th" />,

    td: ({ node, ...props }) => <td {...props} className="qn-markdown-td" />,

    a: ({ node, href, children, ...props }) => (
        <a className="qn-markdown-link" {...props} href={href} target="_blank" rel="noopener noreferrer nofollow">
            {children}
        </a>
    ),

    hr: () => <hr className="qn-markdown-rule" />,

    img: ({ alt }) => <span>{alt ? `[Image: ${alt}]` : "[Image]"}</span>,
};

// Document attachments
function MessageAttachments({ attachmentIds, documentMap }) {
    if (!Array.isArray(attachmentIds) || attachmentIds.length === 0) {
        return null;
    }

    return (
        <div className="d-flex flex-wrap qn-message-attachments">
            {attachmentIds.map((documentId) => {
                const id = String(documentId);
                const document = documentMap[id];

                const filename = document?.originalName || "Attached document";

                const fileType = document?.fileType || (filename.toLowerCase().endsWith(".pdf") ? "pdf" : "docx");

                return (
                    <div key={id} title={filename} className="d-flex align-items-center qn-message-attachment">
                        <i
                            className={`${
                                fileType === "pdf" ? "fa-regular fa-file-pdf" : "fa-regular fa-file-word"
                            } qn-message-file-icon`}

                            aria-hidden="true"
                        />
                        <div className="qn-message-file-details">
                            <strong className="qn-message-file-name">{filename}</strong>

                            <small className="qn-message-file-type">
                                {fileType === "pdf" ? "PDF Document" : "Word Document"}
                            </small>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// Message item
const MessageItem = memo(function MessageItem({
    item,
    documentMap,
    versionIndex,
    versionCount,
    onPrevious,
    onNext,
    showActions = false,
    actionsDisabled = false,
    onRegenerate,
    onRetry,
}) {
    const isAssistant = item.role === "assistant";

    const content = typeof item.content === "string" ? item.content : "";

    const status = item.status || "completed";

    const statusMessage = MESSAGE_STATUSES[status] || "";

    const providerName = item.provider === "groq" ? "Groq" : item.provider === "gemini" ? "Gemini" : null;

    const canRegenerate = isAssistant && showActions && status === "completed" && typeof onRegenerate === "function";

    const canRetry = isAssistant && showActions && RETRYABLE_STATUSES.has(status) && typeof onRetry === "function";

    const hasActions = canRegenerate || canRetry || (isAssistant && versionCount > 1);

    return (
        <article
            className={`conversation-message conversation-message-${item.role}${isAssistant ? " qn-message-assistant-box" : ""}`}
        >
            <div className="conversation-message-heading">
                <span>{isAssistant ? "QueryNest AI" : "You"}</span>

                <time dateTime={item.createdAt || undefined}>{formatMessageTime(item.createdAt)}</time>
            </div>
            <div className="conversation-message-content qn-message-content">
                {isAssistant ? (
                    content ? (
                        <div className="chat-markdown-content qn-message-markdown">
                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents} skipHtml>
                                {content}
                            </ReactMarkdown>
                        </div>
                    ) : ["queued", "streaming"].includes(status) ? (
                        "Thinking..."
                    ) : (
                        ""
                    )
                ) : (
                    <>
                        <MessageAttachments attachmentIds={item.attachmentIds} documentMap={documentMap} />
                        <div className="qn-message-plain-text">{content}</div>
                    </>
                )}
            </div>
            {isAssistant && providerName && (
                <span className="qn-message-provider">
                    <strong>Model: </strong>
                    {providerName}
                    {item.model ? ` · ${item.model}` : ""}
                </span>
            )}
            {isAssistant && status !== "completed" && statusMessage && (
                <span
                    className={
                        ["queued", "streaming"].includes(status)
                            ? "conversation-message-error qn-message-status-pending"
                            : "conversation-message-error"
                    }
                >
                    {statusMessage}
                </span>
            )}
            {hasActions && (
                <div className="qn-message-actions">
                    <div className="qn-message-action-main">
                        {(canRegenerate || canRetry) && (
                            <button
                                className="qn-message-action-button"
                                type="button"
                                disabled={actionsDisabled}
                                onClick={canRegenerate ? onRegenerate : onRetry}
                                title={canRegenerate ? "Regenerate response" : "Retry response"}
                            >
                                <i className="fa-solid fa-arrows-rotate" aria-hidden="true" />

                                {canRegenerate ? "Regenerate" : "Retry"}
                            </button>
                        )}
                    </div>
                    {isAssistant && versionCount > 1 && (
                        <div
                            className="chat-response-versions qn-message-versions"
                            role="group"
                            aria-label="AI response versions"
                        >
                            <button
                                className="qn-message-version-button-prev"
                                type="button"
                                onClick={onPrevious}
                                disabled={versionIndex === 0}
                                aria-label="Previous AI response version"
                                title="Previous response"
                            >
                                <i className="fa-solid fa-chevron-left" aria-hidden="true" />
                            </button>
                            <span className="qn-message-version-label" aria-live="polite">
                                {versionIndex + 1} / {versionCount}
                            </span>
                            <button
                                className="qn-message-version-button-next"
                                type="button"
                                onClick={onNext}
                                disabled={versionIndex === versionCount - 1}
                                aria-label="Next AI response version"
                                title="Next response"
                            >
                                <i className="fa-solid fa-chevron-right" aria-hidden="true" />
                            </button>
                        </div>
                    )}
                </div>
            )}
        </article>
    );
});

// Group response versions
function groupMessageVersions(messages) {
    const versionsByReply = new Map();

    for (const item of messages) {
        if (item.role !== "assistant" || !item.replyToMessageId) {
            continue;
        }

        const replyId = String(item.replyToMessageId);

        if (!versionsByReply.has(replyId)) {
            versionsByReply.set(replyId, []);
        }

        versionsByReply.get(replyId).push(item);
    }

    const renderedReplies = new Set();
    const displayItems = [];

    for (const item of messages) {
        if (item.role === "assistant" && item.replyToMessageId) {
            const replyId = String(item.replyToMessageId);

            if (renderedReplies.has(replyId)) {
                continue;
            }

            renderedReplies.add(replyId);

            displayItems.push({
                key: `reply-${replyId}`,
                replyId,
                versions: versionsByReply.get(replyId),
            });

            continue;
        }

        // User messages and standalone assistant messages
        // remain visible in their original order.
        displayItems.push({
            key: `message-${item._id}`,
            replyId: null,
            versions: [item],
        });
    }

    return displayItems;
}

// Message list
function MessageList({
    messages = [],
    hasMore = false,
    loadingMore = false,
    onLoadMore,
    onRegenerate,
    onRetry,
    actionsDisabled = false,
}) {
    const [selectedVersions, setSelectedVersions] = useState({});

    const [documentMap, setDocumentMap] = useState({});

    const conversationId = messages.find((item) => item?.conversationId)?.conversationId;

    const attachmentKey = messages
        .filter((item) => item?.role === "user")
        .flatMap((item) => (Array.isArray(item.attachmentIds) ? item.attachmentIds.map(String) : []))
        .join(",");

    useEffect(() => {
        const controller = new AbortController();
        let active = true;

        setDocumentMap({});

        if (!conversationId || !attachmentKey) {
            return () => {
                active = false;
                controller.abort();
            };
        }

        async function loadDocumentNames() {
            try {
                const response = await getDocuments(String(conversationId), {
                    signal: controller.signal,
                });

                if (!active) return;

                const documents = Array.isArray(response?.documents) ? response.documents : [];

                const lookup = {};

                for (const document of documents) {
                    if (document?._id) {
                        lookup[String(document._id)] = {
                            originalName: document.originalName,
                            fileType: document.fileType,
                        };
                    }
                }

                setDocumentMap(lookup);
            } catch {
                // Show a generic attachment label if
                // document metadata is unavailable.
            }
        }

        void loadDocumentNames();

        return () => {
            active = false;
            controller.abort();
        };
    }, [conversationId, attachmentKey]);

    const displayItems = useMemo(() => groupMessageVersions(messages), [messages]);

    const lastUserMessageId = [...messages].reverse().find((item) => item.role === "user")?._id;

    function selectVersion(replyId, versions, index) {
        if (!replyId || index < 0 || index >= versions.length) {
            return;
        }

        setSelectedVersions((current) => ({
            ...current,
            [replyId]: {
                messageId: versions[index]._id,
                versionCount: versions.length,
            },
        }));
    }

    return (
        <div className="conversation-message-list">
            {hasMore && (
                <div className="conversation-load-more">
                    <button
                        type="button"
                        onClick={onLoadMore}
                        disabled={loadingMore || typeof onLoadMore !== "function"}
                    >
                        {loadingMore ? "Loading..." : "Load Earlier Messages"}
                    </button>
                </div>
            )}
            {messages.length === 0 && (
                <div className="conversation-empty">
                    <i className="fa-regular fa-comments" aria-hidden="true" />

                    <h2>Start your conversation</h2>

                    <p>Type a message to begin.</p>
                </div>
            )}
            {displayItems.map((group) => {
                const { replyId, versions } = group;

                const savedSelection = replyId ? selectedVersions[replyId] : null;

                const savedIndex =
                    savedSelection?.versionCount === versions.length
                        ? versions.findIndex((item) => String(item._id) === String(savedSelection.messageId))
                        : -1;

                const versionIndex = savedIndex >= 0 ? savedIndex : versions.length - 1;

                const currentMessage = versions[versionIndex];

                const showActions =
                    Boolean(replyId) &&
                    String(replyId) === String(lastUserMessageId) &&
                    versionIndex === versions.length - 1;

                return (
                    <MessageItem
                        key={group.key}
                        item={currentMessage}
                        documentMap={documentMap}
                        versionIndex={versionIndex}
                        versionCount={versions.length}
                        showActions={showActions}
                        actionsDisabled={actionsDisabled}
                        onRegenerate={showActions && onRegenerate ? () => onRegenerate(replyId) : undefined}
                        onRetry={showActions && onRetry ? () => onRetry(replyId) : undefined}
                        onPrevious={() => selectVersion(replyId, versions, versionIndex - 1)}
                        onNext={() => selectVersion(replyId, versions, versionIndex + 1)}
                    />
                );
            })}
        </div>
    );
}

// Export
export default MessageList;
