
import {
    memo,
    useEffect,
    useMemo,
    useState,
} from "react";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import CodeBlock from "./CodeBlock";
import { getDocuments } from "../../services/documentService";

// ================== MESSAGE STATUS ==================
const MESSAGE_STATUSES = {
    queued: "Preparing response...",
    streaming: "Generating response...",
    stopped: "Generation stopped.",
    incomplete: "Response incomplete.",
    failed: "Response failed.",
    cancelled: "Generation cancelled.",
};

const RETRYABLE_STATUSES = new Set([
    "failed",
    "stopped",
    "incomplete",
]);

// ================== FORMAT MESSAGE TIME ==================
function formatMessageTime(date) {
    if (!date) return "";

    const value = new Date(date);

    if (Number.isNaN(value.getTime())) {
        return "";
    }

    return value.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
    });
}

// ================== MARKDOWN COMPONENTS ==================
const markdownComponents = {

    // ================== HEADINGS ==================
    h1: ({ node, ...props }) => (
        <h2
            {...props}
            style={{
                margin: "18px 0 10px",
                fontSize: "20px",
                fontWeight: 700,
                lineHeight: 1.5,
            }}
        />
    ),

    h2: ({ node, ...props }) => (
        <h3
            {...props}
            style={{
                margin: "16px 0 9px",
                fontSize: "17px",
                fontWeight: 700,
                lineHeight: 1.5,
            }}
        />
    ),

    h3: ({ node, ...props }) => (
        <h4
            {...props}
            style={{
                margin: "14px 0 8px",
                fontSize: "15px",
                fontWeight: 700,
                lineHeight: 1.5,
            }}
        />
    ),

    // ================== PARAGRAPH ==================
    p: ({ node, ...props }) => (
        <p
            {...props}
            style={{
                margin: "0 0 12px",
                lineHeight: 1.8,
            }}
        />
    ),

    // ================== UNORDERED LIST ==================
    ul: ({ node, ...props }) => (
        <ul
            {...props}
            style={{
                margin: "8px 0 13px",
                paddingLeft: "24px",
                listStyleType: "disc",
            }}
        />
    ),

    // ================== ORDERED LIST ==================
    ol: ({ node, ...props }) => (
        <ol
            {...props}
            style={{
                margin: "8px 0 13px",
                paddingLeft: "24px",
                listStyleType: "decimal",
            }}
        />
    ),

    // ================== LIST ITEM ==================
    li: ({ node, ...props }) => (
        <li
            {...props}
            style={{
                marginBottom: "5px",
                lineHeight: 1.7,
            }}
        />
    ),

    // ================== INLINE CODE ==================
    code: ({ node, children, className, ...props }) => (
        <code
            {...props}
            className={className}
            style={{
                padding: "2px 5px",
                borderRadius: "5px",
                color: "#a43d65",
                background: "#f1f4f9",
                fontFamily:
                    "Consolas, Monaco, 'Courier New', monospace",
                fontSize: "0.9em",
                overflowWrap: "anywhere",
            }}
        >
            {children}
        </code>
    ),

    // ================== CODE BLOCK ==================
    pre: ({ node, children }) => {
        const codeNode = node?.children?.find(
            (child) =>
                child.type === "element" &&
                child.tagName === "code"
        );

        if (!codeNode) {
            return <pre>{children}</pre>;
        }

        const rawClass = codeNode.properties?.className;

        const className = Array.isArray(rawClass)
            ? rawClass.join(" ")
            : String(rawClass || "");

        const language =
            className.match(/language-([a-z0-9+#.-]+)/i)?.[1] ||
            "text";

        const codeText = (codeNode.children || [])
            .map((child) =>
                child.type === "text" ? child.value : ""
            )
            .join("");

        return (
            <CodeBlock
                language={language}
                code={codeText}
            />
        );
    },

    // ================== BLOCKQUOTE ==================
    blockquote: ({ node, ...props }) => (
        <blockquote
            {...props}
            style={{
                margin: "12px 0",
                padding: "10px 15px",
                borderLeft: "3px solid #9eb7d6",
                borderRadius: "0 7px 7px 0",
                color: "#53677f",
                background: "#f4f7fb",
            }}
        />
    ),

    // ================== TABLE ==================
    table: ({ node, ...props }) => (
        <div
            style={{
                width: "100%",
                maxWidth: "100%",
                overflowX: "auto",
                margin: "13px 0",
                border: "1px solid #dce5f0",
                borderRadius: "9px",
            }}
        >
            <table
                {...props}
                style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: "13px",
                    whiteSpace: "normal",
                }}
            />
        </div>
    ),

    // ================== TABLE HEADER ==================
    th: ({ node, ...props }) => (
        <th
            {...props}
            style={{
                padding: "10px 12px",
                borderBottom: "1px solid #dce5f0",
                color: "#355477",
                background: "#edf2f8",
                fontWeight: 700,
                textAlign: "left",
                whiteSpace: "nowrap",
            }}
        />
    ),

    // ================== TABLE CELL ==================
    td: ({ node, ...props }) => (
        <td
            {...props}
            style={{
                padding: "9px 12px",
                borderBottom: "1px solid #e8edf4",
                color: "#3f5066",
                verticalAlign: "top",
            }}
        />
    ),

    // ================== LINKS ==================
    a: ({ node, href, children, ...props }) => (
        <a
            {...props}
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            style={{
                color: "#2867a5",
                textDecoration: "underline",
                textUnderlineOffset: "3px",
                overflowWrap: "anywhere",
            }}
        >
            {children}
        </a>
    ),

    // ================== HORIZONTAL RULE ==================
    hr: () => (
        <hr
            style={{
                margin: "16px 0",
                border: 0,
                borderTop: "1px solid #e1e8f1",
            }}
        />
    ),

    // ================== IMAGE REFERENCES ==================
    img: ({ alt }) => (
        <span>
            {alt ? `[Image: ${alt}]` : "[Image]"}
        </span>
    ),
};

// ================== DOCUMENT ATTACHMENTS ==================
function MessageAttachments({
    attachmentIds,
    documentMap,
}) {
    if (
        !Array.isArray(attachmentIds) ||
        attachmentIds.length === 0
    ) {
        return null;
    }

    return (
        <div
            className="d-flex flex-wrap"
            style={{
                gap: 8,
                marginBottom: 11,
                maxWidth: "100%",
            }}
        >
            {attachmentIds.map((documentId) => {
                const id = String(documentId);
                const document = documentMap[id];

                const filename =
                    document?.originalName ||
                    "Attached document";

                const fileType =
                    document?.fileType ||
                    (
                        filename.toLowerCase().endsWith(".pdf")
                            ? "pdf"
                            : "docx"
                    );

                return (
                    <div
                        key={id}
                        title={filename}
                        className="d-flex align-items-center"
                        style={{
                            gap: 9,
                            minWidth: 0,
                            maxWidth: "100%",
                            padding: "8px 11px",
                            border: "1px solid #d9e3f0",
                            borderRadius: 11,
                            background: "#ffffff",
                        }}
                    >
                        {/* ================== FILE ICON ================== */}
                        <i
                            className={
                                fileType === "pdf"
                                    ? "fa-regular fa-file-pdf"
                                    : "fa-regular fa-file-word"
                            }
                            style={{
                                color:
                                    fileType === "pdf"
                                        ? "#bb5364"
                                        : "#376cbd",
                                fontSize: 18,
                                flexShrink: 0,
                            }}
                            aria-hidden="true"
                        />

                        {/* ================== FILE NAME ================== */}
                        <div
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                minWidth: 0,
                                maxWidth: 215,
                            }}
                        >
                            <strong
                                style={{
                                    color: "#263d5a",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                }}
                            >
                                {filename}
                            </strong>

                            <small
                                style={{
                                    color: "#71839a",
                                    fontSize: 10,
                                }}
                            >
                                {fileType === "pdf"
                                    ? "PDF Document"
                                    : "Word Document"}
                            </small>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// ================== MESSAGE ITEM ==================
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
    // ================== MESSAGE DETAILS ==================
    const isAssistant = item.role === "assistant";

    const content =
        typeof item.content === "string"
            ? item.content
            : "";

    const status = item.status || "completed";

    const statusMessage =
        MESSAGE_STATUSES[status] || "";

    // ================== PROVIDER NAME ==================
    const providerName =
        item.provider === "groq"
            ? "Groq"
            : item.provider === "gemini"
                ? "Gemini"
                : null;

    // ================== RESPONSE ACTIONS ==================
    const canRegenerate =
        isAssistant &&
        showActions &&
        status === "completed" &&
        typeof onRegenerate === "function";

    const canRetry =
        isAssistant &&
        showActions &&
        RETRYABLE_STATUSES.has(status) &&
        typeof onRetry === "function";

    const hasActions =
        canRegenerate ||
        canRetry ||
        (isAssistant && versionCount > 1);

    return (
        <article
            className={`conversation-message conversation-message-${item.role}`}
            style={
                isAssistant
                    ? {
                        width: "100%",
                        maxWidth: "100%",
                    }
                    : undefined
            }
        >
            {/* ================== MESSAGE HEADING ================== */}
            <div className="conversation-message-heading">
                <span>
                    {isAssistant
                        ? "QueryNest AI"
                        : "You"}
                </span>

                <time dateTime={item.createdAt || undefined}>
                    {formatMessageTime(item.createdAt)}
                </time>
            </div>

            {/* ================== MESSAGE CONTENT ================== */}
            <div
                className="conversation-message-content"
                style={{
                    minWidth: 0,
                    whiteSpace: isAssistant
                        ? "normal"
                        : "pre-wrap",
                }}
            >
                {isAssistant ? (
                    content ? (
                        <div
                            className="chat-markdown-content"
                            style={{
                                minWidth: 0,
                                overflowWrap: "anywhere",
                            }}
                        >
                            <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={markdownComponents}
                                skipHtml
                            >
                                {content}
                            </ReactMarkdown>
                        </div>
                    ) : (
                        ["queued", "streaming"].includes(status)
                            ? "Thinking..."
                            : ""
                    )
                ) : (
                    <>
                        {/* ================== UPLOADED FILE PREVIEW ================== */}
                        <MessageAttachments
                            attachmentIds={item.attachmentIds}
                            documentMap={documentMap}
                        />

                        {/* ================== USER MESSAGE TEXT ================== */}
                        <div
                            style={{
                                whiteSpace: "pre-wrap",
                                overflowWrap: "anywhere",
                            }}
                        >
                            {content}
                        </div>
                    </>
                )}
            </div>

            {/* ================== AI MODEL INFORMATION ================== */}
            {isAssistant && providerName && (
                <span
                    style={{
                        padding: "0 4px",
                        color: "#526780",
                        fontSize: "11px",
                        fontWeight: 500,
                        overflowWrap: "anywhere",
                    }}
                >
                    <strong>Model: </strong>
                    {providerName}
                    {item.model ? ` · ${item.model}` : ""}
                </span>
            )}

            {/* ================== RESPONSE STATUS ================== */}
            {isAssistant &&
                status !== "completed" &&
                statusMessage && (
                    <span
                        className="conversation-message-error"
                        style={
                            ["queued", "streaming"].includes(status)
                                ? { color: "#637b96" }
                                : undefined
                        }
                    >
                        {statusMessage}
                    </span>
                )}

            {/* ================== COMPACT RESPONSE ACTIONS ================== */}
            {hasActions && (
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        flexWrap: "wrap",
                        gap: 10,
                        padding: "8px 4px 0",
                    }}
                >
                    {/* ================== RETRY / REGENERATE ================== */}
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 7,
                        }}
                    >
                        {(canRegenerate || canRetry) && (
                            <button
                                type="button"
                                disabled={actionsDisabled}
                                onClick={
                                    canRegenerate
                                        ? onRegenerate
                                        : onRetry
                                }
                                title={
                                    canRegenerate
                                        ? "Regenerate response"
                                        : "Retry response"
                                }
                                style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: 6,
                                    minHeight: 27,
                                    padding: "4px 9px",
                                    border: "1px solid #dbe3ee",
                                    borderRadius: 7,
                                    background: "#ffffff",
                                    color: "#61758f",
                                    fontSize: 11,
                                    fontWeight: 500,
                                    cursor: actionsDisabled
                                        ? "not-allowed"
                                        : "pointer",
                                    opacity: actionsDisabled
                                        ? 0.5
                                        : 1,
                                }}
                            >
                                <i
                                    className="fa-solid fa-arrows-rotate"
                                    aria-hidden="true"
                                />

                                {canRegenerate
                                    ? "Regenerate"
                                    : "Retry"}
                            </button>
                        )}
                    </div>

                    {/* ================== RESPONSE VERSION NAVIGATION ================== */}
                    {isAssistant && versionCount > 1 && (
                        <div
                            className="chat-response-versions"
                            role="group"
                            aria-label="AI response versions"
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "flex-end",
                                gap: 8,
                                marginLeft: "auto",
                            }}
                        >
                            {/* ================== PREVIOUS VERSION ================== */}
                            <button
                                type="button"
                                onClick={onPrevious}
                                disabled={versionIndex === 0}
                                aria-label="Previous AI response version"
                                title="Previous response"
                                style={{
                                    display: "grid",
                                    placeItems: "center",
                                    width: 27,
                                    height: 27,
                                    padding: 0,
                                    border: "1px solid #dce5f0",
                                    borderRadius: 7,
                                    background: "#ffffff",
                                    color: "#49688e",
                                    cursor:
                                        versionIndex === 0
                                            ? "not-allowed"
                                            : "pointer",
                                    opacity:
                                        versionIndex === 0
                                            ? 0.4
                                            : 1,
                                }}
                            >
                                <i
                                    className="fa-solid fa-chevron-left"
                                    aria-hidden="true"
                                />
                            </button>

                            {/* ================== VERSION COUNT ================== */}
                            <span
                                aria-live="polite"
                                style={{
                                    minWidth: 40,
                                    color: "#5e7594",
                                    fontSize: 11,
                                    fontWeight: 600,
                                    textAlign: "center",
                                    fontVariantNumeric: "tabular-nums",
                                }}
                            >
                                {versionIndex + 1} / {versionCount}
                            </span>

                            {/* ================== NEXT VERSION ================== */}
                            <button
                                type="button"
                                onClick={onNext}
                                disabled={
                                    versionIndex === versionCount - 1
                                }
                                aria-label="Next AI response version"
                                title="Next response"
                                style={{
                                    display: "grid",
                                    placeItems: "center",
                                    width: 27,
                                    height: 27,
                                    padding: 0,
                                    border: "1px solid #dce5f0",
                                    borderRadius: 7,
                                    background: "#ffffff",
                                    color: "#49688e",
                                    cursor:
                                        versionIndex === versionCount - 1
                                            ? "not-allowed"
                                            : "pointer",
                                    opacity:
                                        versionIndex === versionCount - 1
                                            ? 0.4
                                            : 1,
                                }}
                            >
                                <i
                                    className="fa-solid fa-chevron-right"
                                    aria-hidden="true"
                                />
                            </button>
                        </div>
                    )}
                </div>
            )}
        </article>
    );
});

