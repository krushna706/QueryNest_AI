
import usePageSEO from "../hooks/usePageSEO";
import { seoPages } from "../config/seoConfig";

import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { TextField, InputAdornment, IconButton, Button } from "@mui/material";
import { toast } from "react-toastify";

import AuthLayout from "../layouts/AuthLayout";
import { useAuth } from "../context/AuthContext";

// Login error message
function getLoginErrorMessage(error) {
    if (error.response?.status === 429) {
        const retryAfter = error.response.headers?.["retry-after"];
        let seconds = Number(retryAfter);

        if (retryAfter && !Number.isFinite(seconds)) {
            seconds = (Date.parse(retryAfter) - Date.now()) / 1000;
        }

        if (Number.isFinite(seconds) && seconds > 0) {
            const minutes = Math.ceil(seconds / 60);

            return `Too many login attempts. Please try again after ${minutes} minute${minutes === 1 ? "" : "s"}.`;
        }

        return "Too many login attempts. Please try again later.";
    }

    if (error.code === "ECONNABORTED") {
        return "The request timed out. Please try again.";
    }

    if (!error.response) {
        return "Unable to connect to the server. Please try again.";
    }

    return error.response.data?.message || "Unable to login. Please try again.";
}

// Login page
function Login() {
    usePageSEO(seoPages.login);
    
    const { login, loading } = useAuth();

    const [showPassword, setShowPassword] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const submitLock = useRef(false);

    async function handleSubmit(event) {
        event.preventDefault();

        if (submitLock.current || loading) {
            return;
        }

        const formData = new FormData(event.currentTarget);

        const identifier = String(formData.get("identifier") || "")
            .trim()
            .toLowerCase();

        const password = String(formData.get("password") || "");

        if (!identifier || !password) {
            toast.error("Email or phone number and password are required.");
            return;
        }

        const isEmail = identifier.includes("@");

        if (isEmail) {
            if (identifier.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) {
                toast.error("Enter a valid email address.");
                return;
            }
        } else if (!/^[6-9]\d{9}$/.test(identifier)) {
            toast.error("Enter a valid email address or 10-digit mobile number.");
            return;
        }

        if (new TextEncoder().encode(password).length > 72) {
            toast.error("Password cannot exceed 72 UTF-8 bytes.");
            return;
        }

        submitLock.current = true;
        setIsSubmitting(true);

        try {
            const data = await login({ identifier, password });

            toast.success(data.message || "Login successful.");
        } catch (error) {
            toast.error(getLoginErrorMessage(error));
        } finally {
            submitLock.current = false;
            setIsSubmitting(false);
        }
    }

    const formDisabled = loading || isSubmitting;

    return (
        <AuthLayout title="Welcome Back" description="Sign in to continue your conversations with QueryNest AI.">
            <form className="auth-form" onSubmit={handleSubmit} aria-busy={formDisabled} noValidate>
                {/* Email or Phone */}
                <TextField
                    id="login-identifier"
                    name="identifier"
                    label="Email or Phone Number"
                    type="text"
                    variant="outlined"
                    className="auth-text-field"
                    autoComplete="username"
                    disabled={formDisabled}
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

                {/* Password */}
                <TextField
                    id="login-password"
                    name="password"
                    label="Password"
                    type={showPassword ? "text" : "password"}
                    variant="outlined"
                    className="auth-text-field"
                    autoComplete="current-password"
                    disabled={formDisabled}
                    fullWidth
                    required
                    slotProps={{
                        htmlInput: {
                            maxLength: 72,
                        },
                        input: {
                            endAdornment: (
                                <InputAdornment position="end">
                                    <IconButton
                                        type="button"
                                        className="auth-password-toggle"
                                        disabled={formDisabled}
                                        aria-label={showPassword ? "Hide password" : "Show password"}
                                        aria-pressed={showPassword}
                                        aria-controls="login-password"
                                        onClick={() => setShowPassword((current) => !current)}
                                        onMouseDown={(event) => event.preventDefault()}
                                        edge="end"
                                    >
                                        <i
                                            className={`fa-solid ${showPassword ? "fa-eye-slash" : "fa-eye"}`}
                                            aria-hidden="true"
                                        />
                                    </IconButton>
                                </InputAdornment>
                            ),
                        },
                    }}
                />

                {/* Submit */}
                <Button
                    type="submit"
                    variant="contained"
                    className="auth-submit"
                    disabled={formDisabled}
                    disableElevation
                    fullWidth
                >
                    {loading ? "Checking session..." : isSubmitting ? "Signing in..." : "Sign In"}

                    <i className="fa-solid fa-arrow-right" aria-hidden="true" />
                </Button>
            </form>

            {/* Account Links */}
            <div className="auth-account-row">
                <p className="auth-switch">
                    New here? <Link to="/signup">Create an account</Link>
                </p>

                <Link to="/forgot-password" className="auth-forgot-link">
                    Forgot password?
                </Link>
            </div>
        </AuthLayout>
    );
}

export default Login;
