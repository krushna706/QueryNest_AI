import groupConversations from "../../utils/groupConversations";
import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    IconButton,
    Menu,
    MenuItem,
    TextField,
} from "@mui/material";
import { toast } from "react-toastify";

import { getChatHistory, renameConversation, deleteConversation } from "../../services/chatService";

// Configuration
const HISTORY_LIMIT = 20;

// Chat history
function ChatHistory({ search = "", onClose = () => {} }) {
    const location = useLocation();
    const navigate = useNavigate();

    const [conversations, setConversations] = useState([]);
    const [debouncedSearch, setDebouncedSearch] = useState(search.trim());

    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState("");

    const [hasMore, setHasMore] = useState(false);
    const [nextCursor, setNextCursor] = useState(null);
    const [refreshKey, setRefreshKey] = useState(0);

    const [menuAnchor, setMenuAnchor] = useState(null);
    const [selectedConversation, setSelectedConversation] = useState(null);

    const [renameOpen, setRenameOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [title, setTitle] = useState("");
    const [saving, setSaving] = useState(false);

    const groupedHistory = useMemo(() => groupConversations(conversations), [conversations]);

    useEffect(() => {
        const timeout = setTimeout(() => {
            setDebouncedSearch(search.trim());
        }, 350);

        return () => clearTimeout(timeout);
    }, [search]);

    useEffect(() => {
        let active = true;

        const loadHistory = async () => {
            setLoading(true);
            setError("");
            setHasMore(false);
            setNextCursor(null);

            try {
                const response = await getChatHistory({
                    search: debouncedSearch,
                    limit: HISTORY_LIMIT,
                });

                if (!active) return;

                setConversations(response.conversations || []);
                setHasMore(Boolean(response.pagination?.hasMore));
                setNextCursor(response.pagination?.nextCursor || null);
            } catch (error) {
                if (!active) return;

                setConversations([]);
                setError(error.response?.data?.message || "Unable to load conversations.");
            } finally {
                if (active) {
                    setLoading(false);
                }
            }
        };

        loadHistory();

        return () => {
            active = false;
        };
    }, [debouncedSearch, location.pathname, refreshKey]);

    const handleLoadMore = async () => {
        if (loading || loadingMore || !hasMore || !nextCursor) {
            return;
        }

        setLoadingMore(true);

        try {
            const response = await getChatHistory({
                search: debouncedSearch,
                cursor: nextCursor,
                limit: HISTORY_LIMIT,
            });

            setConversations((current) => {
                const existingIds = new Set(current.map((item) => item._id));

                const newItems = (response.conversations || []).filter((item) => !existingIds.has(item._id));

                return [...current, ...newItems];
            });

            setHasMore(Boolean(response.pagination?.hasMore));
            setNextCursor(response.pagination?.nextCursor || null);
        } catch (error) {
            toast.error(error.response?.data?.message || "Unable to load more conversations.");
        } finally {
            setLoadingMore(false);
        }
    };

    const handleOpenMenu = (event, conversation) => {
        setMenuAnchor(event.currentTarget);
        setSelectedConversation(conversation);
    };

    const handleCloseMenu = () => {
        setMenuAnchor(null);
    };

    const handleOpenRename = () => {
        if (!selectedConversation) return;

        setTitle(selectedConversation.title || "");
        setRenameOpen(true);
        handleCloseMenu();
    };

    const handleCloseRename = () => {
        if (saving) return;

        setRenameOpen(false);
        setSelectedConversation(null);
        setTitle("");
    };

    const handleRename = async (event) => {
        event.preventDefault();

        const updatedTitle = title.trim();

        if (saving || !selectedConversation || !updatedTitle || updatedTitle.length > 120) {
            return;
        }

        if (updatedTitle === selectedConversation.title) {
            handleCloseRename();
            return;
        }

        setSaving(true);

        try {
            await renameConversation(selectedConversation._id, updatedTitle);

            setConversations((current) =>
                current.map((item) => (item._id === selectedConversation._id ? { ...item, title: updatedTitle } : item))
            );

            setRenameOpen(false);
            setSelectedConversation(null);
            setTitle("");

            toast.success("Conversation renamed successfully.");
        } catch (error) {
            toast.error(error.response?.data?.message || "Unable to rename conversation.");
        } finally {
            setSaving(false);
        }
    };

    const handleOpenDelete = () => {
        if (!selectedConversation) return;

        setDeleteOpen(true);
        handleCloseMenu();
    };

    const handleCloseDelete = () => {
        if (saving) return;

        setDeleteOpen(false);
        setSelectedConversation(null);
    };

    const handleDelete = async () => {
        if (saving || !selectedConversation) return;

        setSaving(true);

        try {
            const deletedId = selectedConversation._id;

            await deleteConversation(deletedId);

            setConversations((current) => current.filter((item) => item._id !== deletedId));

            setDeleteOpen(false);
            setSelectedConversation(null);
            setRefreshKey((current) => current + 1);

            if (location.pathname === `/chat/${deletedId}`) {
                navigate("/chat", { replace: true });
                onClose();
            }

            toast.success("Conversation deleted successfully.");
        } catch (error) {
            toast.error(error.response?.data?.message || "Unable to delete conversation.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="chat-history">
            {loading && (
                <div className="chat-history-feedback" role="status">
                    <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />
                    <span>Loading conversations...</span>
                </div>
            )}
            {!loading && error && (
                <div className="chat-history-feedback">
                    <p>{error}</p>

                    <button
                        type="button"
                        className="chat-history-retry"
                        onClick={() => setRefreshKey((current) => current + 1)}
                    >
                        Try Again
                    </button>
                </div>
            )}
            {!loading && !error && conversations.length === 0 && (
                <p className="chat-sidebar-empty">
                    {debouncedSearch ? "No matching conversations found." : "Your conversations will appear here."}
                </p>
            )}
            {!loading &&
                !error &&
                Object.entries(groupedHistory).map(
                    ([groupName, items]) =>
                        items.length > 0 && (
                            <div key={groupName} className="chat-history-group">
                                <h2 className="chat-history-group-title">{groupName}</h2>

                                <ul className="chat-history-items">
                                    {items.map((conversation) => (
                                        <li key={conversation._id} className="chat-history-item">
                                            <NavLink
                                                to={`/chat/${conversation._id}`}
                                                className={({ isActive }) =>
                                                    `chat-history-link ${isActive ? "is-active" : ""}`
                                                }
                                                onClick={onClose}
                                                title={conversation.title}
                                            >
                                                <i className="fa-regular fa-message" aria-hidden="true" />

                                                <span>{conversation.title}</span>
                                            </NavLink>

                                            <IconButton
                                                type="button"
                                                className="chat-history-more"
                                                size="small"
                                                aria-label={`Options for ${conversation.title}`}
                                                aria-haspopup="menu"
                                                onClick={(event) => handleOpenMenu(event, conversation)}
                                            >
                                                <i className="fa-solid fa-ellipsis" aria-hidden="true" />
                                            </IconButton>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )
                )}
            {!loading && !error && hasMore && (
                <button
                    type="button"
                    className="chat-history-load-more"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                >
                    {loadingMore ? (
                        <>
                            <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />
                            Loading...
                        </>
                    ) : (
                        "Load More"
                    )}
                </button>
            )}
            <Menu
                anchorEl={menuAnchor}
                open={Boolean(menuAnchor)}
                onClose={handleCloseMenu}
                slotProps={{
                    paper: {
                        className: "chat-history-menu-paper",
                    },
                }}
            >
                <MenuItem className="chat-history-menu-item" onClick={handleOpenRename}>
                    <i className="fa-solid fa-pen" aria-hidden="true" />
                    Rename
                </MenuItem>

                <MenuItem className="chat-history-menu-item chat-history-delete-item" onClick={handleOpenDelete}>
                    <i className="fa-regular fa-trash-can" aria-hidden="true" />
                    Delete
                </MenuItem>
            </Menu>
            <Dialog
                open={renameOpen}
                onClose={handleCloseRename}
                fullWidth
                maxWidth="xs"
                aria-labelledby="rename-conversation-title"
            >
                <form onSubmit={handleRename}>
                    <DialogTitle id="rename-conversation-title">Rename Conversation</DialogTitle>

                    <DialogContent>
                        <TextField
                            autoFocus
                            fullWidth
                            size="small"
                            margin="dense"
                            label="Conversation title"
                            value={title}
                            onChange={(event) => setTitle(event.target.value)}
                            slotProps={{
                                htmlInput: {
                                    maxLength: 120,
                                },
                            }}
                            disabled={saving}
                            required
                        />
                    </DialogContent>

                    <DialogActions>
                        <Button type="button" onClick={handleCloseRename} disabled={saving}>
                            Cancel
                        </Button>

                        <Button type="submit" variant="contained" disabled={!title.trim() || saving}>
                            {saving ? "Saving..." : "Save"}
                        </Button>
                    </DialogActions>
                </form>
            </Dialog>
            <Dialog
                open={deleteOpen}
                onClose={handleCloseDelete}
                fullWidth
                maxWidth="xs"
                aria-labelledby="delete-conversation-title"
            >
                <DialogTitle id="delete-conversation-title">Delete Conversation?</DialogTitle>

                <DialogContent>
                    <DialogContentText>
                        This conversation and its messages will be permanently deleted. This action cannot be undone.
                    </DialogContentText>
                </DialogContent>

                <DialogActions>
                    <Button type="button" onClick={handleCloseDelete} disabled={saving}>
                        Cancel
                    </Button>

                    <Button type="button" color="error" variant="contained" onClick={handleDelete} disabled={saving}>
                        {saving ? "Deleting..." : "Delete"}
                    </Button>
                </DialogActions>
            </Dialog>
        </div>
    );
}

export default ChatHistory;
