
import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { IconButton, useMediaQuery } from "@mui/material";

import ChatSidebar from "../components/chat/ChatSidebar";
import ChatHistory from "../components/chat/ChatHistory";

import "../css/panel.css";

// ================== CHAT LAYOUT ==================
function ChatLayout() {
    const isMobile = useMediaQuery("(max-width: 767.98px)");
    const location = useLocation();

    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [search, setSearch] = useState("");
    const [newChatKey, setNewChatKey] = useState(0);

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
                search={search}
                onSearchChange={setSearch}
            >
                <ChatHistory
                    search={search}
                    onClose={handleCloseSidebar}
                />
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
                    <Outlet key={newChatKey} />
                </div>
            </main>
        </div>
    );
}

export default ChatLayout;
