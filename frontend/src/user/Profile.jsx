import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";

import { useAuth } from "../context/AuthContext";
import api from "../services/api";

// ================== CONFIGURATION ==================
const DEFAULT_AVATAR = "/images/default-avatar.svg";
const MAX_AVATAR_SIZE = 3 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PERIODS = [
    { key: "today", label: "Today", icon: "fa-regular fa-clock" },
    { key: "week", label: "This Week", icon: "fa-regular fa-calendar" },
    { key: "month", label: "This Month", icon: "fa-regular fa-calendar-days" },
];

// ================== FORMAT HELPERS ==================
function safeNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
}

function firstNumber(...values) {
    for (const value of values) {
        const number = safeNumber(value);
        if (number !== null) return number;
    }
    return null;
}

function formatNumber(value) {
    const number = safeNumber(value);
    return number === null ? "—" : number.toLocaleString("en-IN");
}

function formatCompact(value) {
    const number = safeNumber(value);
    if (number === null) return "—";
    if (number >= 1000000) return `${(number / 1000000).toFixed(1)}M`;
    if (number >= 1000) return `${(number / 1000).toFixed(1)}K`;
    return formatNumber(number);
}

function getErrorMessage(error, fallback) {
    const status = error?.response?.status;
    if (status === 401) return "Your session has expired. Please sign in again.";
    if (status === 404) return "This feature is currently unavailable.";
    if (status === 413) return "The selected image is too large.";
    if (status === 415) return "Choose a valid JPG, PNG or WebP image.";
    if (status === 429) return "Too many requests. Please try again later.";
    if (status >= 500) return "Server is temporarily unavailable. Try again.";
    if (!error?.response) return "Connection failed. Check your internet.";
    const message = error.response.data?.message;
    return status >= 400 && status < 500 && typeof message === "string" && message.length <= 180
        ? message
        : fallback;
}

function getPeriodUsage(usage, period) {
    const details = usage?.[period] || usage?.periods?.[period] ||
        (period === "today" ? usage?.daily : period === "week" ? usage?.weekly : usage?.monthly) || {};
    const suffix = period === "today" ? "Today" : period === "week" ? "Week" : "Month";
    const limitSuffix = period === "today" ? "Day" : period === "week" ? "Week" : "Month";

    return {
        requests: firstNumber(details.requests, usage?.[`requests${suffix}`]),
        tokens: firstNumber(details.tokens, usage?.[`tokens${suffix}`]),
        requestLimit: firstNumber(details.requestLimit, usage?.limits?.[`requestsPer${limitSuffix}`]),
        tokenLimit: firstNumber(details.tokenLimit, usage?.limits?.[`tokensPer${limitSuffix}`]),
    };
}

function UsageProgress({ icon, title, value, limit }) {
    const validLimit = safeNumber(limit) !== null && Number(limit) > 0;
    const percent = validLimit && safeNumber(value) !== null
        ? Math.min(100, (Number(value) / Number(limit)) * 100)
        : null;

    return (
        <div className="qnp-progress-item">
            <div className="qnp-progress-top">
                <span><i className={icon} aria-hidden="true" /> {title}</span>
                <strong>
                    {formatNumber(value)}
                    <small>{validLimit ? ` / ${formatNumber(limit)}` : " used"}</small>
                </strong>
            </div>
            {percent === null ? (
                <p className="qnp-note">
                    {value === null ? "Usage data not available." : "No period limit provided by the application."}
                </p>
            ) : (
                <progress
                    className={`qnp-progress-meter ${percent >= 90 ? "qnp-progress-warning" : ""}`}
                    aria-label={title}
                    value={percent}
                    max={100}
                />
            )}
        </div>
    );
}

function UsagePeriodCard({ period, data, active, onClick }) {
    return (
        <button type="button" className={`qnp-period ${active ? "active" : ""}`}
            onClick={onClick} aria-pressed={active}>
            <span className="qnp-period-top">
                <span>{period.label}</span>
                <i className={period.icon} aria-hidden="true" />
            </span>
            <strong className="qnp-period-value">{formatCompact(data.requests)}</strong>
            <span className="qnp-period-label">AI Requests</span>
            <span className="qnp-period-foot">
                <i className="fa-solid fa-bolt" aria-hidden="true" />
                {formatCompact(data.tokens)} tokens
            </span>
        </button>
    );
}

