
import { useEffect, useRef, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";

// ================== LANGUAGE ALIASES ==================
const LANGUAGE_ALIASES = {
    js: "javascript",
    ts: "typescript",
    py: "python",
    sh: "bash",
    shell: "bash",
    html: "markup",
    xml: "markup",
    yml: "yaml",
    md: "markdown",
    plaintext: "text",
};

// ================== NORMALIZE LANGUAGE ==================
function normalizeLanguage(language) {
    if (typeof language !== "string") {
        return "text";
    }

    const value = language.trim().toLowerCase();

    if (!/^[a-z0-9+#.-]{1,30}$/.test(value)) {
        return "text";
    }

    return LANGUAGE_ALIASES[value] || value;
}

// ================== CODE BLOCK ==================
function CodeBlock({ code = "", language = "text" }) {
    // ================== STATE ==================
    const [copyStatus, setCopyStatus] = useState("idle");

    // ================== REFERENCES ==================
    const copyTimeoutRef = useRef(null);

    // ================== CODE DATA ==================
    const codeText = typeof code === "string"
        ? code.replace(/\n$/, "")
        : String(code ?? "");

    const normalizedLanguage = normalizeLanguage(language);

    // ================== CLEANUP ==================
    useEffect(() => {
        return () => {
            if (copyTimeoutRef.current) {
                clearTimeout(copyTimeoutRef.current);
            }
        };
    }, []);

    // ================== COPY CODE ==================
    async function handleCopyCode() {
        if (copyTimeoutRef.current) {
            clearTimeout(copyTimeoutRef.current);
        }

        try {
            if (!navigator.clipboard?.writeText) {
                throw new Error("Clipboard API unavailable.");
            }

            await navigator.clipboard.writeText(codeText);

            setCopyStatus("copied");
        } catch {
            setCopyStatus("failed");
        }

        // ================== RESET COPY STATUS ==================
        copyTimeoutRef.current = setTimeout(() => {
            setCopyStatus("idle");
        }, 2000);
    }

    return (
        <div
            className="chat-code-block"
            style={{
                width: "100%",
                minWidth: 0,
                overflow: "hidden",
                margin: "14px 0",
                border: "1px solid #dce5f0",
                borderRadius: "12px",
                background: "#f8fafc",
            }}
        >
            {/* ================== CODE HEADER ================== */}
            <div
                className="chat-code-header"
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "12px",
                    minHeight: "43px",
                    padding: "7px 13px",
                    background: "#edf2f8",
                    borderBottom: "1px solid #dce5f0",
                }}
            >
                {/* ================== LANGUAGE NAME ================== */}
                <span
                    style={{
                        color: "#516a89",
                        fontSize: "12px",
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.3px",
                    }}
                >
                    {normalizedLanguage === "text"
                        ? "Code"
                        : normalizedLanguage}
                </span>

                {/* ================== COPY BUTTON ================== */}
                <button
                    type="button"
                    className="chat-code-copy"
                    onClick={handleCopyCode}
                    aria-label="Copy code to clipboard"
                    title="Copy code"
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "7px",
                        minHeight: "30px",
                        padding: "5px 10px",
                        border: "1px solid #cbd8e8",
                        borderRadius: "7px",
                        background: "#ffffff",
                        color: copyStatus === "copied"
                            ? "#0f766e"
                            : "#395578",
                        fontFamily: "inherit",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: "pointer",
                    }}
                >
                    <i
                        className={
                            copyStatus === "copied"
                                ? "fa-solid fa-check"
                                : "fa-regular fa-copy"
                        }
                        aria-hidden="true"
                    />

                    <span aria-live="polite">
                        {copyStatus === "copied"
                            ? "Copied"
                            : copyStatus === "failed"
                                ? "Copy failed"
                                : "Copy"}
                    </span>
                </button>
            </div>

            {/* ================== SYNTAX HIGHLIGHTER ================== */}
            <SyntaxHighlighter
                language={normalizedLanguage}
                style={oneLight}
                showLineNumbers={false}
                wrapLongLines={false}
                customStyle={{
                    margin: 0,
                    padding: "16px",
                    background: "#f8fafc",
                    fontSize: "13px",
                    lineHeight: "1.7",
                    maxHeight: "380px",
                    overflowX: "auto",
                    overflowY: "auto",
                    whiteSpace: "pre",
                    scrollbarWidth: "thin",
                    scrollbarColor: "#b6c5d8 #f8fafc",
                }}
                codeTagProps={{
                    style: {
                        fontFamily:
                            "Consolas, Monaco, 'Courier New', monospace",
                    },
                }}
            >
                {codeText}
            </SyntaxHighlighter>
        </div>
    );
}

// ================== EXPORT ==================
export default CodeBlock;