// ================== GROUP RESPONSE VERSIONS ==================
function groupMessageVersions(messages) {
    const versionsByReply = new Map();

    // ================== COLLECT AI ATTEMPTS ==================
    for (const item of messages) {
        if (
            item.role !== "assistant" ||
            !item.replyToMessageId
        ) {
            continue;
        }

        const replyId = String(item.replyToMessageId);

        if (!versionsByReply.has(replyId)) {
            versionsByReply.set(replyId, []);
        }

        versionsByReply.get(replyId).push(item);
    }

    // ================== BUILD DISPLAY ITEMS ==================
    const renderedReplies = new Set();
    const displayItems = [];

    for (const item of messages) {
        if (
            item.role === "assistant" &&
            item.replyToMessageId
        ) {
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

// ================== MESSAGE LIST ==================
function MessageList({
    messages = [],
    hasMore = false,
    loadingMore = false,
    onLoadMore,
    onRegenerate,
    onRetry,
    actionsDisabled = false,
}) {
    // ================== RESPONSE VERSION STATE ==================
    const [selectedVersions, setSelectedVersions] = useState({});

    // ================== DOCUMENT METADATA ==================
    const [documentMap, setDocumentMap] = useState({});

    // ================== CONVERSATION ID ==================
    const conversationId = messages.find(
        (item) => item?.conversationId
    )?.conversationId;

    // ================== REFERENCED ATTACHMENTS ==================
    const attachmentKey = messages
        .filter((item) => item?.role === "user")
        .flatMap(
            (item) =>
                Array.isArray(item.attachmentIds)
                    ? item.attachmentIds.map(String)
                    : []
        )
        .join(",");

    // ================== LOAD DOCUMENT NAMES ==================
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
                const response = await getDocuments(
                    String(conversationId),
                    {
                        signal: controller.signal,
                    }
                );

                if (!active) return;

                const documents = Array.isArray(
                    response?.documents
                )
                    ? response.documents
                    : [];

                const lookup = {};

                for (const document of documents) {
                    if (document?._id) {
                        lookup[String(document._id)] = {
                            originalName:
                                document.originalName,
                            fileType:
                                document.fileType,
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

    // ================== GROUP MESSAGES ==================
    const displayItems = useMemo(
        () => groupMessageVersions(messages),
        [messages]
    );

    // ================== LAST USER MESSAGE ==================
    const lastUserMessageId = [...messages]
        .reverse()
        .find((item) => item.role === "user")
        ?._id;

    // ================== SELECT RESPONSE VERSION ==================
    function selectVersion(replyId, versions, index) {
        if (
            !replyId ||
            index < 0 ||
            index >= versions.length
        ) {
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

            {/* ================== LOAD EARLIER MESSAGES ================== */}
            {hasMore && (
                <div className="conversation-load-more">
                    <button
                        type="button"
                        onClick={onLoadMore}
                        disabled={
                            loadingMore ||
                            typeof onLoadMore !== "function"
                        }
                    >
                        {loadingMore
                            ? "Loading..."
                            : "Load Earlier Messages"}
                    </button>
                </div>
            )}

            {/* ================== EMPTY CONVERSATION ================== */}
            {messages.length === 0 && (
                <div className="conversation-empty">
                    <i
                        className="fa-regular fa-comments"
                        aria-hidden="true"
                    />

                    <h2>Start your conversation</h2>

                    <p>Type a message to begin.</p>
                </div>
            )}

            {/* ================== RENDER MESSAGES ================== */}
            {displayItems.map((group) => {
                const { replyId, versions } = group;

                // ================== SELECT LATEST BY DEFAULT ==================
                const savedSelection = replyId
                    ? selectedVersions[replyId]
                    : null;

                const savedIndex =
                    savedSelection?.versionCount === versions.length
                        ? versions.findIndex(
                            (item) =>
                                String(item._id) ===
                                String(savedSelection.messageId)
                        )
                        : -1;

                const versionIndex = savedIndex >= 0
                    ? savedIndex
                    : versions.length - 1;

                const currentMessage = versions[versionIndex];

                const showActions =
                    Boolean(replyId) &&
                    String(replyId) ===
                        String(lastUserMessageId) &&
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
                        onRegenerate={
                            showActions && onRegenerate
                                ? () => onRegenerate(replyId)
                                : undefined
                        }
                        onRetry={
                            showActions && onRetry
                                ? () => onRetry(replyId)
                                : undefined
                        }
                        onPrevious={() =>
                            selectVersion(
                                replyId,
                                versions,
                                versionIndex - 1
                            )
                        }
                        onNext={() =>
                            selectVersion(
                                replyId,
                                versions,
                                versionIndex + 1
                            )
                        }
                    />
                );
            })}
        </div>
    );
}

// ================== EXPORT ==================
export default MessageList;
