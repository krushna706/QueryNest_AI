import { useCallback, useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, IconButton, useMediaQuery } from "@mui/material";

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

    const requireAuth = useCallback(() => {
        if (user) {
            return true;
        }

        setMobileOpen(false);
        setAuthDialogOpen(true);

        return false;
    }, [user]);

    const handleCloseAuthDialog = () => {
        setAuthDialogOpen(false);
    };

    const handleAuthNavigation = (path) => {
        setAuthDialogOpen(false);
        setMobileOpen(false);
        navigate(path);
    };

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

    useEffect(() => {
        setMobileOpen(false);
    }, [location.pathname]);

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
        <div className={`chat-layout ${ !isMobile && !sidebarOpen ? "chat-layout-collapsed" : "" }`}>
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
                    <ChatHistory search={search} onClose={handleCloseSidebar} />
                )}
            </ChatSidebar>
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
                            <i className="fa-solid fa-bars" aria-hidden="true" />
                        </IconButton>
                    </div>
                )}

                {/* Chat Page */}
                <div className="chat-main-content">
                    <Outlet key={newChatKey} context={{ requireAuth, isGuest, }} />
                </div>
            </main>
            <Dialog
                open={isGuest && authDialogOpen}
                onClose={handleCloseAuthDialog}
                aria-labelledby="guest-auth-title"
                aria-describedby="guest-auth-description"
                fullWidth
                maxWidth="xs"
                slotProps={{ paper: { className: "qn-guest-dialog-paper" } }}
            >
                <DialogTitle id="guest-auth-title" className="qn-guest-dialog-title">
                    Sign in to QueryNest AI
                </DialogTitle>

                <DialogContent>
                    <DialogContentText id="guest-auth-description" className="qn-guest-dialog-description">
                        Sign in to start conversations,
                        upload documents, and access
                        your chat history.
                    </DialogContentText>
                </DialogContent>

                <DialogActions className="qn-guest-dialog-actions">
                    <Button
                        type="button"
                        variant="contained"
                        fullWidth
                        disableElevation
                        onClick={() =>
                            handleAuthNavigation("/login")
                        }
                        className="qn-guest-dialog-signin"
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
                        className="qn-guest-dialog-signup"
                    >
                        Create Account
                    </Button>

                    <Button type="button" color="inherit" size="small" onClick={handleCloseAuthDialog} className="qn-guest-dialog-later">
                        Maybe Later
                    </Button>
                </DialogActions>
            </Dialog>
        </div>
    );
}

export default ChatLayout;
