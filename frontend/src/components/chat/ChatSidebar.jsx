import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Avatar, Drawer, IconButton, Menu, MenuItem, useMediaQuery } from "@mui/material";
import { toast } from "react-toastify";

import { useAuth } from "../../context/AuthContext";

// Sidebar content
function SidebarContent({
    isMobile = false,
    onClose,
    onToggle,
    onNewChat,
    onRequireAuth,
    isGuest = false,
    search,
    onSearchChange,
    children,
}) {
    const navigate = useNavigate();
    const { user, logout } = useAuth();

    const [menuAnchor, setMenuAnchor] = useState(null);
    const [loggingOut, setLoggingOut] = useState(false);

    const menuOpen = Boolean(menuAnchor);
    const guestMode = isGuest || !user;

    const userName = user?.name || "Guest";
    const userEmail = user?.email || "";
    const avatarUrl = user?.avatar?.url || user?.avatarUrl || "";

    const initials = userName
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join("");

    const handleGuestAuth = () => {
        if (!guestMode) return false;

        if (onRequireAuth) {
            onRequireAuth();
        } else {
            navigate("/login");
        }

        return true;
    };

    const handleNewChat = (event) => {
        if (guestMode) {
            event.preventDefault();
            handleGuestAuth();
            return;
        }

        onNewChat?.();
        onClose?.();
    };

    const handleSearchChange = (event) => {
        if (guestMode) {
            handleGuestAuth();
            return;
        }

        onSearchChange(event.target.value);
    };

    const handleOpenMenu = (event) => {
        if (handleGuestAuth()) return;

        setMenuAnchor(event.currentTarget);
    };

    const handleCloseMenu = () => {
        setMenuAnchor(null);
    };

    const handleNavigation = (path) => {
        handleCloseMenu();
        onClose?.();
        navigate(path);
    };

    const handleLogout = async () => {
        if (guestMode || loggingOut) return;

        handleCloseMenu();
        setLoggingOut(true);

        try {
            await logout();

            onClose?.();
            navigate("/login", { replace: true });

            toast.success("Logged out successfully.");
        } catch (error) {
            toast.error(error.response?.data?.message || "Unable to logout. Please try again.");
        } finally {
            setLoggingOut(false);
        }
    };

    return (
        <>
            <div className="chat-sidebar-header">
                <Link to="/chat" className="chat-sidebar-brand" onClick={onClose} aria-label="QueryNest AI Home">
                    <img
                        src="/images/QueryNest_AI_Logo.png"
                        alt="QueryNest AI"
                        className="chat-brand-logo qn-chat-brand-image"
                    />
                </Link>

                <IconButton
                    type="button"
                    className="chat-sidebar-toggle"
                    aria-label={isMobile ? "Close sidebar" : "Collapse sidebar"}
                    onClick={isMobile ? onClose : onToggle}
                >
                    <i className="fa-solid fa-bars" aria-hidden="true" />
                </IconButton>
            </div>
            <div className="chat-sidebar-actions">
                <Link to="/chat" className="chat-new-button" onClick={handleNewChat}>
                    <i className="fa-solid fa-plus" aria-hidden="true" />
                    <span>New Chat</span>
                </Link>
            </div>
            <div className="chat-sidebar-search">
                <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />

                <input
                    type="search"
                    value={guestMode ? "" : search}
                    onClick={() => {
                        if (guestMode) {
                            handleGuestAuth();
                        }
                    }}
                    onChange={handleSearchChange}
                    readOnly={guestMode}
                    placeholder="Search conversations"
                    aria-label="Search conversations"
                    maxLength={120}
                    autoComplete="off"
                />
            </div>
            <nav className="chat-sidebar-history" aria-label="Chat history">
                <p className="chat-sidebar-label">YOUR CONVERSATIONS</p>

                {guestMode ? <p className="chat-sidebar-empty">Sign in to access your conversations.</p> : children}
            </nav>
            <div className="chat-sidebar-bottom">
                <button
                    type="button"
                    className="chat-account-button"
                    onClick={handleOpenMenu}
                    disabled={loggingOut}
                    aria-label={guestMode ? "Sign in to QueryNest AI" : `Account menu for ${userName}`}
                    aria-haspopup={guestMode ? "dialog" : "menu"}
                    aria-expanded={guestMode ? undefined : menuOpen}
                    aria-controls={!guestMode && menuOpen ? "chat-account-menu" : undefined}
                >
                    <Avatar
                        src={!guestMode && avatarUrl ? avatarUrl : undefined}
                        alt={userName}
                        className="chat-account-avatar"
                    >
                        {guestMode ? <i className="fa-regular fa-user" aria-hidden="true" /> : !avatarUrl && initials}
                    </Avatar>

                    <span className="chat-account-details">
                        <span className="chat-account-name">{guestMode ? "Sign In" : userName}</span>

                        <span className="chat-account-email">
                            {guestMode ? "Log in or create an account" : userEmail}
                        </span>
                    </span>

                    <i
                        className={
                            guestMode
                                ? "fa-solid fa-right-to-bracket chat-account-arrow"
                                : "fa-solid fa-chevron-up chat-account-arrow"
                        }
                        aria-hidden="true"
                    />
                </button>
            </div>
            {!guestMode && (
                <Menu
                    id="chat-account-menu"
                    anchorEl={menuAnchor}
                    open={menuOpen}
                    onClose={handleCloseMenu}
                    anchorOrigin={{
                        vertical: "top",
                        horizontal: "left",
                    }}
                    transformOrigin={{
                        vertical: "bottom",
                        horizontal: "left",
                    }}
                    slotProps={{
                        paper: {
                            className: "chat-account-menu-paper",
                        },
                    }}
                >
                    <div className="chat-account-menu-header">
                        <Avatar src={avatarUrl || undefined} alt={userName} className="chat-account-avatar">
                            {!avatarUrl && initials}
                        </Avatar>

                        <div className="chat-account-menu-user">
                            <strong>{userName}</strong>
                            <span>{userEmail}</span>
                        </div>
                    </div>

                    <div className="chat-account-menu-divider" />

                    <MenuItem className="chat-account-menu-item" onClick={() => handleNavigation("/chat")}>
                        <i className="fa-solid fa-house" aria-hidden="true" />
                        <span>Dashboard</span>
                    </MenuItem>

                    <MenuItem className="chat-account-menu-item" onClick={() => handleNavigation("/profile")}>
                        <i className="fa-regular fa-user" aria-hidden="true" />
                        <span>My Profile</span>
                    </MenuItem>

                    <div className="chat-account-menu-divider" />

                    <MenuItem
                        className="chat-account-menu-item chat-account-logout"
                        onClick={handleLogout}
                        disabled={loggingOut}
                    >
                        <i className="fa-solid fa-right-from-bracket" aria-hidden="true" />
                        <span>Logout</span>
                    </MenuItem>
                </Menu>
            )}
        </>
    );
}

