
import { memo } from "react";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import CodeBlock from "./CodeBlock";

// ================== MESSAGE STATUS ==================
const MESSAGE_STATUSES = {
    queued: "Preparing response...",
    streaming: "Generating response...",
    stopped: "Generation stopped.",
    incomplete: "Response incomplete.",
    failed: "Response failed.",
    cancelled: "Generation cancelled.",
};

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

        // ================== LANGUAGE ==================
        const rawClass = codeNode.properties?.className;

        const className = Array.isArray(rawClass)
            ? rawClass.join(" ")
            : String(rawClass || "");

        const language =
            className.match(/language-([a-z0-9+#.-]+)/i)?.[1] ||
            "text";

        // ================== CODE CONTENT ==================
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

// ================== MESSAGE ITEM ==================
const MessageItem = memo(function MessageItem({
    item,
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
                    content
                )}
            </div>

            {/* ================== PROVIDER INFORMATION ================== */}
            {isAssistant && providerName && (
                <span
                    style={{
                        padding: "0 4px",
                        color: "#71839a",
                        fontSize: "11px",
                        overflowWrap: "anywhere",
                    }}
                >
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
        </article>
    );
});

// ================== MESSAGE LIST ==================
function MessageList({
    messages = [],
    hasMore = false,
    loadingMore = false,
    onLoadMore,
}) {
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
            {messages.map((item) => (
                <MessageItem
                    key={item._id}
                    item={item}
                />
            ))}
        </div>
    );
}

// ================== EXPORT ==================
export default MessageList;
