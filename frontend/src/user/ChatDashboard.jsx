
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

import { useAuth } from "../context/AuthContext";
import MessageComposer from "../components/chat/MessageComposer";

import {
    createConversation,
    sendMessage,
    generateChatRequestId,
} from "../services/chatService";

import {
    uploadDocuments,
} from "../services/documentService";

// ================== STARTER PROMPTS ==================
const starterPrompts = [
    {
        title: "Ask Anything",
        description: "Explore ideas and get helpful answers.",
        icon: "fa-regular fa-comments",
        prompt: "Can you help me understand a topic step by step?",
    },
    {
        title: "Explain Code",
        description: "Understand logic, errors and solutions.",
        icon: "fa-solid fa-code",
        prompt: "Can you explain this code and suggest improvements?",
    },
    {
        title: "Explore Documents",
        description: "Ask questions and summarize documents.",
        icon: "fa-regular fa-file-lines",
        prompt: "Please summarize the important points in my document.",
    },
    {
        title: "Review Resume",
        description: "Improve your resume and interview skills.",
        icon: "fa-regular fa-file",
        prompt: "Can you review my resume and suggest improvements?",
    },
];

// ================== DOCUMENT SETTINGS ==================
const MAX_DOCUMENTS = 3;
const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

// ================== ERROR MESSAGE ==================
function getErrorMessage(error, fallback) {
    return (
        error?.response?.data?.message ||
        error?.message ||
        fallback
    );
}