// Chat sidebar
function ChatSidebar({
    isMobile = false,
    mobileOpen = false,
    onClose = () => {},
    onToggle = () => {},
    onNewChat,
    onRequireAuth,
    isGuest = false,
    search = "",
    onSearchChange = () => {},
    children,
}) {
    const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

    const sidebarContent = (
        <SidebarContent
            isMobile={isMobile}
            onClose={onClose}
            onToggle={onToggle}
            onNewChat={onNewChat}
            onRequireAuth={onRequireAuth}
            isGuest={isGuest}
            search={search}
            onSearchChange={onSearchChange}
        >
            {children}
        </SidebarContent>
    );

    if (isMobile) {
        return (
            <Drawer
                anchor="left"
                open={mobileOpen}
                onClose={onClose}
                transitionDuration={reduceMotion ? 0 : { enter: 350, exit: 300 }}
                slotProps={{
                    paper: {
                        id: "chat-sidebar",
                        className: "chat-sidebar chat-sidebar-drawer",
                        "aria-label": "Chat navigation",
                    },
                }}
            >
                {sidebarContent}
            </Drawer>
        );
    }

    return (
        <aside id="chat-sidebar" className="chat-sidebar chat-sidebar-desktop" aria-label="Chat navigation">
            {sidebarContent}
        </aside>
    );
}

export default ChatSidebar;
