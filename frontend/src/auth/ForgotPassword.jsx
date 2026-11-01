import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, CircularProgress, IconButton, InputAdornment, TextField } from "@mui/material";
import { toast } from "react-toastify";

import AuthLayout from "../layouts/AuthLayout";
import api from "../services/api";

// Recovery configuration
const OTP_LENGTH = 6;
const OTP_VALIDITY_MINUTES = 10;
const DEFAULT_RESEND_SECONDS = 60;

// Recovery steps
const recoverySteps = [
    {
        title: "Forgot Password",
        description: "Enter your registered email or phone number.",
        button: "Send Verification Code",
    },
    {
        title: "Verify Email OTP",
        description: "Enter the 6-digit code sent to your registered email.",
        button: "Verify OTP",
    },
    {
        title: "Reset Password",
        description: "Create a new password to access your account.",
        button: "Reset Password",
    },
];

// Api error message
function getErrorMessage(error, fallback) {
    if (error.response?.status === 429) {
        return "Too many requests. Please try again later.";
    }

    if (error.code === "ECONNABORTED") {
        return "The request timed out. Please try again.";
    }

    if (!error.response) {
        return "Unable to connect to the server. Please try again.";
    }

    return error.response.data?.message || fallback;
}

// Identifier validation
function validIdentifier(value) {
    return /^[6-9]\d{9}$/.test(value) || (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254);
}

// Password visibility
function PasswordVisibility({ visible, onToggle, label, disabled }) {
    return (
        <InputAdornment position="end">
            <IconButton
                type="button"
                className="auth-password-toggle"
                aria-label={visible ? `Hide ${label}` : `Show ${label}`}
                aria-pressed={visible}
                onClick={onToggle}
                onMouseDown={(event) => event.preventDefault()}
                disabled={disabled}
                edge="end"
            >
                <i className={`fa-solid ${visible ? "fa-eye-slash" : "fa-eye"}`} aria-hidden="true" />
            </IconButton>
        </InputAdornment>
    );
}

