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
    const [copyStatus, setCopyStatus] = useState("idle");

    const copyTimeoutRef = useRef(null);

    const codeText = typeof code === "string"
        ? code.replace(/\n$/, "")
        : String(code ?? "");

    const normalizedLanguage = normalizeLanguage(language);

    useEffect(() => {
        return () => {
            if (copyTimeoutRef.current) {
                clearTimeout(copyTimeoutRef.current);
            }
        };
    }, []);

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

        copyTimeoutRef.current = setTimeout(() => {
            setCopyStatus("idle");
        }, 2000);
    }

    return (
        <div className="chat-code-block qn-code-frame">
            <div className="chat-code-header qn-code-toolbar">
                <span className="qn-code-language">
                    {normalizedLanguage === "text"
                        ? "Code"
                        : normalizedLanguage}
                </span>
                <button
                    type="button"
                    className={`chat-code-copy qn-code-copy-button${copyStatus === "copied" ? " qn-code-copied" : ""}`}
                    onClick={handleCopyCode}
                    aria-label="Copy code to clipboard"
                    title="Copy code"
                >
                    <i className={ copyStatus === "copied" ? "fa-solid fa-check" : "fa-regular fa-copy" } aria-hidden="true" />

                    <span aria-live="polite">
                        {copyStatus === "copied"
                            ? "Copied"
                            : copyStatus === "failed"
                                ? "Copy failed"
                                : "Copy"}
                    </span>
                </button>
            </div>
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
