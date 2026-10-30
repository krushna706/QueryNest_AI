
import { useRef } from "react";
import { toast } from "react-toastify";

// ================== FILE LIMITS ==================
const MAX_FILES = 3;
const MAX_FILE_SIZE = 5 * 1024 * 1024;

const allowedTypes = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

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
    const fileInputRef = useRef(null);

    // ================== FILE VALIDATION ==================
    const handleFileSelect = (event) => {
        const selectedFiles = Array.from(event.target.files || []);

        event.target.value = "";

        if (!selectedFiles.length || sending) return;

        const updatedFiles = [...attachments];

        for (const file of selectedFiles) {
            const extension = file.name
                .split(".")
                .pop()
                .toLowerCase();

            const expectedType = allowedTypes[extension];

            if (
                !expectedType ||
                (file.type && file.type !== expectedType)
            ) {
                toast.error("Only PDF and Word (.docx) files are allowed.");
                continue;
            }

            if (file.size === 0 || file.size > MAX_FILE_SIZE) {
                toast.error(
                    `${file.name}: Maximum file size is 5 MB.`
                );
                continue;
            }

            const isDuplicate = updatedFiles.some(
                (item) =>
                    item.name === file.name &&
                    item.size === file.size &&
                    item.lastModified === file.lastModified
            );

            if (isDuplicate) {
                toast.info(`${file.name} is already selected.`);
                continue;
            }

            if (updatedFiles.length >= MAX_FILES) {
                toast.error("Maximum 3 documents are allowed.");
                break;
            }

            updatedFiles.push(file);
        }

        onAttachmentsChange(updatedFiles);
    };

    // ================== REMOVE FILE ==================
    const handleRemoveFile = (fileToRemove) => {
        onAttachmentsChange(
            attachments.filter((file) => file !== fileToRemove)
        );
    };

    // ================== KEYBOARD SUBMIT ==================
    const handleKeyDown = (event) => {
        if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
        ) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
        }
    };

    // ================== FILE SIZE ==================
    const formatFileSize = (size) => {
        if (size < 1024 * 1024) {
            return `${(size / 1024).toFixed(1)} KB`;
        }

        return `${(size / (1024 * 1024)).toFixed(2)} MB`;
    };

    return (
        <form
            className="chat-dashboard-composer"
            onSubmit={onSubmit}
        >
            {/* ================== ATTACHMENTS ================== */}
            {attachments.length > 0 && (
                <div className="chat-attachment-section">
                    <div className="chat-attachment-list">
                        {attachments.map((file) => {
                            const isPDF = file.name
                                .toLowerCase()
                                .endsWith(".pdf");

                            return (
                                <div
                                    key={`${file.name}-${file.size}-${file.lastModified}`}
                                    className="chat-attachment-item"
                                >
                                    <span
                                        className="chat-attachment-icon"
                                        aria-hidden="true"
                                    >
                                        <i
                                            className={
                                                isPDF
                                                    ? "fa-regular fa-file-pdf"
                                                    : "fa-regular fa-file-word"
                                            }
                                        />
                                    </span>

                                    <span className="chat-attachment-details">
                                        <strong title={file.name}>
                                            {file.name}
                                        </strong>

                                        <small>
                                            {formatFileSize(file.size)}
                                        </small>
                                    </span>

                                    <button
                                        type="button"
                                        className="chat-attachment-remove"
                                        onClick={() =>
                                            handleRemoveFile(file)
                                        }
                                        disabled={sending}
                                        aria-label={`Remove ${file.name}`}
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

                    <p className="chat-attachment-notice">
                        Document sending will be available after
                        upload integration.
                    </p>
                </div>
            )}

            {/* ================== MESSAGE INPUT ================== */}
            <label
                htmlFor={inputId}
                className="visually-hidden"
            >
                Type your message
            </label>

            <textarea
                id={inputId}
                ref={inputRef}
                value={value}
                onChange={onChange}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                rows={3}
                maxLength={100000}
                disabled={sending}
            />

            {/* ================== FILE INPUT ================== */}
            <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                multiple
                hidden
                onChange={handleFileSelect}
                aria-label="Select PDF or Word documents"
            />

            {/* ================== COMPOSER FOOTER ================== */}
            <div className="chat-composer-footer">
                <div className="chat-composer-tools">
                    <button
                        type="button"
                        className="chat-composer-attach"
                        onClick={() =>
                            fileInputRef.current?.click()
                        }
                        disabled={
                            sending ||
                            attachments.length >= MAX_FILES
                        }
                        title="Attach PDF or Word document"
                    >
                        <i
                            className="fa-solid fa-paperclip"
                            aria-hidden="true"
                        />

                        <span>Attach File</span>
                    </button>

                    <span className="chat-composer-hint">
                        PDF, DOCX · Max 3 files · 5 MB each
                    </span>
                </div>

                <button
                    type="submit"
                    className="chat-composer-send"
                    disabled={
                        (!value.trim() && !attachments.length) ||
                        sending
                    }
                    aria-label={
                        sending ? "Sending message" : "Send message"
                    }
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
        </form>
    );
}

export default MessageComposer;