// ================== CHAT DASHBOARD ==================
function ChatDashboard() {
    const navigate = useNavigate();
    const { user } = useAuth();

    // ================== COMPOSER STATE ==================
    const [message, setMessage] = useState("");
    const [attachments, setAttachments] = useState([]);
    const [sending, setSending] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(null);

    // ================== REFERENCES ==================
    const inputRef = useRef(null);
    const sendingRef = useRef(false);
    const requestIdRef = useRef(null);
    const uploadControllerRef = useRef(null);

    const firstName =
        user?.name?.trim().split(/\s+/)[0] || "there";

    // ================== CLEANUP UPLOAD ==================
    useEffect(() => {
        return () => {
            uploadControllerRef.current?.abort();
            uploadControllerRef.current = null;
        };
    }, []);

    // ================== MESSAGE INPUT ==================
    const handleMessageChange = (event) => {
        if (sendingRef.current) return;

        setMessage(event.target.value);
        requestIdRef.current = null;
    };

    // ================== ATTACHMENTS ==================
    const handleAttachmentsChange = (files) => {
        if (sendingRef.current) return;

        setAttachments(files);
        requestIdRef.current = null;
    };

    // ================== STARTER PROMPT ==================
    const handleStarterPrompt = (prompt) => {
        if (sendingRef.current) return;

        setMessage(prompt);
        requestIdRef.current = null;

        inputRef.current?.focus();
    };

    // ================== CANCEL UPLOAD ==================
    const handleCancelUpload = () => {
        uploadControllerRef.current?.abort();
    };

    // ================== NAVIGATE TO CONVERSATION ==================
    const openConversation = (
        conversationId,
        initialMessageId = null
    ) => {
        navigate(`/chat/${conversationId}`, {
            replace: true,
            state: initialMessageId
                ? {
                    autoGenerateMessageId: initialMessageId,
                }
                : null,
        });
    };

    // ================== CREATE NORMAL CHAT ==================
    const createNormalChat = async (
        content,
        clientRequestId
    ) => {
        const response = await createConversation(
            content,
            clientRequestId
        );

        const conversationId = response?.conversation?._id;

        if (
            typeof conversationId !== "string" ||
            !OBJECT_ID_PATTERN.test(conversationId)
        ) {
            throw new Error(
                "Conversation ID was not returned correctly."
            );
        }

        const initialMessageId =
            response?.initialMessage?._id;

        if (
            typeof initialMessageId !== "string" ||
            !OBJECT_ID_PATTERN.test(initialMessageId)
        ) {
            // Chat may already exist, so preserve access.
            openConversation(conversationId);

            toast.error(
                "Chat created, but the initial message could not be verified."
            );

            return;
        }

        // ================== START AI GENERATION ==================
        openConversation(
            conversationId,
            initialMessageId
        );
    };

    // ================== CREATE DOCUMENT CHAT ==================
    const createDocumentChat = async (
        files,
        content,
        clientRequestId
    ) => {
        // ================== UPLOAD CONTROLLER ==================
        const controller = new AbortController();

        uploadControllerRef.current = controller;
        setUploadProgress(0);

        let uploadedConversationId = null;

        try {
            // ================== UPLOAD AND INDEX DOCUMENTS ==================
            const uploadResponse = await uploadDocuments(
                files,
                {
                    signal: controller.signal,

                    onUploadProgress: (progress) => {
                        if (!controller.signal.aborted) {
                            setUploadProgress(progress);
                        }
                    },
                }
            );

            // ================== VERIFY CONVERSATION ==================
            uploadedConversationId =
                uploadResponse?.conversationId ||
                uploadResponse?.conversation?._id;

            if (
                typeof uploadedConversationId !== "string" ||
                !OBJECT_ID_PATTERN.test(uploadedConversationId)
            ) {
                throw new Error(
                    "Uploaded conversation ID was not returned correctly."
                );
            }

            // ================== VERIFY DOCUMENTS ==================
            const documents = uploadResponse?.documents;

            if (
                !Array.isArray(documents) ||
                documents.length !== files.length ||
                documents.length > MAX_DOCUMENTS
            ) {
                throw new Error(
                    "Uploaded document details are incomplete."
                );
            }

            const documentIds = documents.map(
                (document) => document._id
            );

            if (
                documentIds.some(
                    (id) =>
                        typeof id !== "string" ||
                        !OBJECT_ID_PATTERN.test(id)
                ) ||
                new Set(documentIds).size !== documentIds.length
            ) {
                throw new Error(
                    "Uploaded document IDs are invalid."
                );
            }

            if (controller.signal.aborted) {
                throw new DOMException(
                    "Upload cancelled.",
                    "AbortError"
                );
            }

            // ================== UPLOAD COMPLETED ==================
            setUploadProgress(null);
            uploadControllerRef.current = null;

            // ================== SAVE USER MESSAGE ==================
            const messageResponse = await sendMessage(
                uploadedConversationId,
                content,
                clientRequestId,
                documentIds
            );

            const savedMessageId =
                messageResponse?.userMessage?._id;

            if (
                typeof savedMessageId !== "string" ||
                !OBJECT_ID_PATTERN.test(savedMessageId)
            ) {
                throw new Error(
                    "Saved document message was not returned correctly."
                );
            }

            // ================== START AI GENERATION ==================
            openConversation(
                uploadedConversationId,
                savedMessageId
            );

        } catch (error) {
            // ================== PRESERVE UPLOADED DOCUMENTS ==================
            if (uploadedConversationId) {
                toast.error(
                    "Documents were uploaded, but the chat message could not be completed. Open the conversation and try again."
                );

                openConversation(uploadedConversationId);
                return;
            }

            throw error;

        } finally {
            if (uploadControllerRef.current === controller) {
                uploadControllerRef.current = null;
            }

            setUploadProgress(null);
        }
    };

    // ================== SEND MESSAGE ==================
    const handleSubmit = async (event) => {
        event.preventDefault();

        if (sendingRef.current) return;

        const content = message.trim();
        const selectedFiles = [...attachments];

        if (!content && !selectedFiles.length) {
            return;
        }

        if (selectedFiles.length > MAX_DOCUMENTS) {
            toast.error(
                "Maximum 3 documents are allowed."
            );
            return;
        }

        // ================== FILE-ONLY MESSAGE ==================
        const finalContent = content ||
            "Please summarize the attached document(s).";

        sendingRef.current = true;
        setSending(true);

        try {
            // ================== IDEMPOTENT REQUEST ID ==================
            if (!requestIdRef.current) {
                requestIdRef.current =
                    generateChatRequestId();
            }

            const clientRequestId =
                requestIdRef.current;

            // ================== DOCUMENT OR NORMAL CHAT ==================
            if (selectedFiles.length) {
                await createDocumentChat(
                    selectedFiles,
                    finalContent,
                    clientRequestId
                );
            } else {
                await createNormalChat(
                    finalContent,
                    clientRequestId
                );
            }

        } catch (error) {
            const cancelled =
                error?.name === "AbortError" ||
                error?.name === "CanceledError" ||
                error?.code === "ERR_CANCELED";

            if (cancelled) {
                toast.info(
                    "Document upload cancelled."
                );
            } else {
                toast.error(
                    getErrorMessage(
                        error,
                        "Unable to start conversation. Please try again."
                    )
                );
            }

        } finally {
            sendingRef.current = false;
            setSending(false);
        }
    };

    // ================== COMPONENT UI ==================
    return (
        <section
            className="chat-dashboard"
            aria-labelledby="chat-dashboard-title"
        >
            <div className="chat-dashboard-container">

                {/* ================== WELCOME ================== */}
                <div className="chat-dashboard-welcome">
                    <h1 id="chat-dashboard-title">
                        What can I help you with,
                        <span> {firstName}?</span>
                    </h1>

                    <p>
                        Ask questions, explore ideas, understand code
                        and work smarter with QueryNest AI.
                    </p>
                </div>

                {/* ================== STARTER CARDS ================== */}
                <div
                    className="chat-starter-grid"
                    aria-label="Suggested prompts"
                >
                    {starterPrompts.map((item) => (
                        <button
                            key={item.title}
                            type="button"
                            className="chat-starter-card"
                            onClick={() =>
                                handleStarterPrompt(item.prompt)
                            }
                            disabled={sending}
                        >
                            <span
                                className="chat-starter-icon"
                                aria-hidden="true"
                            >
                                <i className={item.icon} />
                            </span>

                            <span className="chat-starter-details">
                                <strong>{item.title}</strong>
                                <small>{item.description}</small>
                            </span>

                            <i
                                className="fa-solid fa-arrow-up-right-from-square chat-starter-arrow"
                                aria-hidden="true"
                            />
                        </button>
                    ))}
                </div>

                {/* ================== MESSAGE COMPOSER ================== */}
                <MessageComposer
                    inputId="new-chat-message"
                    inputRef={inputRef}
                    value={message}
                    onChange={handleMessageChange}
                    attachments={attachments}
                    onAttachmentsChange={handleAttachmentsChange}
                    onSubmit={handleSubmit}
                    placeholder="Ask QueryNest AI anything..."
                    sending={sending}
                />

                {/* ================== UPLOAD PROGRESS ================== */}
                {uploadProgress !== null && (
                    <div
                        className="d-flex flex-wrap align-items-center justify-content-center gap-3 mt-3"
                        role="status"
                        aria-live="polite"
                    >
                        <span className="text-secondary small">
                            {uploadProgress < 100
                                ? `Uploading documents: ${uploadProgress}%`
                                : "Processing documents and generating embeddings..."}
                        </span>

                        <button
                            type="button"
                            className="btn btn-sm btn-outline-secondary"
                            onClick={handleCancelUpload}
                        >
                            <i
                                className="fa-solid fa-xmark me-1"
                                aria-hidden="true"
                            />
                            Cancel Upload
                        </button>
                    </div>
                )}

                {/* ================== FOOTNOTE ================== */}
                <p className="chat-dashboard-note">
                    QueryNest AI can make mistakes.
                    Verify important information.
                </p>
            </div>
        </section>
    );
}

export default ChatDashboard;
