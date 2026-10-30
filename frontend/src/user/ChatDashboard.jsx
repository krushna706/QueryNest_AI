
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

import { useAuth } from "../context/AuthContext";
import MessageComposer from "../components/chat/MessageComposer";

import {
    createConversation,
    generateChatRequestId,
} from "../services/chatService";

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

// ================== CHAT DASHBOARD ==================
function ChatDashboard() {
    const navigate = useNavigate();
    const { user } = useAuth();

    // ================== STATE ==================
    const [message, setMessage] = useState("");
    const [attachments, setAttachments] = useState([]);
    const [sending, setSending] = useState(false);

    // ================== REFERENCES ==================
    const inputRef = useRef(null);
    const sendingRef = useRef(false);
    const requestIdRef = useRef(null);

    // ================== USER NAME ==================
    const firstName =
        user?.name?.trim().split(/\s+/)[0] || "there";

    // ================== MESSAGE INPUT ==================
    const handleMessageChange = (event) => {
        setMessage(event.target.value);
        requestIdRef.current = null;
    };

    // ================== ATTACHMENTS ==================
    const handleAttachmentsChange = (files) => {
        setAttachments(files);
    };

    // ================== STARTER PROMPT ==================
    const handleStarterPrompt = (prompt) => {
        if (sendingRef.current) return;

        setMessage(prompt);
        requestIdRef.current = null;

        inputRef.current?.focus();
    };

    // ================== CREATE CONVERSATION ==================
    const handleSubmit = async (event) => {
        event.preventDefault();

        // ================== PREVENT DUPLICATE SUBMIT ==================
        if (sendingRef.current) return;

        const content = message.trim();

        if (!content && !attachments.length) {
            return;
        }

        // ================== DOCUMENTS PENDING ==================
        if (attachments.length > 0) {
            toast.info(
                "PDF and Word document sending will be available after upload integration."
            );
            return;
        }

        // ================== START REQUEST ==================
        sendingRef.current = true;
        setSending(true);

        try {
            // ================== REQUEST ID ==================
            if (!requestIdRef.current) {
                requestIdRef.current =
                    generateChatRequestId();
            }

            // ================== SAVE FIRST MESSAGE ==================
            const response = await createConversation(
                content,
                requestIdRef.current
            );

            const conversationId =
                response.conversation?._id;

            const initialMessageId =
                response.initialMessage?._id;

            // ================== VALIDATE CONVERSATION ==================
            if (!conversationId) {
                throw new Error(
                    "Conversation ID was not returned."
                );
            }

            // ================== HANDLE MISSING MESSAGE ID ==================
            // The conversation may have been created successfully.
            // Do not create another conversation by retrying automatically.
            if (!initialMessageId) {
                toast.info(
                    "Conversation created. Open the chat to generate the AI response."
                );

                navigate(`/chat/${conversationId}`, {
                    replace: true,
                });

                return;
            }

            // ================== OPEN CONVERSATION ==================
            // Pass the saved message ID to Conversation.jsx.
            // The existing user message must not be saved again.
            navigate(`/chat/${conversationId}`, {
                replace: true,
                state: {
                    autoGenerateMessageId: initialMessageId,
                },
            });

        } catch (error) {
            // ================== ERROR NOTIFICATION ==================
            toast.error(
                error.response?.data?.message ||
                error.message ||
                "Unable to start conversation. Please try again."
            );
        } finally {
            // ================== RESET REQUEST STATE ==================
            sendingRef.current = false;
            setSending(false);
        }
    };

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
                    onAttachmentsChange={
                        handleAttachmentsChange
                    }
                    onSubmit={handleSubmit}
                    placeholder="Ask QueryNest AI anything..."
                    sending={sending}
                />

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
