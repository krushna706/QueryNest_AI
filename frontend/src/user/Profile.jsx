
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";

import { useAuth } from "../context/AuthContext";
import api from "../services/api";

// ================== CONFIGURATION ==================
const MAX_AVATAR_SIZE = 3 * 1024 * 1024;

const ALLOWED_AVATAR_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
]);

const PERIODS = [
    { key: "today", label: "Today", icon: "fa-regular fa-clock" },
    { key: "week", label: "This Week", icon: "fa-regular fa-calendar" },
    { key: "month", label: "This Month", icon: "fa-regular fa-calendar-days" },
];

// ================== FORMAT NUMBERS ==================
function toNumber(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const number = Number(value);

    return Number.isFinite(number) && number >= 0
        ? number
        : null;
}

function firstNumber(...values) {
    for (const value of values) {
        const number = toNumber(value);

        if (number !== null) {
            return number;
        }
    }

    return null;
}

function formatNumber(value) {
    const number = toNumber(value);

    return number === null
        ? "—"
        : number.toLocaleString("en-IN");
}

function formatCompact(value) {
    const number = toNumber(value);

    if (number === null) return "—";

    if (number >= 1000000) {
        return `${(number / 1000000).toFixed(1)}M`;
    }

    if (number >= 1000) {
        return `${(number / 1000).toFixed(1)}K`;
    }

    return formatNumber(number);
}

// ================== FORMAT MEMBERSHIP ==================
function formatMemberSince(value) {
    if (!value) return null;

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date.toLocaleDateString("en-IN", {
        month: "short",
        year: "numeric",
    });
}

// ================== USER FRIENDLY ERROR ==================
function getFriendlyError(error, fallback) {
    const status = error?.response?.status;

    if (status === 401) {
        return "Your session has expired. Please log in again.";
    }

    if (status === 404) {
        return "This feature is currently unavailable.";
    }

    if (status === 413) {
        return "The selected file is too large.";
    }

    if (status === 415) {
        return "Please select a valid JPG, PNG or WebP image.";
    }

    if (status === 429) {
        return "Too many requests. Please try again later.";
    }

    if (status >= 500) {
        return "The service is temporarily unavailable. Please try again.";
    }

    if (!error?.response) {
        return "Connection failed. Please check your internet.";
    }

    const message = error.response.data?.message;

    if (
        status >= 400 &&
        status < 500 &&
        typeof message === "string" &&
        message.length <= 180
    ) {
        return message;
    }

    return fallback;
}

// ================== USAGE DATA ==================
function getPeriodUsage(usage, period) {
    const periodData =
        usage?.[period] ||
        usage?.periods?.[period] ||
        (
            period === "today"
                ? usage?.daily
                : period === "week"
                    ? usage?.weekly
                    : usage?.monthly
        ) ||
        {};

    const suffix =
        period === "today"
            ? "Today"
            : period === "week"
                ? "Week"
                : "Month";

    const limitSuffix =
        period === "today"
            ? "Day"
            : period === "week"
                ? "Week"
                : "Month";

    return {
        requests: firstNumber(
            periodData.requests,
            usage?.[`requests${suffix}`]
        ),

        tokens: firstNumber(
            periodData.tokens,
            usage?.[`tokens${suffix}`]
        ),

        requestLimit: firstNumber(
            periodData.requestLimit,
            usage?.limits?.[`requestsPer${limitSuffix}`]
        ),

        tokenLimit: firstNumber(
            periodData.tokenLimit,
            usage?.limits?.[`tokensPer${limitSuffix}`]
        ),
    };
}

// ================== PROGRESS BAR ==================
function UsageProgress({
    label,
    value,
    limit,
    icon,
}) {
    const validLimit =
        toNumber(limit) !== null &&
        Number(limit) > 0;

    const percentage =
        validLimit && toNumber(value) !== null
            ? Math.min(100, (Number(value) / Number(limit)) * 100)
            : null;

    return (
        <div className="qnp-progress-item">
            <div className="qnp-progress-heading">
                <span>
                    <i className={icon} aria-hidden="true" />
                    {label}
                </span>

                <strong>
                    {formatNumber(value)}
                    <small>
                        {validLimit
                            ? ` / ${formatNumber(limit)}`
                            : " used"}
                    </small>
                </strong>
            </div>

            {percentage !== null ? (
                <div
                    className="qnp-progress-track"
                    role="progressbar"
                    aria-label={label}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(percentage)}
                >
                    <div
                        className={
                            percentage >= 90
                                ? "qnp-progress-fill qnp-progress-warning"
                                : "qnp-progress-fill"
                        }
                        style={{
                            width: `${percentage}%`,
                        }}
                    />
                </div>
            ) : (
                <p className="qnp-muted qnp-no-limit">
                    {value === null
                        ? "Usage data not available."
                        : "No period limit provided by the application."}
                </p>
            )}
        </div>
    );
}

// ================== PERIOD CARD ==================
function PeriodCard({
    period,
    data,
    active,
    onClick,
}) {
    return (
        <button
            type="button"
            className={`qnp-period-card ${active ? "active" : ""}`}
            onClick={onClick}
            aria-pressed={active}
        >
            <div className="qnp-period-header">
                <span>{period.label}</span>

                <i
                    className={period.icon}
                    aria-hidden="true"
                />
            </div>

            <strong className="qnp-period-number">
                {formatCompact(data.requests)}
            </strong>

            <span className="qnp-period-caption">
                AI Requests
            </span>

            <div className="qnp-period-footer">
                <i
                    className="fa-solid fa-bolt"
                    aria-hidden="true"
                />

                {formatCompact(data.tokens)} tokens
            </div>
        </button>
    );
}