function SectionHeading({ id, title, description, icon, danger = false }) {
    return (
        <div className="qnp-heading">
            <div>
                <h2 id={id}>{title}</h2>
                <p className="qnp-subtitle">{description}</p>
            </div>
            <span className={`qnp-heading-icon ${danger ? "qnp-danger-icon" : ""}`}>
                <i className={icon} aria-hidden="true" />
            </span>
        </div>
    );
}

// ================== MY PROFILE ==================
function Profile() {
    const { user, updateUserProfile, refreshUser } = useAuth();
    const [name, setName] = useState(user?.name || "");
    const [savingName, setSavingName] = useState(false);
    const [uploadingAvatar, setUploadingAvatar] = useState(false);
    const [avatarBroken, setAvatarBroken] = useState(false);
    const [defaultAvatarBroken, setDefaultAvatarBroken] = useState(false);

    const [usage, setUsage] = useState(null);
    const [usageLoading, setUsageLoading] = useState(true);
    const [usageError, setUsageError] = useState("");
    const [selectedPeriod, setSelectedPeriod] = useState("today");
    const [lastUpdated, setLastUpdated] = useState(null);

    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [confirmationText, setConfirmationText] = useState("");
    const [clearingHistory, setClearingHistory] = useState(false);

    const avatarInputRef = useRef(null);
    const confirmationInputRef = useRef(null);
    const usageRequestId = useRef(0);

    const uploadedAvatar = user?.avatar?.url || user?.profilePicture?.url ||
        (typeof user?.profilePicture === "string" ? user.profilePicture : "") ||
        user?.avatarUrl || "";
    const avatarSrc = avatarBroken ? DEFAULT_AVATAR : uploadedAvatar || DEFAULT_AVATAR;
    const isDefaultAvatar = avatarSrc === DEFAULT_AVATAR;
    const userName = user?.name || "QueryNest User";
    const initials = userName.trim().split(/\s+/).slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase()).join("");
    const memberDate = user?.createdAt ? new Date(user.createdAt) : null;
    const memberSince = memberDate && !Number.isNaN(memberDate.getTime())
        ? memberDate.toLocaleDateString("en-IN", { month: "short", year: "numeric" })
        : null;

    useEffect(() => setName(user?.name || ""), [user?.name]);
    useEffect(() => {
        setAvatarBroken(false);
        setDefaultAvatarBroken(false);
    }, [uploadedAvatar]);

    function handleAvatarError() {
        if (avatarSrc !== DEFAULT_AVATAR && !avatarBroken) setAvatarBroken(true);
        else setDefaultAvatarBroken(true);
    }

    const fetchUsage = useCallback(async (signal) => {
        const requestId = ++usageRequestId.current;
        setUsageLoading(true);
        setUsageError("");
        try {
            const { data } = await api.get("/usage/me", { signal });
            if (requestId !== usageRequestId.current || signal?.aborted) return;
            setUsage(data?.usage || null);
            setLastUpdated(new Date());
        } catch (error) {
            if (requestId !== usageRequestId.current || signal?.aborted || error?.code === "ERR_CANCELED") return;
            const status = error?.response?.status;
            setUsageError(status
                ? `Unable to load usage (HTTP ${status}). Check /api/usage/me.`
                : "Could not connect to the usage API.");
            // Keep previously loaded figures visible on refresh failures.
        } finally {
            if (requestId === usageRequestId.current && !signal?.aborted) setUsageLoading(false);
        }
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        void fetchUsage(controller.signal);
        return () => {
            controller.abort();
            usageRequestId.current += 1;
        };
    }, [fetchUsage]);

    useEffect(() => {
        if (!showDeleteDialog) return;
        confirmationInputRef.current?.focus();
        function onKeyDown(event) {
            if (event.key === "Escape" && !clearingHistory) {
                setShowDeleteDialog(false);
                setConfirmationText("");
            }
        }
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [showDeleteDialog, clearingHistory]);

    const periods = {
        today: getPeriodUsage(usage, "today"),
        week: getPeriodUsage(usage, "week"),
        month: getPeriodUsage(usage, "month"),
    };
    const current = periods[selectedPeriod];
    const currentLabel = PERIODS.find(({ key }) => key === selectedPeriod)?.label || "Today";
    const averageTokens = current.requests > 0 && current.tokens !== null
        ? Math.round(current.tokens / current.requests) : null;
    const providers = usage?.providersByPeriod?.[selectedPeriod] ||
        usage?.[selectedPeriod]?.providers ||
        (selectedPeriod === "today" ? usage?.providers || usage?.providerUsage : null);
    const showProviders = providers?.groq || providers?.gemini;

    async function handleSaveName(event) {
        event.preventDefault();
        if (savingName) return;
        const cleanName = name.trim().replace(/\s+/g, " ");
        if (cleanName.length < 2 || cleanName.length > 100) {
            toast.error("Name must contain between 2 and 100 characters.");
            return;
        }
        if (cleanName === user?.name) return;
        setSavingName(true);
        try {
            const { data } = await api.patch("/users/profile", { name: cleanName });
            if (!data?.user?._id) throw new Error("Updated profile missing.");
            if (typeof updateUserProfile === "function") updateUserProfile(data.user);
            else if (typeof refreshUser === "function") await refreshUser();
            setName(data.user.name);
            toast.success("Your name has been updated successfully.");
        } catch (error) {
            toast.error(getErrorMessage(error, "Couldn't update your name."));
        } finally {
            setSavingName(false);
        }
    }

    async function handleAvatarChange(event) {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file || uploadingAvatar) return;
        if (!ALLOWED_AVATAR_TYPES.has(file.type)) {
            toast.error("Only JPG, JPEG, PNG and WebP images are allowed.");
            return;
        }
        if (file.size <= 0 || file.size > MAX_AVATAR_SIZE) {
            toast.error("Profile picture must be smaller than 3 MB.");
            return;
        }
        setUploadingAvatar(true);
        try {
            const formData = new FormData();
            formData.append("avatar", file);
            const { data } = await api.post("/users/profile/avatar", formData, { timeout: 60000 });
            if (!data?.user?._id) throw new Error("Updated profile missing.");
            if (typeof updateUserProfile === "function") updateUserProfile(data.user);
            else if (typeof refreshUser === "function") await refreshUser();
            toast.success("Profile picture updated successfully.");
        } catch (error) {
            toast.error(getErrorMessage(error, "Couldn't upload your profile picture."));
        } finally {
            setUploadingAvatar(false);
        }
    }

    async function handleClearHistory() {
        if (clearingHistory || confirmationText !== "DELETE") return;
        setClearingHistory(true);
        try {
            await api.delete("/users/chat-history", { timeout: 60000 });
            setShowDeleteDialog(false);
            setConfirmationText("");
            toast.success("Your chat history has been cleared.");
            window.location.replace("/chat");
        } catch (error) {
            toast.error(getErrorMessage(error, "Couldn't clear your chat history."));
        } finally {
            setClearingHistory(false);
        }
    }

    const avatarView = (
        !defaultAvatarBroken ? (
            <img src={avatarSrc} alt="Your profile" onError={handleAvatarError}
                referrerPolicy="no-referrer"
                className={isDefaultAvatar ? "qnp-image-default" : "qnp-image-uploaded"} />
        ) : (
            <span className="qnp-initials">{initials}</span>
        )
    );

    return (
        <main className="container-fluid qnp-page">

            {/* ================== PROFILE HERO ================== */}
            <section className="qnp-hero">
                <div className="qnp-hero-user">
                    <div className="qnp-hero-avatar">{avatarView}</div>
                    <div>
                        <p className="qnp-eyebrow">QUERYNEST AI / MY WORKSPACE</p>
                        <h1>Welcome back, {userName}</h1>
                        <p className="qnp-hero-description">
                            Manage your profile, understand your AI usage and stay in control of your data.
                        </p>
                    </div>
                </div>
                <div className="qnp-hero-actions">
                    <span className="qnp-hero-chip"><i className="fa-regular fa-circle-user" /> My Account</span>
                    {memberSince && <span className="qnp-hero-chip"><i className="fa-regular fa-calendar" /> Member since {memberSince}</span>}
                    <Link to="/chat" className="qnp-hero-chip"><i className="fa-solid fa-arrow-left" /> Back to Chat</Link>
                </div>
            </section>

            {/* ================== BALANCED MAIN GRID ================== */}
            <div className="qnp-main-grid">
                <section className="qnp-card qnp-profile-card" aria-labelledby="qnp-personal-title">
                    <SectionHeading id="qnp-personal-title" title="Personal Information"
                        description="Keep your profile details up to date." icon="fa-regular fa-user" />
                    <div className="qnp-photo-row">
                        <div className="qnp-photo-avatar">{avatarView}</div>
                        <div>
                            <p className="qnp-photo-title">Profile Photo</p>
                            <p className="qnp-note">JPG, PNG or WebP · Max 3 MB</p>
                            <button type="button" className="qnp-btn qnp-btn-secondary"
                                disabled={uploadingAvatar} onClick={() => avatarInputRef.current?.click()}>
                                <i className={uploadingAvatar ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-camera"} />
                                {uploadingAvatar ? "Uploading..." : "Change Photo"}
                            </button>
                        </div>
                        <input ref={avatarInputRef} type="file" hidden
                            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                            aria-label="Choose profile picture" disabled={uploadingAvatar}
                            onChange={handleAvatarChange} />
                    </div>
                    <div className="qnp-divider" />
                    <form className="qnp-profile-form" onSubmit={handleSaveName}>
                        <div className="qnp-form-fields">
                            <div className="qnp-field">
                                <label className="qnp-label" htmlFor="qnp-name">Full Name</label>
                                <input id="qnp-name" className="qnp-input" type="text"
                                    value={name} onChange={(event) => setName(event.target.value)}
                                    minLength={2} maxLength={100} autoComplete="name"
                                    disabled={savingName} required />
                            </div>
                            <div className="qnp-field">
                                <label className="qnp-label" htmlFor="qnp-email">Email Address</label>
                                <input id="qnp-email" className="qnp-input" type="email"
                                    value={user?.email || ""} readOnly />
                            </div>
                            <div className="qnp-field">
                                <label className="qnp-label" htmlFor="qnp-phone">Mobile Number</label>
                                <input id="qnp-phone" className="qnp-input" type="text"
                                    value={user?.phone || user?.mobile || ""} readOnly />
                            </div>
                        </div>
                        <div className="qnp-form-actions">
                            <button type="submit" className="qnp-btn qnp-btn-primary"
                                disabled={savingName || !name.trim() || name.trim().replace(/\s+/g, " ") === user?.name}>
                                <i className={savingName ? "fa-solid fa-spinner fa-spin" : "fa-regular fa-floppy-disk"} />
                                {savingName ? "Saving..." : "Save Changes"}
                            </button>
                            <p className="qnp-note">Email and mobile number are read-only for account security.</p>
                        </div>
                    </form>
                </section>

                <section className="qnp-card" aria-labelledby="qnp-usage-title">
                    <div className="qnp-usage-head">
                        <div>
                            <h2 id="qnp-usage-title" className="qnp-usage-title">AI Usage &amp; Limits</h2>
                            <p className="qnp-subtitle">Monitor your requests and token consumption across different periods.</p>
                        </div>
                        <div className="qnp-usage-tools">
                            <span className="qnp-usage-tag"><i className="fa-solid fa-chart-simple" /> Usage Overview</span>
                            <button type="button" className="qnp-refresh" disabled={usageLoading}
                                onClick={() => fetchUsage()} title="Refresh AI usage" aria-label="Refresh AI usage">
                                <i className={`fa-solid fa-rotate ${usageLoading ? "fa-spin" : ""}`} />
                            </button>
                        </div>
                    </div>
                    {usageError && <p role="status" className="qnp-note">{usageError}</p>}
                    <div className="qnp-period-grid">
                        {PERIODS.map((period) => (
                            <UsagePeriodCard key={period.key} period={period} data={periods[period.key]}
                                active={selectedPeriod === period.key}
                                onClick={() => setSelectedPeriod(period.key)} />
                        ))}
                    </div>
                    <div className="qnp-detail">
                        <div className="qnp-detail-head">
                            <span><i className="fa-solid fa-chart-line" /> {currentLabel} — Detailed Usage</span>
                            <span className="qnp-note">Your account</span>
                        </div>
                        <UsageProgress title="AI Requests" icon="fa-regular fa-comments"
                            value={current.requests} limit={current.requestLimit} />
                        <UsageProgress title="Tokens Consumed" icon="fa-solid fa-bolt"
                            value={current.tokens} limit={current.tokenLimit} />
                        <div className="qnp-average">
                            <span>Average tokens per AI request</span>
                            <strong>{formatNumber(averageTokens)}</strong>
                        </div>
                    </div>
                    {showProviders && (
                        <>
                            <h3 className="qnp-provider-heading">Provider Breakdown · {currentLabel}</h3>
                            <div className="qnp-provider-grid">
                                {[
                                    { key: "groq", label: "Groq" },
                                    { key: "gemini", label: "Gemini" },
                                ].map(({ key, label }) => (
                                    <div key={key} className="qnp-provider">
                                        <span className="qnp-note">{label} Requests</span>
                                        <strong>{formatNumber(providers?.[key]?.requests)}</strong>
                                        <span className="qnp-note">{formatCompact(providers?.[key]?.tokens)} tokens</span>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                    <p className="qnp-note qnp-usage-footnote">
                        Groq and Gemini provider quotas are shared, not individual user allowances.
                        {lastUpdated && ` Last fetched ${lastUpdated.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}.`}
                    </p>
                </section>
            </div>

            {/* ================== SECURITY AND HISTORY ================== */}
            <div className="qnp-lower-grid">
                <section className="qnp-card" aria-labelledby="qnp-security-title">
                    <SectionHeading id="qnp-security-title" title="Security & Privacy"
                        description="Learn how to manage your account securely."
                        icon="fa-solid fa-shield-halved" />
                    <div className="qnp-info">
                        <span className="qnp-info-icon"><i className="fa-solid fa-key" /></span>
                        <div><h3>Password Security</h3><p>To change your password, sign out and use Forgot Password on the Sign In page.</p></div>
                    </div>
                    <div className="qnp-info">
                        <span className="qnp-info-icon"><i className="fa-regular fa-envelope" /></span>
                        <div><h3>Email Verification</h3><p>Password recovery OTPs are sent to your registered email address.</p></div>
                    </div>
                    <div className="qnp-info">
                        <span className="qnp-info-icon"><i className="fa-regular fa-file-lines" /></span>
                        <div><h3>Document Privacy</h3><p>Uploaded content may be processed by external AI providers to answer your questions.</p></div>
                    </div>
                </section>
                <section className="qnp-card qnp-danger-card" aria-labelledby="qnp-data-title">
                    <SectionHeading id="qnp-data-title" title="Data Management"
                        description="Manage your saved conversation history."
                        icon="fa-regular fa-trash-can" danger />
                    <div className="qnp-danger-inner">
                        <strong>Clear All Chat History</strong>
                        <p>
                            Delete your conversations, AI messages, linked documents, chunks and embeddings
                            stored in the application. This cannot be undone. External providers and backups
                            may have separate retention periods.
                        </p>
                        <button type="button" className="qnp-btn qnp-btn-danger"
                            onClick={() => { setConfirmationText(""); setShowDeleteDialog(true); }}>
                            <i className="fa-regular fa-trash-can" /> Clear All Chat History
                        </button>
                    </div>
                    <p className="qnp-note qnp-danger-footnote">
                        This action does not delete your QueryNest AI user account.
                    </p>
                </section>
            </div>
            <footer className="qnp-footer">
                <span>QueryNest AI · Your personal AI workspace</span>
                <span>Manage smarter. Work better.</span>
            </footer>

            {/* ================== DELETE CONFIRMATION ================== */}
            {showDeleteDialog && (
                <div className="qnp-modal-overlay">
                    <div className="qnp-modal" role="alertdialog" aria-modal="true"
                        aria-labelledby="qnp-dialog-title" aria-describedby="qnp-dialog-desc">
                        <div className="qnp-heading-icon qnp-danger-icon qnp-modal-warning-icon">
                            <i className="fa-solid fa-triangle-exclamation" />
                        </div>
                        <h2 id="qnp-dialog-title">Delete all conversations?</h2>
                        <p id="qnp-dialog-desc">
                            This permanently removes saved conversations, messages and linked document data.
                            The action cannot be undone.
                        </p>
                        <label className="qnp-label" htmlFor="qnp-confirm">Type DELETE to confirm</label>
                        <input id="qnp-confirm" ref={confirmationInputRef} type="text"
                            className="qnp-input" placeholder="DELETE" autoComplete="off"
                            value={confirmationText} disabled={clearingHistory}
                            onChange={(event) => setConfirmationText(event.target.value)} />
                        <div className="qnp-modal-actions">
                            <button type="button" className="qnp-btn qnp-btn-secondary"
                                disabled={clearingHistory}
                                onClick={() => { setShowDeleteDialog(false); setConfirmationText(""); }}>
                                Cancel
                            </button>
                            <button type="button" className="qnp-btn qnp-btn-danger"
                                disabled={clearingHistory || confirmationText !== "DELETE"}
                                onClick={handleClearHistory}>
                                {clearingHistory ? <><i className="fa-solid fa-spinner fa-spin" /> Deleting...</>
                                    : <><i className="fa-regular fa-trash-can" /> Delete All Chats</>}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}

export default Profile;
