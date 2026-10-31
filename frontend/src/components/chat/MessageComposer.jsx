
import {
    useCallback,
    useLayoutEffect,
    useRef,
} from "react";

import { toast } from "react-toastify";

// ================== FILE LIMITS ==================
const MAX_FILES = 3;
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// ================== TEXTAREA LIMITS ==================
const MIN_TEXTAREA_HEIGHT = 38;
const MAX_TEXTAREA_HEIGHT = 250;

// ================== ALLOWED FILE TYPES ==================
const ALLOWED_EXTENSIONS = new Set([
    "pdf",
    "docx",
]);

// ================== SHOW VALIDATION TOAST ==================
function showFileError(message) {
    toast.error(message, {
        toastId: `composer:${message}`,
    });
}

// ================== FORMAT FILE SIZE ==================
function formatFileSize(bytes) {
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }

    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ================== MESSAGE COMPOSER ==================
function MessageComposer({
    inputId,
    value,
    onChange,
    attachments = [],
    onAttachmentsChange,
    onSubmit,
    inputRef,
    placeholder = "Message QueryNest AI...",
    sending = false,
}) {
    // ================== REFERENCES ==================
    const textareaRef = useRef(null);
    const fileInputRef = useRef(null);

    // ================== CURRENT MESSAGE ==================
    const messageText =
        typeof value === "string" ? value : "";

    const selectedFiles = Array.isArray(attachments)
        ? attachments
        : [];

    const canSend =
        !sending &&
        (
            messageText.trim().length > 0 ||
            selectedFiles.length > 0
        );

    const canAttach =
        !sending &&
        selectedFiles.length < MAX_FILES;

    // ================== CONNECT TEXTAREA REF ==================
    const setTextareaRef = useCallback(
        (element) => {
            textareaRef.current = element;

            if (typeof inputRef === "function") {
                inputRef(element);

            } else if (inputRef) {
                inputRef.current = element;
            }
        },
        [inputRef]
    );

    // ================== AUTO RESIZE TEXTAREA ==================
    useLayoutEffect(() => {
        const textarea = textareaRef.current;

        if (!textarea) return;

        // Reset height before measuring content.
        textarea.style.height = "auto";

        const contentHeight = textarea.scrollHeight;

        const nextHeight = Math.min(
            Math.max(
                contentHeight,
                MIN_TEXTAREA_HEIGHT
            ),
            MAX_TEXTAREA_HEIGHT
        );

        textarea.style.height = `${nextHeight}px`;

        textarea.style.overflowY =
            contentHeight > MAX_TEXTAREA_HEIGHT
                ? "auto"
                : "hidden";

    }, [messageText]);

    // ================== SELECT FILES ==================
    function handleFileSelect(event) {
        const files = Array.from(
            event.target.files || []
        );

        // Allow selecting the same file again later.
        event.target.value = "";

        if (!files.length || sending) {
            return;
        }

        const updatedFiles = [...selectedFiles];

        // ================== VALIDATE EACH FILE ==================
        for (const file of files) {
            const extension = file.name
                .split(".")
                .pop()
                .toLowerCase();

            // ================== FILE TYPE ==================
            if (!ALLOWED_EXTENSIONS.has(extension)) {
                showFileError(
                    "Please upload a PDF or Word document."
                );
                continue;
            }

            // ================== FILE SIZE ==================
            if (
                file.size <= 0 ||
                file.size > MAX_FILE_SIZE
            ) {
                showFileError(
                    "Each document must be smaller than 5 MB."
                );
                continue;
            }

            // ================== DUPLICATE FILE ==================
            const duplicate = updatedFiles.some(
                (existing) =>
                    existing.name === file.name &&
                    existing.size === file.size &&
                    existing.lastModified ===
                        file.lastModified
            );

            if (duplicate) {
                toast.info(
                    "This document is already attached.",
                    {
                        toastId: "composer:duplicate-file",
                    }
                );
                continue;
            }

            // ================== FILE COUNT ==================
            if (updatedFiles.length >= MAX_FILES) {
                showFileError(
                    "You can attach up to 3 documents at a time."
                );
                break;
            }

            updatedFiles.push(file);
        }

        // ================== UPDATE SELECTED FILES ==================
        if (
            typeof onAttachmentsChange === "function"
        ) {
            onAttachmentsChange(updatedFiles);
        }
    }

    // ================== REMOVE FILE ==================
    function handleRemoveFile(fileToRemove) {
        if (
            sending ||
            typeof onAttachmentsChange !== "function"
        ) {
            return;
        }

        onAttachmentsChange(
            selectedFiles.filter(
                (file) => file !== fileToRemove
            )
        );
    }

    // ================== OPEN FILE SELECTOR ==================
    function handleAttachClick() {
        if (!canAttach) return;

        fileInputRef.current?.click();
    }

    // ================== KEYBOARD SUBMIT ==================
    function handleKeyDown(event) {
        if (
            event.key !== "Enter" ||
            event.shiftKey ||
            event.nativeEvent.isComposing
        ) {
            return;
        }

        event.preventDefault();

        if (canSend) {
            event.currentTarget.form?.requestSubmit();
        }
    }

    // ================== COMPOSER UI ==================
    return (
        <form
            className="chat-dashboard-composer"
            onSubmit={onSubmit}
            style={{
                display: "flex",
                flexDirection: "column",
                width: "100%",
                minWidth: 0,
                padding: "9px 11px",
                gap: 7,
                borderRadius: 19,
                border: "1px solid #dce4ee",
                background: "#ffffff",
                boxShadow:
                    "0 3px 16px rgba(25, 45, 75, 0.055)",
            }}
        >
            {/* ================== SELECTED DOCUMENTS ================== */}
            {selectedFiles.length > 0 && (
                <div
                    className="d-flex flex-wrap"
                    style={{
                        gap: 7,
                        paddingBottom: 5,
                    }}
                    aria-label="Selected documents"
                >
                    {selectedFiles.map((file) => {
                        const isPDF = file.name
                            .toLowerCase()
                            .endsWith(".pdf");

                        return (
                            <div
                                key={`${file.name}-${file.size}-${file.lastModified}`}
                                className="d-inline-flex align-items-center"
                                style={{
                                    maxWidth: "100%",
                                    minWidth: 0,
                                    gap: 8,
                                    padding: "6px 8px",
                                    border: "1px solid #e2e8f0",
                                    borderRadius: 10,
                                    background: "#f5f8fc",
                                }}
                            >
                                {/* ================== FILE ICON ================== */}
                                <i
                                    className={
                                        isPDF
                                            ? "fa-regular fa-file-pdf"
                                            : "fa-regular fa-file-word"
                                    }
                                    style={{
                                        color: isPDF
                                            ? "#b45160"
                                            : "#416da0",
                                        fontSize: 15,
                                        flexShrink: 0,
                                    }}
                                    aria-hidden="true"
                                />

                                {/* ================== FILE DETAILS ================== */}
                                <div
                                    style={{
                                        display: "flex",
                                        flexDirection: "column",
                                        minWidth: 0,
                                        maxWidth: 185,
                                    }}
                                >
                                    <span
                                        title={file.name}
                                        style={{
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            whiteSpace: "nowrap",
                                            color: "#34465f",
                                            fontSize: 11,
                                            fontWeight: 600,
                                        }}
                                    >
                                        {file.name}
                                    </span>

                                    <span
                                        style={{
                                            color: "#8593a6",
                                            fontSize: 10,
                                        }}
                                    >
                                        {formatFileSize(file.size)}
                                    </span>
                                </div>

                                {/* ================== REMOVE ATTACHMENT ================== */}
                                <button
                                    type="button"
                                    onClick={() =>
                                        handleRemoveFile(file)
                                    }
                                    disabled={sending}
                                    title="Remove attachment"
                                    aria-label={`Remove ${file.name}`}
                                    style={{
                                        display: "grid",
                                        placeItems: "center",
                                        width: 23,
                                        height: 23,
                                        flexShrink: 0,
                                        padding: 0,
                                        border: "none",
                                        borderRadius: 7,
                                        background: "transparent",
                                        color: "#8795a7",
                                        cursor: sending
                                            ? "not-allowed"
                                            : "pointer",
                                    }}
                                >
                                    <i
                                        className="fa-solid fa-xmark"
                                        aria-hidden="true"
                                    />
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ================== COMPACT MESSAGE ROW ================== */}
            <div
                style={{
                    display: "flex",
                    alignItems: "flex-end",
                    gap: 7,
                    width: "100%",
                    minWidth: 0,
                }}
            >
                {/* ================== ATTACH FILE BUTTON ================== */}
                <button
                    type="button"
                    className="chat-composer-attach"
                    onClick={handleAttachClick}
                    disabled={!canAttach}
                    title={
                        canAttach
                            ? "Attach PDF or Word document"
                            : "Attachment limit reached"
                    }
                    aria-label="Attach PDF or Word document"
                    style={{
                        display: "grid",
                        placeItems: "center",
                        flexShrink: 0,
                        width: 35,
                        height: 35,
                        minHeight: 35,
                        padding: 0,
                        border: "none",
                        borderRadius: 11,
                        background: "#f1f5fa",
                        color: "#526a88",
                        fontSize: 15,
                        opacity: canAttach ? 1 : 0.45,
                    }}
                >
                    <i
                        className="fa-solid fa-paperclip"
                        aria-hidden="true"
                    />
                </button>

                {/* ================== MESSAGE TEXTAREA ================== */}
                <div
                    style={{
                        flex: 1,
                        minWidth: 0,
                        alignSelf: "center",
                    }}
                >
                    <label
                        htmlFor={inputId}
                        className="visually-hidden"
                    >
                        Type your message
                    </label>

                    <textarea
                        id={inputId}
                        ref={setTextareaRef}
                        value={messageText}
                        onChange={onChange}
                        onKeyDown={handleKeyDown}
                        placeholder={placeholder}
                        rows={1}
                        maxLength={100000}
                        disabled={sending}
                        aria-label="Message QueryNest AI"
                        style={{
                            display: "block",
                            boxSizing: "border-box",
                            width: "100%",
                            height: MIN_TEXTAREA_HEIGHT,
                            minHeight: MIN_TEXTAREA_HEIGHT,
                            maxHeight: MAX_TEXTAREA_HEIGHT,
                            margin: 0,
                            padding: "6px 2px",
                            border: "none",
                            outline: "none",
                            resize: "none",
                            background: "transparent",
                            color: "#27384f",
                            fontFamily: "inherit",
                            fontSize: 14,
                            fontWeight: 400,
                            lineHeight: "22px",
                            overflowX: "hidden",
                            overflowY: "hidden",
                        }}
                    />
                </div>

                {/* ================== SEND MESSAGE BUTTON ================== */}
                <button
                    type="submit"
                    className="chat-composer-send"
                    disabled={!canSend}
                    title={
                        sending
                            ? "Sending message"
                            : "Send message"
                    }
                    aria-label={
                        sending
                            ? "Sending message"
                            : "Send message"
                    }
                    style={{
                        display: "grid",
                        placeItems: "center",
                        flexShrink: 0,
                        width: 35,
                        height: 35,
                        minHeight: 35,
                        padding: 0,
                        border: "none",
                        borderRadius: 11,
                        background: canSend
                            ? "#355d8a"
                            : "#edf1f5",
                        color: canSend
                            ? "#ffffff"
                            : "#a2aec0",
                        fontSize: 15,
                        cursor: canSend
                            ? "pointer"
                            : "not-allowed",
                    }}
                >
                    <i
                        className={
                            sending
                                ? "fa-solid fa-spinner fa-spin"
                                : "fa-solid fa-arrow-up"
                        }
                        aria-hidden="true"
                    />
                </button>
            </div>

            {/* ================== HIDDEN FILE INPUT ================== */}
            <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                multiple
                hidden
                disabled={sending}
                onChange={handleFileSelect}
                aria-label="Select PDF or Word documents"
            />
        </form>
    );
}

export default MessageComposer;