// ================== MY PROFILE ==================
function Profile() {
    const {
        user,
        updateUserProfile,
        refreshUser,
    } = useAuth();

    // ================== PROFILE STATE ==================
    const [name, setName] = useState(user?.name || "");
    const [savingName, setSavingName] = useState(false);
    const [uploadingAvatar, setUploadingAvatar] = useState(false);
    const [avatarBroken, setAvatarBroken] = useState(false);

    // ================== USAGE STATE ==================
    const [usage, setUsage] = useState(null);
    const [usageLoading, setUsageLoading] = useState(true);
    const [usageError, setUsageError] = useState("");
    const [selectedPeriod, setSelectedPeriod] = useState("today");

    // ================== DELETE STATE ==================
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [confirmationText, setConfirmationText] = useState("");
    const [clearingHistory, setClearingHistory] = useState(false);

    const avatarInputRef = useRef(null);
    const confirmationInputRef = useRef(null);

    // ================== USER DETAILS ==================
    const avatarUrl =
        user?.profilePicture?.url ||
        user?.avatar?.url ||
        user?.avatarUrl ||
        (
            typeof user?.profilePicture === "string"
                ? user.profilePicture
                : ""
        );

    const userName = user?.name || "QueryNest User";

    const userInitials = userName
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((word) => word.charAt(0).toUpperCase())
        .join("");

    const memberSince = formatMemberSince(user?.createdAt);

    // ================== SYNC NAME ==================
    useEffect(() => {
        setName(user?.name || "");
    }, [user?.name]);

    useEffect(() => {
        setAvatarBroken(false);
    }, [avatarUrl]);

    // ================== LOAD USAGE ==================
    useEffect(() => {
        const controller = new AbortController();

        async function loadUsage() {
            setUsageLoading(true);
            setUsageError("");

            try {
                const { data } = await api.get(
                    "/usage/me",
                    {
                        signal: controller.signal,
                    }
                );

                if (!controller.signal.aborted) {
                    setUsage(data?.usage || null);
                }
            } catch (error) {
                if (
                    controller.signal.aborted ||
                    error?.code === "ERR_CANCELED"
                ) {
                    return;
                }

                setUsage(null);

                setUsageError(
                    "Usage analytics are not available yet."
                );
            } finally {
                if (!controller.signal.aborted) {
                    setUsageLoading(false);
                }
            }
        }

        void loadUsage();

        return () => controller.abort();
    }, []);

    // ================== DELETE DIALOG KEYBOARD ==================
    useEffect(() => {
        if (!showDeleteDialog) return;

        confirmationInputRef.current?.focus();

        function handleKeyDown(event) {
            if (event.key === "Escape" && !clearingHistory) {
                setShowDeleteDialog(false);
                setConfirmationText("");
            }
        }

        document.addEventListener("keydown", handleKeyDown);

        return () => {
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [showDeleteDialog, clearingHistory]);

    // ================== PERIOD METRICS ==================
    const daily = getPeriodUsage(usage, "today");
    const weekly = getPeriodUsage(usage, "week");
    const monthly = getPeriodUsage(usage, "month");

    const periodMap = {
        today: daily,
        week: weekly,
        month: monthly,
    };

    const currentUsage = periodMap[selectedPeriod];

    const averageTokens =
        currentUsage.requests > 0 &&
        currentUsage.tokens !== null
            ? Math.round(
                currentUsage.tokens / currentUsage.requests
            )
            : null;

    const periodLabel =
        PERIODS.find(
            (period) => period.key === selectedPeriod
        )?.label || "Today";

    // ================== PROVIDER DATA ==================
    const groqRequests = firstNumber(
        usage?.providers?.groq?.requests,
        usage?.providerUsage?.groq?.requests
    );

    const geminiRequests = firstNumber(
        usage?.providers?.gemini?.requests,
        usage?.providerUsage?.gemini?.requests
    );

    const showProviderBreakdown =
        groqRequests !== null ||
        geminiRequests !== null;

    // ================== UPDATE NAME ==================
    async function handleSaveName(event) {
        event.preventDefault();

        if (savingName) return;

        const cleanName = name
            .trim()
            .replace(/\s+/g, " ");

        if (
            cleanName.length < 2 ||
            cleanName.length > 100
        ) {
            toast.error(
                "Name must contain between 2 and 100 characters.",
                { toastId: "profile-invalid-name" }
            );
            return;
        }

        if (cleanName === user?.name) {
            return;
        }

        setSavingName(true);

        try {
            const { data } = await api.patch(
                "/users/profile",
                {
                    name: cleanName,
                }
            );

            if (!data?.user?._id) {
                throw new Error(
                    "Updated profile was not returned."
                );
            }

            if (typeof updateUserProfile === "function") {
                updateUserProfile(data.user);
            } else if (typeof refreshUser === "function") {
                await refreshUser();
            }

            setName(data.user.name);

            toast.success(
                "Your name has been updated successfully."
            );
        } catch (error) {
            toast.error(
                getFriendlyError(
                    error,
                    "Couldn't update your name. Please try again."
                )
            );
        } finally {
            setSavingName(false);
        }
    }

    // ================== UPLOAD AVATAR ==================
    async function handleAvatarChange(event) {
        const file = event.target.files?.[0];

        event.target.value = "";

        if (!file || uploadingAvatar) return;

        if (!ALLOWED_AVATAR_TYPES.has(file.type)) {
            toast.error(
                "Only JPG, JPEG, PNG and WebP images are allowed."
            );
            return;
        }

        if (
            file.size <= 0 ||
            file.size > MAX_AVATAR_SIZE
        ) {
            toast.error(
                "Profile picture must be smaller than 3 MB."
            );
            return;
        }

        setUploadingAvatar(true);

        try {
            const formData = new FormData();

            formData.append("avatar", file);

            const { data } = await api.post(
                "/users/profile/avatar",
                formData,
                {
                    timeout: 60000,
                }
            );

            if (!data?.user?._id) {
                throw new Error(
                    "Updated profile was not returned."
                );
            }

            if (typeof updateUserProfile === "function") {
                updateUserProfile(data.user);
            } else if (typeof refreshUser === "function") {
                await refreshUser();
            }

            toast.success(
                "Profile picture updated successfully."
            );
        } catch (error) {
            toast.error(
                getFriendlyError(
                    error,
                    "Couldn't upload your profile picture."
                )
            );
        } finally {
            setUploadingAvatar(false);
        }
    }

    // ================== DELETE CONFIRMATION ==================
    function openDeleteDialog() {
        setConfirmationText("");
        setShowDeleteDialog(true);
    }

    function closeDeleteDialog() {
        if (clearingHistory) return;

        setConfirmationText("");
        setShowDeleteDialog(false);
    }

    // ================== CLEAR CHAT HISTORY ==================
    async function handleClearHistory() {
        if (
            clearingHistory ||
            confirmationText !== "DELETE"
        ) {
            return;
        }

        setClearingHistory(true);

        try {
            await api.delete(
                "/users/chat-history",
                {
                    timeout: 60000,
                }
            );

            setShowDeleteDialog(false);
            setConfirmationText("");

            toast.success(
                "Your chat history has been cleared."
            );

            window.location.replace("/chat");
        } catch (error) {
            toast.error(
                getFriendlyError(
                    error,
                    "Couldn't clear your chat history."
                )
            );
        } finally {
            setClearingHistory(false);
        }
    }

    return (
        <main className="container-fluid qnp-page">

            {/* ================== PREMIUM PROFILE STYLES ================== */}
            <style>
                {`
                .qnp-page {
                    width: 100%;
                    min-width: 0;
                    min-height: 100%;
                    height: 100%;
                    overflow-x: hidden;
                    overflow-y: auto;
                    padding: clamp(16px, 2.8vw, 34px);
                    padding-bottom: 55px;
                    background: #f5f7fc;
                    color: #223653;
                }

                .qnp-page * {
                    box-sizing: border-box;
                }

                .qnp-hero {
                    position: relative;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 24px;
                    min-height: 212px;
                    overflow: hidden;
                    padding: clamp(22px, 3vw, 35px);
                    border: 1px solid #233e67;
                    border-radius: 21px;
                    background:
                        radial-gradient(circle at 85% 12%, rgba(91,109,230,.27), transparent 34%),
                        radial-gradient(circle at 70% 110%, rgba(22,168,240,.14), transparent 34%),
                        linear-gradient(120deg, #0e1c34, #142b4e 65%, #1b3460);
                    box-shadow: 0 14px 35px rgba(17,37,69,.12);
                }

                .qnp-hero::after {
                    content: "";
                    position: absolute;
                    width: 240px;
                    height: 240px;
                    right: -95px;
                    top: -135px;
                    border: 1px solid rgba(255,255,255,.13);
                    border-radius: 50%;
                    pointer-events: none;
                }

                .qnp-hero-content {
                    position: relative;
                    z-index: 1;
                    display: flex;
                    align-items: center;
                    gap: 20px;
                    min-width: 0;
                }

                .qnp-avatar {
                    display: grid;
                    place-items: center;
                    width: 85px;
                    height: 85px;
                    flex-shrink: 0;
                    overflow: hidden;
                    border: 3px solid rgba(255,255,255,.8);
                    border-radius: 24px;
                    background: linear-gradient(135deg, #4266d4, #8266d9);
                    box-shadow: 0 8px 25px rgba(0,0,0,.16);
                    color: #fff;
                    font-size: 27px;
                    font-weight: 700;
                }

                .qnp-avatar img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                }

                .qnp-eyebrow {
                    margin: 0 0 7px;
                    color: #a3bfe9;
                    font-size: 10px;
                    font-weight: 700;
                    letter-spacing: 1.5px;
                    text-transform: uppercase;
                }

                .qnp-hero h1 {
                    margin: 0 0 7px;
                    color: #fff;
                    font-size: clamp(21px, 2.6vw, 31px);
                    font-weight: 750;
                    letter-spacing: -.6px;
                    line-height: 1.3;
                    overflow-wrap: anywhere;
                }

                .qnp-hero-subtitle {
                    margin: 0;
                    color: #b9c9e3;
                    font-size: 12px;
                    line-height: 1.7;
                }

                .qnp-hero-badges {
                    display: flex;
                    gap: 9px;
                    flex-wrap: wrap;
                    justify-content: flex-end;
                }

                .qnp-hero-badge {
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    padding: 9px 12px;
                    border: 1px solid rgba(188,211,255,.18);
                    border-radius: 10px;
                    background: rgba(255,255,255,.07);
                    color: #dde9fc;
                    font-size: 11px;
                    white-space: nowrap;
                }

                .qnp-section-grid {
                    display: grid;
                    grid-template-columns: minmax(290px, .9fr) minmax(0, 1.5fr);
                    align-items: start;
                    gap: 20px;
                    margin-top: 21px;
                }

                .qnp-card {
                    min-width: 0;
                    padding: clamp(18px, 2.1vw, 26px);
                    border: 1px solid #e1e7f1;
                    border-radius: 17px;
                    background: #fff;
                    box-shadow: 0 5px 22px rgba(28,48,83,.035);
                }

                .qnp-card-heading {
                    display: flex;
                    align-items: flex-start;
                    justify-content: space-between;
                    gap: 14px;
                    margin-bottom: 22px;
                }

                .qnp-card h2 {
                    margin: 0;
                    color: #203653;
                    font-size: 16px;
                    font-weight: 750;
                    letter-spacing: -.2px;
                }

                .qnp-description {
                    margin: 6px 0 0;
                    color: #8391a5;
                    font-size: 12px;
                    line-height: 1.7;
                }

                .qnp-section-icon {
                    display: grid;
                    place-items: center;
                    width: 37px;
                    height: 37px;
                    flex-shrink: 0;
                    border-radius: 11px;
                    background: #edf3fd;
                    color: #456ca9;
                    font-size: 15px;
                }

                .qnp-field {
                    margin-bottom: 17px;
                }

                .qnp-label {
                    display: block;
                    margin-bottom: 7px;
                    color: #455c77;
                    font-size: 12px;
                    font-weight: 650;
                }

                .qnp-input {
                    display: block;
                    width: 100%;
                    min-width: 0;
                    height: 44px;
                    padding: 10px 12px;
                    border: 1px solid #dce4ef;
                    border-radius: 10px;
                    outline: none;
                    background: #fff;
                    color: #263c5b;
                    font-size: 13px;
                    transition: border-color .18s, box-shadow .18s;
                }

                .qnp-input:focus {
                    border-color: #688ed3;
                    box-shadow: 0 0 0 3px rgba(79,123,212,.1);
                }

                .qnp-input[readonly] {
                    background: #f6f8fc;
                    color: #76869b;
                    cursor: default;
                }

                .qnp-form-divider {
                    height: 1px;
                    margin: 21px 0;
                    background: #edf0f5;
                }

                .qnp-photo-row {
                    display: flex;
                    align-items: center;
                    gap: 14px;
                    margin-bottom: 18px;
                }

                .qnp-photo-preview {
                    display: grid;
                    place-items: center;
                    width: 60px;
                    height: 60px;
                    flex-shrink: 0;
                    overflow: hidden;
                    border-radius: 16px;
                    background: #eaf0fc;
                    color: #456caa;
                    font-size: 19px;
                    font-weight: 750;
                }

                .qnp-photo-preview img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                }

                .qnp-btn {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    min-height: 38px;
                    padding: 8px 14px;
                    border-radius: 9px;
                    font-size: 12px;
                    font-weight: 650;
                    text-decoration: none;
                    transition: opacity .15s, transform .15s, background .15s;
                    cursor: pointer;
                }

                .qnp-btn:hover:not(:disabled) {
                    transform: translateY(-1px);
                }

                .qnp-btn:disabled {
                    opacity: .5;
                    cursor: not-allowed;
                }

                .qnp-btn-primary {
                    border: 1px solid #345eac;
                    background: linear-gradient(110deg, #3467bb, #435bc1);
                    color: #fff;
                }

                .qnp-btn-secondary {
                    border: 1px solid #dce5f1;
                    background: #fff;
                    color: #4c6685;
                }

                .qnp-btn-danger {
                    border: 1px solid #ebc8ce;
                    background: #fff7f8;
                    color: #b34655;
                }

                .qnp-usage-heading {
                    display: flex;
                    align-items: flex-start;
                    justify-content: space-between;
                    flex-wrap: wrap;
                    gap: 12px;
                    margin-bottom: 19px;
                }

                .qnp-usage-tag {
                    padding: 6px 10px;
                    border: 1px solid #e1e9f6;
                    border-radius: 30px;
                    background: #f3f7fe;
                    color: #5376a9;
                    font-size: 10px;
                    font-weight: 650;
                }

                .qnp-period-grid {
                    display: grid;
                    grid-template-columns: repeat(3, minmax(0, 1fr));
                    gap: 11px;
                    margin-bottom: 19px;
                }

                .qnp-period-card {
                    display: flex;
                    flex-direction: column;
                    align-items: stretch;
                    min-width: 0;
                    padding: 15px;
                    border: 1px solid #e3eaf4;
                    border-radius: 13px;
                    background: #f9fbff;
                    text-align: left;
                    cursor: pointer;
                    transition: border-color .18s, background .18s, box-shadow .18s;
                }

                .qnp-period-card:hover {
                    border-color: #afc4ea;
                }

                .qnp-period-card.active {
                    border-color: #82a4e4;
                    background: #f0f5ff;
                    box-shadow: inset 0 0 0 1px rgba(79,119,193,.08);
                }

                .qnp-period-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 6px;
                    color: #667c98;
                    font-size: 11px;
                    font-weight: 650;
                }

                .qnp-period-header i {
                    color: #7899c2;
                }

                .qnp-period-number {
                    margin-top: 17px;
                    color: #233c5f;
                    font-size: clamp(23px, 2.3vw, 31px);
                    font-weight: 750;
                    letter-spacing: -.7px;
                    line-height: 1.1;
                }

                .qnp-period-caption {
                    margin-top: 4px;
                    color: #8796ab;
                    font-size: 10px;
                }

                .qnp-period-footer {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    margin-top: 15px;
                    padding-top: 12px;
                    border-top: 1px solid #e4eaf4;
                    color: #526c92;
                    font-size: 11px;
                    font-weight: 600;
                }

                .qnp-insight-panel {
                    padding: 18px;
                    border: 1px solid #e4eaf3;
                    border-radius: 13px;
                    background: #fbfcff;
                }

                .qnp-insight-title {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    gap: 10px;
                    margin-bottom: 19px;
                    color: #415a79;
                    font-size: 12px;
                    font-weight: 700;
                }

                .qnp-progress-item + .qnp-progress-item {
                    margin-top: 20px;
                }

                .qnp-progress-heading {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 10px;
                    margin-bottom: 9px;
                }

                .qnp-progress-heading > span {
                    display: inline-flex;
                    align-items: center;
                    gap: 7px;
                    color: #667a94;
                    font-size: 11px;
                }

                .qnp-progress-heading strong {
                    color: #344d6e;
                    font-size: 12px;
                    font-weight: 700;
                    white-space: nowrap;
                }

                .qnp-progress-heading small {
                    color: #9aa6b6;
                    font-size: 11px;
                    font-weight: 400;
                }

                .qnp-progress-track {
                    height: 7px;
                    overflow: hidden;
                    border-radius: 20px;
                    background: #e9eef7;
                }

                .qnp-progress-fill {
                    height: 100%;
                    border-radius: inherit;
                    background: linear-gradient(90deg, #528dd6, #7768d7);
                }

                .qnp-progress-warning {
                    background: #d78b65;
                }

                .qnp-muted {
                    color: #97a3b4;
                    font-size: 11px;
                }

                .qnp-no-limit {
                    margin: 3px 0 0;
                }

                .qnp-insight-footer {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                    margin-top: 20px;
                    padding-top: 15px;
                    border-top: 1px solid #e6ebf4;
                    color: #71839b;
                    font-size: 11px;
                }

                .qnp-insight-footer strong {
                    color: #385b88;
                    font-size: 13px;
                }

                .qnp-provider-grid {
                    display: grid;
                    grid-template-columns: repeat(2, minmax(0, 1fr));
                    gap: 11px;
                    margin-top: 15px;
                }

                .qnp-provider-card {
                    padding: 13px;
                    border: 1px solid #e5ebf4;
                    border-radius: 11px;
                    background: #fff;
                }

                .qnp-provider-card strong {
                    display: block;
                    color: #294465;
                    font-size: 19px;
                    margin-top: 8px;
                }

                .qnp-lower-grid {
                    display: grid;
                    grid-template-columns: repeat(2, minmax(0, 1fr));
                    gap: 20px;
                    margin-top: 20px;
                }

                .qnp-info-row {
                    display: flex;
                    align-items: flex-start;
                    gap: 13px;
                    padding: 14px 0;
                }

                .qnp-info-row + .qnp-info-row {
                    border-top: 1px solid #eef1f6;
                }

                .qnp-info-icon {
                    display: grid;
                    place-items: center;
                    width: 34px;
                    height: 34px;
                    flex-shrink: 0;
                    border-radius: 10px;
                    background: #f0f4fb;
                    color: #547bb0;
                }

                .qnp-info-row h3 {
                    margin: 0 0 5px;
                    color: #3f5877;
                    font-size: 12px;
                    font-weight: 700;
                }

                .qnp-info-row p {
                    margin: 0;
                    color: #8593a6;
                    font-size: 11px;
                    line-height: 1.75;
                }

                .qnp-danger-card {
                    border-color: #efdfe2;
                    background: #fffefe;
                }

                .qnp-dialog-backdrop {
                    position: fixed;
                    inset: 0;
                    z-index: 1500;
                    display: grid;
                    place-items: center;
                    padding: 15px;
                    background: rgba(13,24,42,.64);
                    backdrop-filter: blur(5px);
                }

                .qnp-dialog {
                    width: 100%;
                    max-width: 435px;
                    padding: 26px;
                    border: 1px solid #e9ecf3;
                    border-radius: 19px;
                    background: #fff;
                    box-shadow: 0 24px 75px rgba(5,18,37,.24);
                }

                .qnp-dialog h2 {
                    margin: 0 0 9px;
                    color: #23374e;
                    font-size: 19px;
                    font-weight: 750;
                }

                .qnp-dialog p {
                    color: #7c899d;
                    font-size: 12px;
                    line-height: 1.8;
                }

                .qnp-dialog-actions {
                    display: flex;
                    justify-content: flex-end;
                    flex-wrap: wrap;
                    gap: 9px;
                    margin-top: 20px;
                }

                @media (max-width: 1050px) {
                    .qnp-section-grid {
                        grid-template-columns: 1fr;
                    }
                }

                @media (max-width: 720px) {
                    .qnp-hero {
                        align-items: flex-start;
                        flex-direction: column;
                        min-height: auto;
                    }

                    .qnp-hero-badges {
                        justify-content: flex-start;
                    }

                    .qnp-lower-grid {
                        grid-template-columns: 1fr;
                    }
                }

                @media (max-width: 500px) {
                    .qnp-hero-content {
                        align-items: flex-start;
                        flex-direction: column;
                    }

                    .qnp-avatar {
                        width: 72px;
                        height: 72px;
                        border-radius: 18px;
                    }

                    .qnp-period-grid {
                        grid-template-columns: 1fr;
                    }

                    .qnp-period-card {
                        padding: 14px;
                    }

                    .qnp-period-number {
                        margin-top: 10px;
                    }

                    .qnp-period-footer {
                        margin-top: 10px;
                    }
                }
                `}
            </style>

            {/* ================== PROFILE HERO ================== */}
            <section className="qnp-hero">
                <div className="qnp-hero-content">
                    <div className="qnp-avatar">
                        {avatarUrl && !avatarBroken ? (
                            <img
                                src={avatarUrl}
                                alt="Profile"
                                referrerPolicy="no-referrer"
                                onError={() =>
                                    setAvatarBroken(true)
                                }
                            />
                        ) : (
                            userInitials
                        )}
                    </div>

                    <div>
                        <p className="qnp-eyebrow">
                            QueryNest AI / My Workspace
                        </p>

                        <h1>
                            Welcome back, {userName}
                        </h1>

                        <p className="qnp-hero-subtitle">
                            Manage your profile, understand your AI
                            usage and stay in control of your data.
                        </p>
                    </div>
                </div>

                <div className="qnp-hero-badges">
                    <span className="qnp-hero-badge">
                        <i
                            className="fa-regular fa-circle-user"
                            aria-hidden="true"
                        />
                        My Account
                    </span>

                    {memberSince && (
                        <span className="qnp-hero-badge">
                            <i
                                className="fa-regular fa-calendar"
                                aria-hidden="true"
                            />
                            Member since {memberSince}
                        </span>
                    )}

                    <Link
                        to="/chat"
                        className="qnp-hero-badge"
                        style={{
                            textDecoration: "none",
                        }}
                    >
                        <i
                            className="fa-solid fa-arrow-left"
                            aria-hidden="true"
                        />
                        Back to Chat
                    </Link>
                </div>
            </section>

            {/* ================== MAIN DASHBOARD ================== */}
            <div className="qnp-section-grid">

                {/* ================== PERSONAL INFORMATION ================== */}
                <section
                    id="qnp-personal"
                    className="qnp-card"
                    aria-labelledby="qnp-personal-title"
                >
                    <div className="qnp-card-heading">
                        <div>
                            <h2 id="qnp-personal-title">
                                Personal Information
                            </h2>

                            <p className="qnp-description">
                                Keep your profile details up to date.
                            </p>
                        </div>

                        <div className="qnp-section-icon">
                            <i
                                className="fa-regular fa-user"
                                aria-hidden="true"
                            />
                        </div>
                    </div>

                    {/* ================== PROFILE PICTURE ================== */}
                    <div className="qnp-photo-row">
                        <div className="qnp-photo-preview">
                            {avatarUrl && !avatarBroken ? (
                                <img
                                    src={avatarUrl}
                                    alt="Your profile picture"
                                    referrerPolicy="no-referrer"
                                    onError={() =>
                                        setAvatarBroken(true)
                                    }
                                />
                            ) : (
                                userInitials
                            )}
                        </div>

                        <div style={{ minWidth: 0 }}>
                            <strong
                                style={{
                                    display: "block",
                                    color: "#344d6b",
                                    fontSize: 12,
                                    marginBottom: 4,
                                }}
                            >
                                Profile Photo
                            </strong>

                            <p className="qnp-muted mb-2">
                                JPG, PNG or WebP · Max 3 MB
                            </p>

                            <button
                                type="button"
                                className="qnp-btn qnp-btn-secondary"
                                disabled={uploadingAvatar}
                                onClick={() =>
                                    avatarInputRef.current?.click()
                                }
                            >
                                <i
                                    className={
                                        uploadingAvatar
                                            ? "fa-solid fa-spinner fa-spin"
                                            : "fa-solid fa-camera"
                                    }
                                    aria-hidden="true"
                                />

                                {uploadingAvatar
                                    ? "Uploading..."
                                    : "Change Photo"}
                            </button>
                        </div>

                        <input
                            ref={avatarInputRef}
                            type="file"
                            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                            onChange={handleAvatarChange}
                            disabled={uploadingAvatar}
                            aria-label="Choose profile picture"
                            hidden
                        />
                    </div>

                    <div className="qnp-form-divider" />

                    {/* ================== PROFILE DETAILS FORM ================== */}
                    <form onSubmit={handleSaveName}>
                        <div className="qnp-field">
                            <label
                                htmlFor="qnp-name"
                                className="qnp-label"
                            >
                                Full Name
                            </label>

                            <input
                                id="qnp-name"
                                className="qnp-input"
                                type="text"
                                value={name}
                                onChange={(event) =>
                                    setName(event.target.value)
                                }
                                minLength={2}
                                maxLength={100}
                                autoComplete="name"
                                disabled={savingName}
                                required
                            />
                        </div>

                        <div className="qnp-field">
                            <label
                                htmlFor="qnp-email"
                                className="qnp-label"
                            >
                                Email Address
                            </label>

                            <input
                                id="qnp-email"
                                className="qnp-input"
                                type="email"
                                value={user?.email || ""}
                                readOnly
                            />
                        </div>

                        <div className="qnp-field">
                            <label
                                htmlFor="qnp-phone"
                                className="qnp-label"
                            >
                                Mobile Number
                            </label>

                            <input
                                id="qnp-phone"
                                className="qnp-input"
                                type="text"
                                value={
                                    user?.phone ||
                                    user?.mobile ||
                                    ""
                                }
                                readOnly
                            />
                        </div>

                        <button
                            type="submit"
                            className="qnp-btn qnp-btn-primary"
                            disabled={
                                savingName ||
                                !name.trim() ||
                                name.trim() === user?.name
                            }
                        >
                            <i
                                className={
                                    savingName
                                        ? "fa-solid fa-spinner fa-spin"
                                        : "fa-regular fa-floppy-disk"
                                }
                                aria-hidden="true"
                            />

                            {savingName
                                ? "Saving..."
                                : "Save Changes"}
                        </button>

                        <p
                            className="qnp-muted"
                            style={{
                                margin: "13px 0 0",
                                lineHeight: 1.7,
                            }}
                        >
                            Email and mobile number are read-only
                            for account security.
                        </p>
                    </form>
                </section>

                {/* ================== USAGE DASHBOARD ================== */}
                <section
                    className="qnp-card"
                    aria-labelledby="qnp-usage-title"
                >
                    <div className="qnp-usage-heading">
                        <div>
                            <h2 id="qnp-usage-title">
                                AI Usage & Limits
                            </h2>

                            <p className="qnp-description">
                                Monitor your requests and token
                                consumption across different periods.
                            </p>
                        </div>

                        <span className="qnp-usage-tag">
                            <i
                                className="fa-solid fa-chart-simple me-1"
                                aria-hidden="true"
                            />
                            Usage Overview
                        </span>
                    </div>

                    {/* ================== LOADING STATE ================== */}
                    {usageLoading && (
                        <p
                            role="status"
                            className="qnp-description mb-3"
                        >
                            <i
                                className="fa-solid fa-spinner fa-spin me-2"
                                aria-hidden="true"
                            />
                            Loading your usage...
                        </p>
                    )}

                    {usageError && !usageLoading && (
                        <div
                            role="status"
                            style={{
                                padding: "11px 13px",
                                marginBottom: 15,
                                border: "1px solid #e4e9f2",
                                borderRadius: 10,
                                background: "#f8faff",
                                color: "#73839b",
                                fontSize: 12,
                            }}
                        >
                            <i
                                className="fa-solid fa-circle-info me-2"
                                aria-hidden="true"
                            />
                            {usageError}
                        </div>
                    )}

                    {/* ================== DAILY/WEEKLY/MONTHLY ================== */}
                    <div className="qnp-period-grid">
                        {PERIODS.map((period) => (
                            <PeriodCard
                                key={period.key}
                                period={period}
                                data={periodMap[period.key]}
                                active={
                                    selectedPeriod === period.key
                                }
                                onClick={() =>
                                    setSelectedPeriod(period.key)
                                }
                            />
                        ))}
                    </div>

                    {/* ================== SELECTED PERIOD DETAILS ================== */}
                    <div className="qnp-insight-panel">
                        <div className="qnp-insight-title">
                            <span>
                                <i
                                    className="fa-solid fa-chart-line me-2"
                                    aria-hidden="true"
                                />

                                {periodLabel} — Detailed Usage
                            </span>

                            <span className="qnp-muted">
                                Your account
                            </span>
                        </div>

                        <UsageProgress
                            icon="fa-regular fa-comments"
                            label="AI Requests"
                            value={currentUsage.requests}
                            limit={currentUsage.requestLimit}
                        />

                        <UsageProgress
                            icon="fa-solid fa-bolt"
                            label="Tokens Consumed"
                            value={currentUsage.tokens}
                            limit={currentUsage.tokenLimit}
                        />

                        <div className="qnp-insight-footer">
                            <span>
                                Average tokens per AI request
                            </span>

                            <strong>
                                {formatNumber(averageTokens)}
                            </strong>
                        </div>
                    </div>

                    {/* ================== PROVIDER BREAKDOWN ================== */}
                    {showProviderBreakdown && (
                        <div className="qnp-provider-grid">
                            <div className="qnp-provider-card">
                                <span className="qnp-muted">
                                    Groq Requests
                                </span>

                                <strong>
                                    {formatNumber(groqRequests)}
                                </strong>
                            </div>

                            <div className="qnp-provider-card">
                                <span className="qnp-muted">
                                    Gemini Requests
                                </span>

                                <strong>
                                    {formatNumber(geminiRequests)}
                                </strong>
                            </div>
                        </div>
                    )}

                    <p
                        className="qnp-muted"
                        style={{
                            lineHeight: 1.8,
                            margin: "16px 0 0",
                        }}
                    >
                        Usage values are based on available
                        application records. Groq and Gemini
                        provider quotas are shared, so they are
                        not individual user allowances.
                    </p>
                </section>
            </div>

            {/* ================== SECURITY & DATA MANAGEMENT ================== */}
            <div className="qnp-lower-grid">

                {/* ================== SECURITY ================== */}
                <section
                    className="qnp-card"
                    aria-labelledby="qnp-security-title"
                >
                    <div className="qnp-card-heading">
                        <div>
                            <h2 id="qnp-security-title">
                                Security & Privacy
                            </h2>

                            <p className="qnp-description">
                                Learn how to manage your account securely.
                            </p>
                        </div>

                        <div className="qnp-section-icon">
                            <i
                                className="fa-solid fa-shield-halved"
                                aria-hidden="true"
                            />
                        </div>
                    </div>

                    <div className="qnp-info-row">
                        <div className="qnp-info-icon">
                            <i
                                className="fa-solid fa-key"
                                aria-hidden="true"
                            />
                        </div>

                        <div>
                            <h3>Password Security</h3>

                            <p>
                                To change your password, sign out
                                and use Forgot Password on the
                                Sign In page.
                            </p>
                        </div>
                    </div>

                    <div className="qnp-info-row">
                        <div className="qnp-info-icon">
                            <i
                                className="fa-regular fa-envelope"
                                aria-hidden="true"
                            />
                        </div>

                        <div>
                            <h3>Email Verification</h3>

                            <p>
                                Password recovery OTPs are sent
                                to your registered email address.
                            </p>
                        </div>
                    </div>

                    <div className="qnp-info-row">
                        <div className="qnp-info-icon">
                            <i
                                className="fa-regular fa-file-lines"
                                aria-hidden="true"
                            />
                        </div>

                        <div>
                            <h3>Document Privacy</h3>

                            <p>
                                Document content may be processed
                                by external AI providers when needed
                                to answer your questions.
                            </p>
                        </div>
                    </div>
                </section>

                {/* ================== DELETE HISTORY ================== */}
                <section
                    className="qnp-card qnp-danger-card"
                    aria-labelledby="qnp-delete-title"
                >
                    <div className="qnp-card-heading">
                        <div>
                            <h2 id="qnp-delete-title">
                                Data Management
                            </h2>

                            <p className="qnp-description">
                                Manage your saved conversation history.
                            </p>
                        </div>

                        <div
                            className="qnp-section-icon"
                            style={{
                                background: "#fff0f1",
                                color: "#ba5563",
                            }}
                        >
                            <i
                                className="fa-regular fa-trash-can"
                                aria-hidden="true"
                            />
                        </div>
                    </div>

                    <div
                        style={{
                            padding: "17px",
                            border: "1px solid #f1e1e4",
                            borderRadius: 12,
                            background: "#fff9fa",
                        }}
                    >
                        <strong
                            style={{
                                display: "block",
                                color: "#9f4552",
                                fontSize: 13,
                                marginBottom: 9,
                            }}
                        >
                            Clear All Chat History
                        </strong>

                        <p
                            style={{
                                color: "#886f76",
                                fontSize: 12,
                                lineHeight: 1.85,
                                margin: "0 0 17px",
                            }}
                        >
                            Delete your conversations, AI messages,
                            linked documents, chunks and embeddings
                            stored in the application. This action
                            cannot be undone. External providers and
                            backups may have separate retention periods.
                        </p>

                        <button
                            type="button"
                            className="qnp-btn qnp-btn-danger"
                            onClick={openDeleteDialog}
                        >
                            <i
                                className="fa-regular fa-trash-can"
                                aria-hidden="true"
                            />

                            Clear All Chat History
                        </button>
                    </div>

                    <p
                        className="qnp-muted"
                        style={{
                            margin: "15px 0 0",
                            lineHeight: 1.75,
                        }}
                    >
                        This action does not delete your QueryNest AI
                        user account.
                    </p>
                </section>
            </div>

            {/* ================== PAGE FOOTER ================== */}
            <footer
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: 10,
                    marginTop: 23,
                    padding: "0 5px",
                    color: "#9aa6b8",
                    fontSize: 11,
                }}
            >
                <span>
                    QueryNest AI · Your personal AI workspace
                </span>

                <span>
                    Manage smarter. Work better.
                </span>
            </footer>

            {/* ================== CLEAR HISTORY DIALOG ================== */}
            {showDeleteDialog && (
                <div className="qnp-dialog-backdrop">
                    <div
                        className="qnp-dialog"
                        role="alertdialog"
                        aria-modal="true"
                        aria-labelledby="qnp-dialog-title"
                        aria-describedby="qnp-dialog-description"
                    >
                        <div
                            style={{
                                display: "grid",
                                placeItems: "center",
                                width: 46,
                                height: 46,
                                marginBottom: 17,
                                borderRadius: 13,
                                background: "#fff0f1",
                                color: "#bb4e5b",
                                fontSize: 19,
                            }}
                        >
                            <i
                                className="fa-solid fa-triangle-exclamation"
                                aria-hidden="true"
                            />
                        </div>

                        <h2 id="qnp-dialog-title">
                            Delete all conversations?
                        </h2>

                        <p id="qnp-dialog-description">
                            This permanently removes your saved
                            conversations, messages and linked
                            document data from the application.
                            The action cannot be undone.
                        </p>

                        <label
                            className="qnp-label"
                            htmlFor="qnp-delete-confirmation"
                        >
                            Type DELETE to confirm
                        </label>

                        <input
                            id="qnp-delete-confirmation"
                            ref={confirmationInputRef}
                            className="qnp-input"
                            type="text"
                            value={confirmationText}
                            onChange={(event) =>
                                setConfirmationText(event.target.value)
                            }
                            autoComplete="off"
                            placeholder="DELETE"
                            disabled={clearingHistory}
                        />

                        <div className="qnp-dialog-actions">
                            <button
                                type="button"
                                className="qnp-btn qnp-btn-secondary"
                                onClick={closeDeleteDialog}
                                disabled={clearingHistory}
                            >
                                Cancel
                            </button>

                            <button
                                type="button"
                                className="qnp-btn"
                                onClick={handleClearHistory}
                                disabled={
                                    clearingHistory ||
                                    confirmationText !== "DELETE"
                                }
                                style={{
                                    border: "1px solid #b94f5a",
                                    background: "#b94f5a",
                                    color: "#fff",
                                }}
                            >
                                {clearingHistory ? (
                                    <>
                                        <i
                                            className="fa-solid fa-spinner fa-spin"
                                            aria-hidden="true"
                                        />
                                        Deleting...
                                    </>
                                ) : (
                                    <>
                                        <i
                                            className="fa-regular fa-trash-can"
                                            aria-hidden="true"
                                        />
                                        Delete All Chats
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}

export default Profile;