// Forgot password page
function ForgotPassword() {
    const navigate = useNavigate();
    const submitLock = useRef(false);

    const [step, setStep] = useState(0);
    const [identifier, setIdentifier] = useState("");
    const [otp, setOtp] = useState("");
    const [resetToken, setResetToken] = useState("");
    const [maskedEmail, setMaskedEmail] = useState("");

    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");

    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    const [resendAt, setResendAt] = useState(0);
    const [resendSeconds, setResendSeconds] = useState(0);

    useEffect(() => {
        if (step !== 1 || !resendAt) {
            return;
        }

        const updateRemaining = () => {
            setResendSeconds(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)));
        };

        updateRemaining();

        const timer = setInterval(updateRemaining, 1000);

        return () => clearInterval(timer);
    }, [step, resendAt]);

    function startCooldown(seconds = DEFAULT_RESEND_SECONDS) {
        const duration = Number(seconds);

        const safeSeconds = Number.isFinite(duration) && duration > 0 ? duration : DEFAULT_RESEND_SECONDS;

        setResendAt(Date.now() + safeSeconds * 1000);
        setResendSeconds(Math.ceil(safeSeconds));
    }

    async function requestOtp(isResend = false) {
        const normalized = identifier.trim().toLowerCase();

        if (!validIdentifier(normalized)) {
            setError("Enter a valid email address or 10-digit Indian mobile number.");
            return;
        }

        if (submitLock.current || (isResend && resendSeconds > 0)) {
            return;
        }

        submitLock.current = true;
        setBusy(true);
        setError("");

        try {
            const { data } = await api.post(
                "/auth/forgot-password/request",
                { identifier: normalized },
                { skipSessionHandling: true }
            );

            if (!data?.success) {
                throw new Error("Unable to request OTP.");
            }

            setIdentifier(normalized);
            setOtp("");
            setResetToken("");
            setMaskedEmail("");

            setNotice(data.message || "If your account is active, an OTP will be sent to your registered email.");

            startCooldown(data.resendCooldownSeconds);
            setStep(1);

            if (isResend) {
                toast.info("OTP request submitted.");
            }
        } catch (requestError) {
            setError(getErrorMessage(requestError, "Unable to request OTP."));
        } finally {
            submitLock.current = false;
            setBusy(false);
        }
    }

    async function verifyOtp() {
        if (!/^\d{6}$/.test(otp)) {
            setError("Enter the complete 6-digit OTP.");
            return;
        }

        if (submitLock.current) {
            return;
        }

        submitLock.current = true;
        setBusy(true);
        setError("");

        try {
            const { data } = await api.post(
                "/auth/forgot-password/verify",
                { identifier, otp },
                { skipSessionHandling: true }
            );

            if (!data?.success || !/^[a-f0-9]{64}$/.test(data.resetToken || "")) {
                throw new Error("OTP verification failed.");
            }

            setResetToken(data.resetToken);
            setMaskedEmail(data.maskedEmail || "");
            setOtp("");
            setNotice("");
            setStep(2);

            toast.success("OTP verified successfully.");
        } catch (verifyError) {
            setError(getErrorMessage(verifyError, "Invalid or expired OTP."));
        } finally {
            submitLock.current = false;
            setBusy(false);
        }
    }

    async function resetPassword() {
        if (newPassword.length < 6 || new TextEncoder().encode(newPassword).length > 72) {
            setError("Password must be at least 6 characters and at most 72 UTF-8 bytes.");
            return;
        }

        if (newPassword !== confirmPassword) {
            setError("Passwords do not match.");
            return;
        }

        if (!resetToken) {
            setError("Reset session expired. Please start again.");
            return;
        }

        if (submitLock.current) {
            return;
        }

        submitLock.current = true;
        setBusy(true);
        setError("");

        try {
            const { data } = await api.post(
                "/auth/forgot-password/reset",
                {
                    resetToken,
                    newPassword,
                    confirmPassword,
                },
                { skipSessionHandling: true }
            );

            if (!data?.success) {
                throw new Error("Unable to reset password.");
            }

            setResetToken("");
            setNewPassword("");
            setConfirmPassword("");

            toast.success("Password reset successfully. Please sign in.");

            navigate("/login", { replace: true });
        } catch (resetError) {
            setError(getErrorMessage(resetError, "Unable to reset password."));
        } finally {
            submitLock.current = false;
            setBusy(false);
        }
    }

    function handleSubmit(event) {
        event.preventDefault();

        if (busy || submitLock.current) {
            return;
        }

        if (step === 0) {
            requestOtp();
        } else if (step === 1) {
            verifyOtp();
        } else {
            resetPassword();
        }
    }

    function handleResend() {
        if (step !== 1 || busy || resendSeconds > 0) {
            return;
        }

        requestOtp(true);
    }

    function restartRecovery() {
        if (busy) {
            return;
        }

        setStep(0);
        setIdentifier("");
        setOtp("");
        setResetToken("");
        setMaskedEmail("");
        setNewPassword("");
        setConfirmPassword("");
        setShowPassword(false);
        setShowConfirmPassword(false);
        setResendAt(0);
        setResendSeconds(0);
        setError("");
        setNotice("");
    }

    const currentStep = recoverySteps[step];

    return (
        <AuthLayout
            title={currentStep.title}
            description={currentStep.description}
            footer={
                <p className="auth-switch">
                    Remember your password? <Link to="/login">Sign In</Link>
                </p>
            }
        >
            {/* Recovery Progress */}
            <div className="auth-recovery-question mb-4">
                <span className="auth-feature-icon">
                    <i
                        className={`fa-solid ${
                            step === 0 ? "fa-user-shield" : step === 1 ? "fa-envelope-circle-check" : "fa-lock"
                        }`}
                        aria-hidden="true"
                    />
                </span>

                <div>
                    <p>ACCOUNT RECOVERY</p>
                    <h2>Step {step + 1} of 3</h2>
                </div>
            </div>

            <form className="auth-form" onSubmit={handleSubmit} aria-busy={busy} noValidate>
                {step === 0 && (
                    <TextField
                        id="recovery-identifier"
                        name="identifier"
                        label="Email or Phone Number"
                        type="text"
                        variant="outlined"
                        className="auth-text-field"
                        autoComplete="username"
                        value={identifier}
                        disabled={busy}
                        onChange={(event) => {
                            setIdentifier(event.target.value);
                            setError("");
                        }}
                        fullWidth
                        required
                        slotProps={{
                            htmlInput: {
                                maxLength: 254,
                                autoCapitalize: "none",
                                spellCheck: false,
                            },
                        }}
                    />
                )}
                {step === 1 && (
                    <>
                        <div className="auth-notice" role="status">
                            {notice}
                        </div>

                        <TextField
                            id="recovery-otp"
                            name="otp"
                            label="6-Digit Verification Code"
                            type="text"
                            variant="outlined"
                            className="auth-text-field"
                            value={otp}
                            disabled={busy}
                            onChange={(event) => {
                                setOtp(event.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH));
                                setError("");
                            }}
                            fullWidth
                            required
                            helperText={`OTP expires in ${OTP_VALIDITY_MINUTES} minutes. Maximum 5 incorrect attempts.`}
                            slotProps={{
                                htmlInput: {
                                    maxLength: OTP_LENGTH,
                                    inputMode: "numeric",
                                    pattern: "[0-9]*",
                                    autoComplete: "one-time-code",
                                },
                            }}
                        />

                        <Button
                            type="button"
                            className="auth-restart"
                            disabled={busy || resendSeconds > 0}
                            onClick={handleResend}
                        >
                            {resendSeconds > 0 ? `Resend OTP in ${resendSeconds}s` : "Resend OTP"}
                        </Button>
                    </>
                )}
                {step === 2 && (
                    <>
                        <div className="auth-recovery-question" role="status">
                            <span className="auth-feature-icon">
                                <i className="fa-solid fa-shield-halved" aria-hidden="true" />
                            </span>

                            <div>
                                <p>OTP verified for</p>
                                <h2>{maskedEmail || "Your account"}</h2>
                                <p>Reset authorization expires in 10 minutes.</p>
                            </div>
                        </div>

                        <TextField
                            id="recovery-new-password"
                            name="newPassword"
                            label="New Password"
                            type={showPassword ? "text" : "password"}
                            variant="outlined"
                            className="auth-text-field"
                            autoComplete="new-password"
                            value={newPassword}
                            disabled={busy}
                            onChange={(event) => {
                                setNewPassword(event.target.value);
                                setError("");
                            }}
                            fullWidth
                            required
                            helperText="Minimum 6 characters, maximum 72 UTF-8 bytes."
                            slotProps={{
                                input: {
                                    endAdornment: (
                                        <PasswordVisibility
                                            visible={showPassword}
                                            onToggle={() => setShowPassword((value) => !value)}
                                            label="password"
                                            disabled={busy}
                                        />
                                    ),
                                },
                            }}
                        />

                        <TextField
                            id="recovery-confirm-password"
                            name="confirmPassword"
                            label="Confirm Password"
                            type={showConfirmPassword ? "text" : "password"}
                            variant="outlined"
                            className="auth-text-field"
                            autoComplete="new-password"
                            value={confirmPassword}
                            disabled={busy}
                            onChange={(event) => {
                                setConfirmPassword(event.target.value);
                                setError("");
                            }}
                            fullWidth
                            required
                            slotProps={{
                                input: {
                                    endAdornment: (
                                        <PasswordVisibility
                                            visible={showConfirmPassword}
                                            onToggle={() => setShowConfirmPassword((value) => !value)}
                                            label="confirm password"
                                            disabled={busy}
                                        />
                                    ),
                                },
                            }}
                        />
                    </>
                )}
                {error && (
                    <div className="auth-notice" role="alert">
                        {error}
                    </div>
                )}
                <Button
                    type="submit"
                    variant="contained"
                    className="auth-submit"
                    disabled={busy}
                    disableElevation
                    fullWidth
                >
                    {busy ? (
                        <>
                            <CircularProgress size={18} color="inherit" />
                            Please wait...
                        </>
                    ) : (
                        <>
                            {currentStep.button}
                            <i className="fa-solid fa-arrow-right" aria-hidden="true" />
                        </>
                    )}
                </Button>
                {step > 0 && (
                    <Button type="button" className="auth-restart" onClick={restartRecovery} disabled={busy}>
                        Start Again
                    </Button>
                )}
            </form>
        </AuthLayout>
    );
}

export default ForgotPassword;
