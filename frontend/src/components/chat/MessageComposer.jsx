import { DOCUMENT_LIMITS, COMPOSER_LIMITS } from "../../config/appConfig";
import { useImperativeHandle, useLayoutEffect, useRef } from "react";

import { toast } from "react-toastify";

// File limits
const MAX_FILES = DOCUMENT_LIMITS.maxFiles;
const MAX_FILE_SIZE = DOCUMENT_LIMITS.maxFileSize;

// Textarea limits
const MIN_TEXTAREA_HEIGHT = COMPOSER_LIMITS.minHeight;
const MAX_TEXTAREA_HEIGHT = COMPOSER_LIMITS.maxHeight;

// Allowed file types
const ALLOWED_EXTENSIONS = new Set(DOCUMENT_LIMITS.extensions);

// Show validation toast
function showFileError(message) {
    toast.error(message, {
        toastId: `composer:${message}`,
    });
}

// Format file size
function formatFileSize(bytes) {
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }

    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// Message composer
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
    const textareaRef = useRef(null);
    const fileInputRef = useRef(null);

    const messageText = typeof value === "string" ? value : "";

    const selectedFiles = Array.isArray(attachments) ? attachments : [];

    const canSend = !sending && (messageText.trim().length > 0 || selectedFiles.length > 0);

    const canAttach = !sending && selectedFiles.length < MAX_FILES;

    useImperativeHandle(inputRef, () => textareaRef.current, []);

    useLayoutEffect(() => {
        const textarea = textareaRef.current;

        if (!textarea) return;

        // Reset height before measuring content.
        textarea.style.height = "auto";

        const contentHeight = textarea.scrollHeight;

        const nextHeight = Math.min(Math.max(contentHeight, MIN_TEXTAREA_HEIGHT), MAX_TEXTAREA_HEIGHT);

        textarea.style.height = `${nextHeight}px`;

        textarea.style.overflowY = contentHeight > MAX_TEXTAREA_HEIGHT ? "auto" : "hidden";
    }, [messageText]);

    function handleFileSelect(event) {
        const files = Array.from(event.target.files || []);

        // Allow selecting the same file again later.
        event.target.value = "";

        if (!files.length || sending) {
            return;
        }

        const updatedFiles = [...selectedFiles];

        for (const file of files) {
            const extension = file.name.split(".").pop().toLowerCase();

            if (!ALLOWED_EXTENSIONS.has(extension)) {
                showFileError("Please upload a PDF or Word document.");
                continue;
            }

            if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
                showFileError("Each document must be smaller than 5 MB.");
                continue;
            }

            const duplicate = updatedFiles.some(
                (existing) =>
                    existing.name === file.name &&
                    existing.size === file.size &&
                    existing.lastModified === file.lastModified
            );

            if (duplicate) {
                toast.info("This document is already attached.", {
                    toastId: "composer:duplicate-file",
                });
                continue;
            }

            if (updatedFiles.length >= MAX_FILES) {
                showFileError("You can attach up to 3 documents at a time.");
                break;
            }

            updatedFiles.push(file);
        }

        if (typeof onAttachmentsChange === "function") {
            onAttachmentsChange(updatedFiles);
        }
    }

    function handleRemoveFile(fileToRemove) {
        if (sending || typeof onAttachmentsChange !== "function") {
            return;
        }

        onAttachmentsChange(selectedFiles.filter((file) => file !== fileToRemove));
    }

    function handleAttachClick() {
        if (!canAttach) return;

        fileInputRef.current?.click();
    }

    function handleKeyDown(event) {
        if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
            return;
        }

        event.preventDefault();

        if (canSend) {
            event.currentTarget.form?.requestSubmit();
        }
    }

    return (
        <form className="chat-dashboard-composer qn-composer-shell" onSubmit={onSubmit}>
            {selectedFiles.length > 0 && (
                <div className="d-flex flex-wrap qn-composer-documents" aria-label="Selected documents">
                    {selectedFiles.map((file) => {
                        const isPDF = file.name.toLowerCase().endsWith(".pdf");

                        return (
                            <div
                                key={`${file.name}-${file.size}-${file.lastModified}`}
                                className="d-inline-flex align-items-center qn-composer-document"
                            >
                                <i
                                    className={`${isPDF ? "fa-regular fa-file-pdf" : "fa-regular fa-file-word"} qn-composer-file-icon`}
                                    aria-hidden="true"
                                />
                                <div className="qn-composer-file-details">
                                    <span className="qn-composer-file-name" title={file.name}>
                                        {file.name}
                                    </span>

                                    <span className="qn-composer-file-size">{formatFileSize(file.size)}</span>
                                </div>
                                <button
                                    className="qn-composer-remove-file"
                                    type="button"
                                    onClick={() => handleRemoveFile(file)}
                                    disabled={sending}
                                    title="Remove attachment"
                                    aria-label={`Remove ${file.name}`}
                                >
                                    <i className="fa-solid fa-xmark" aria-hidden="true" />
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
            <div className="qn-composer-input-row">
                <button
                    type="button"
                    className="chat-composer-attach qn-composer-attach-button"
                    onClick={handleAttachClick}
                    disabled={!canAttach}
                    title={canAttach ? "Attach PDF or Word document" : "Attachment limit reached"}
                    aria-label="Attach PDF or Word document"
                >
                    <i className="fa-solid fa-paperclip" aria-hidden="true" />
                </button>
                <div className="qn-composer-input-wrap">
                    <label htmlFor={inputId} className="visually-hidden">
                        Type your message
                    </label>

                    <textarea
                        className="qn-composer-textarea"
                        id={inputId}
                        ref={textareaRef}
                        value={messageText}
                        onChange={onChange}
                        onKeyDown={handleKeyDown}
                        placeholder={placeholder}
                        rows={1}
                        maxLength={100000}
                        disabled={sending}
                        aria-label="Message QueryNest AI"
                    />
                </div>
                <button
                    type="submit"
                    className="chat-composer-send qn-composer-send-button"
                    disabled={!canSend}
                    title={sending ? "Sending message" : "Send message"}
                    aria-label={sending ? "Sending message" : "Send message"}
                >
                    <i
                        className={sending ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-arrow-up"}
                        aria-hidden="true"
                    />
                </button>
            </div>
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
