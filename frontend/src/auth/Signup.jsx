
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { TextField, InputAdornment, IconButton, Button } from "@mui/material";
import { toast } from "react-toastify";

import AuthLayout from "../layouts/AuthLayout";
import { useAuth } from "../context/AuthContext";

// ================== SIGNUP ERROR MESSAGE ==================
function getSignupErrorMessage(error) {
    if (error.response?.status === 429) {
        const retryAfter = error.response.headers?.["retry-after"];
        let seconds = Number(retryAfter);

        if (retryAfter && !Number.isFinite(seconds)) {
            seconds = (Date.parse(retryAfter) - Date.now()) / 1000;
        }

        if (Number.isFinite(seconds) && seconds > 0) {
            const minutes = Math.ceil(seconds / 60);

            return `Too many signup attempts. Please try again after ${minutes} minute${minutes === 1 ? "" : "s"}.`;
        }

        return "Too many signup attempts. Please try again later.";
    }

    if (error.code === "ECONNABORTED") {
        return "The request timed out. Your account may have been created. Try signing in before submitting again.";
    }

    if (!error.response) {
        return "Unable to confirm account creation. Check your connection and try signing in.";
    }

    return error.response.data?.message || "Unable to create your account. Please try again.";
}

// ================== SIGNUP PAGE ==================
function Signup() {
    const navigate = useNavigate();
    const { signup, loading } = useAuth();

    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const submitLock = useRef(false);

    // ================== SIGNUP SUBMISSION ==================
    async function handleSubmit(event) {
        event.preventDefault();

        if (submitLock.current || loading) {
            return;
        }

        const formData = new FormData(event.currentTarget);

        const name = String(formData.get("name") || "").trim();
        const email = String(formData.get("email") || "")
            .trim()
            .toLowerCase();
        const phone = String(formData.get("phone") || "").trim();
        const password = String(formData.get("password") || "");
        const confirmPassword = String(formData.get("confirmPassword") || "");

        // ================== FORM VALIDATION ==================
        if (name.length < 2 || name.length > 100) {
            toast.error("Name must contain between 2 and 100 characters.");
            return;
        }

        if (
            !email ||
            email.length > 254 ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        ) {
            toast.error("Enter a valid email address.");
            return;
        }

        if (!/^[6-9]\d{9}$/.test(phone)) {
            toast.error("Enter a valid 10-digit Indian mobile number.");
            return;
        }

        if (password.length < 6) {
            toast.error("Password must contain at least 6 characters.");
            return;
        }

        if (new TextEncoder().encode(password).length > 72) {
            toast.error("Password cannot exceed 72 UTF-8 bytes.");
            return;
        }

        if (password !== confirmPassword) {
            toast.error("Passwords do not match.");
            return;
        }

        // ================== CREATE ACCOUNT ==================
        submitLock.current = true;
        setIsSubmitting(true);

        try {
            const data = await signup({
                name,
                email,
                phone,
                password,
                confirmPassword,
            });

            toast.success(data.message || "Account created successfully.");

            navigate("/login", { replace: true });
        } catch (error) {
            toast.error(getSignupErrorMessage(error));
        } finally {
            submitLock.current = false;
            setIsSubmitting(false);
        }
    }

    const formDisabled = loading || isSubmitting;

    return (
        <AuthLayout
            title="Create Account"
            description="Join QueryNest AI and start exploring smarter conversations."
        >
            <form
                className="auth-form"
                onSubmit={handleSubmit}
                aria-busy={formDisabled}
                noValidate
            >
                {/* Full Name */}
                <TextField
                    id="signup-name"
                    name="name"
                    label="Full Name"
                    variant="outlined"
                    className="auth-text-field"
                    autoComplete="name"
                    disabled={formDisabled}
                    fullWidth
                    required
                    slotProps={{
                        htmlInput: {
                            minLength: 2,
                            maxLength: 100,
                        },
                    }}
                />

                {/* Email */}
                <TextField
                    id="signup-email"
                    name="email"
                    label="Email Address"
                    type="email"
                    variant="outlined"
                    className="auth-text-field"
                    autoComplete="email"
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

                {/* Phone */}
                <TextField
                    id="signup-phone"
                    name="phone"
                    label="Phone Number"
                    type="tel"
                    variant="outlined"
                    className="auth-text-field"
                    autoComplete="tel-national"
                    disabled={formDisabled}
                    fullWidth
                    required
                    slotProps={{
                        htmlInput: {
                            inputMode: "numeric",
                            maxLength: 10,
                            pattern: "[6-9][0-9]{9}",
                        },
                    }}
                />

                {/* Password */}
                <TextField
                    id="signup-password"
                    name="password"
                    label="Password"
                    type={showPassword ? "text" : "password"}
                    variant="outlined"
                    className="auth-text-field"
                    autoComplete="new-password"
                    disabled={formDisabled}
                    fullWidth
                    required
                    slotProps={{
                        htmlInput: {
                            minLength: 6,
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

                {/* Confirm Password */}
                <TextField
                    id="signup-confirm-password"
                    name="confirmPassword"
                    label="Confirm Password"
                    type={showConfirmPassword ? "text" : "password"}
                    variant="outlined"
                    className="auth-text-field"
                    autoComplete="new-password"
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
                                        aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                                        aria-pressed={showConfirmPassword}
                                        onClick={() => setShowConfirmPassword((current) => !current)}
                                        onMouseDown={(event) => event.preventDefault()}
                                        edge="end"
                                    >
                                        <i
                                            className={`fa-solid ${showConfirmPassword ? "fa-eye-slash" : "fa-eye"}`}
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
                    {loading
                        ? "Checking session..."
                        : isSubmitting
                          ? "Creating account..."
                          : "Create Account"}

                    <i
                        className="fa-solid fa-arrow-right"
                        aria-hidden="true"
                    />
                </Button>
            </form>

            {/* Account Link */}
            <div className="auth-account-row auth-account-row-center">
                <p className="auth-switch">
                    Already have an account?{" "}
                    <Link to="/login">
                        Sign In
                    </Link>
                </p>
            </div>
        </AuthLayout>
    );
}

export default Signup;
