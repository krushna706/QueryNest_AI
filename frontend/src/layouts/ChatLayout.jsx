
import { useCallback, useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import {
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    IconButton,
    useMediaQuery,
} from "@mui/material";

import { useAuth } from "../context/AuthContext";
import ChatSidebar from "../components/chat/ChatSidebar";
import ChatHistory from "../components/chat/ChatHistory";

import "../css/panel.css";

// ================== CHAT LAYOUT ==================
function ChatLayout() {
    const isMobile = useMediaQuery("(max-width: 767.98px)");
    const location = useLocation();
    const navigate = useNavigate();
    const { user } = useAuth();

    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [search, setSearch] = useState("");
    const [newChatKey, setNewChatKey] = useState(0);
    const [authDialogOpen, setAuthDialogOpen] = useState(false);

    const isGuest = !user;

    // ================== AUTHENTICATION REQUIRED ==================
    const requireAuth = useCallback(() => {
        if (user) {
            return true;
        }

        setMobileOpen(false);
        setAuthDialogOpen(true);

        return false;
    }, [user]);

    // ================== AUTH DIALOG ==================
    const handleCloseAuthDialog = () => {
        setAuthDialogOpen(false);
    };

    const handleAuthNavigation = (path) => {
        setAuthDialogOpen(false);
        setMobileOpen(false);
        navigate(path);
    };

    // ================== PROTECTED ROUTE FEEDBACK ==================
    useEffect(() => {
        if (!isGuest || !location.state?.authRequired) {
            return;
        }

        setAuthDialogOpen(true);

        navigate(location.pathname, {
            replace: true,
            state: null,
        });
    }, [
        isGuest,
        location.pathname,
        location.state,
        navigate,
    ]);

    // ================== SIDEBAR CONTROLS ==================
    const handleToggleSidebar = () => {
        if (isMobile) {
            setMobileOpen((current) => !current);
        } else {
            setSidebarOpen((current) => !current);
        }
    };

    const handleCloseSidebar = () => {
        setMobileOpen(false);
    };

    // ================== ROUTE CHANGE ==================
    useEffect(() => {
        setMobileOpen(false);
    }, [location.pathname]);

    // ================== NEW CHAT ==================
    const handleNewChat = () => {
        if (!requireAuth()) {
            return;
        }

        setSearch("");
        setMobileOpen(false);
        setNewChatKey((current) => current + 1);
    };

    const showOpenButton = isMobile
        ? !mobileOpen
        : !sidebarOpen;

    return (
        <div
            className={`chat-layout ${
                !isMobile && !sidebarOpen
                    ? "chat-layout-collapsed"
                    : ""
            }`}
        >
            {/* ================== CHAT SIDEBAR ================== */}
            <ChatSidebar
                isMobile={isMobile}
                mobileOpen={mobileOpen}
                onClose={handleCloseSidebar}
                onToggle={handleToggleSidebar}
                onNewChat={handleNewChat}
                onRequireAuth={requireAuth}
                isGuest={isGuest}
                search={search}
                onSearchChange={setSearch}
            >
                {isGuest ? (
                    <p className="chat-sidebar-empty">
                        Sign in to access your conversations.
                    </p>
                ) : (
                    <ChatHistory
                        search={search}
                        onClose={handleCloseSidebar}
                    />
                )}
            </ChatSidebar>

            {/* ================== MAIN CONTENT ================== */}
            <main className="chat-main">

                {/* Sidebar Reopen */}
                {showOpenButton && (
                    <div className="chat-floating-menu">
                        <IconButton
                            type="button"
                            className="chat-sidebar-reopen"
                            aria-label="Open sidebar"
                            aria-controls="chat-sidebar"
                            aria-expanded={false}
                            onClick={handleToggleSidebar}
                        >
                            <i
                                className="fa-solid fa-bars"
                                aria-hidden="true"
                            />
                        </IconButton>
                    </div>
                )}

                {/* Chat Page */}
                <div className="chat-main-content">
                    <Outlet
                        key={newChatKey}
                        context={{
                            requireAuth,
                            isGuest,
                        }}
                    />
                </div>
            </main>

            {/* ================== SIGN IN REQUIRED ================== */}
            <Dialog
                open={isGuest && authDialogOpen}
                onClose={handleCloseAuthDialog}
                aria-labelledby="guest-auth-title"
                aria-describedby="guest-auth-description"
                fullWidth
                maxWidth="xs"
                slotProps={{
                    paper: {
                        sx: {
                            borderRadius: "18px",
                            padding: "8px",
                            boxShadow:
                                "0 20px 55px rgba(15, 23, 42, 0.22)",
                        },
                    },
                }}
            >
                <DialogTitle
                    id="guest-auth-title"
                    sx={{
                        textAlign: "center",
                        fontWeight: 700,
                        color: "#0f172a",
                        paddingTop: 3,
                    }}
                >
                    Sign in to QueryNest AI
                </DialogTitle>

                <DialogContent>
                    <DialogContentText
                        id="guest-auth-description"
                        sx={{
                            color: "#64748b",
                            textAlign: "center",
                            lineHeight: 1.7,
                        }}
                    >
                        Sign in to start conversations,
                        upload documents, and access
                        your chat history.
                    </DialogContentText>
                </DialogContent>

                <DialogActions
                    sx={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 1.5,
                        padding: "0 20px 20px",
                    }}
                >
                    <Button
                        type="button"
                        variant="contained"
                        fullWidth
                        disableElevation
                        onClick={() =>
                            handleAuthNavigation("/login")
                        }
                        sx={{
                            margin: "0 !important",
                            paddingY: 1.3,
                            borderRadius: "10px",
                            fontWeight: 600,
                            textTransform: "none",
                            background:
                                "linear-gradient(110deg, #2563eb, #6d28d9)",
                        }}
                    >
                        Sign In
                    </Button>

                    <Button
                        type="button"
                        variant="outlined"
                        fullWidth
                        onClick={() =>
                            handleAuthNavigation("/signup")
                        }
                        sx={{
                            margin: "0 !important",
                            paddingY: 1.3,
                            borderRadius: "10px",
                            fontWeight: 600,
                            textTransform: "none",
                        }}
                    >
                        Create Account
                    </Button>

                    <Button
                        type="button"
                        color="inherit"
                        size="small"
                        onClick={handleCloseAuthDialog}
                        sx={{
                            textTransform: "none",
                            color: "#64748b",
                        }}
                    >
                        Maybe Later
                    </Button>
                </DialogActions>
            </Dialog>
        </div>
    );
}

export default ChatLayout;
