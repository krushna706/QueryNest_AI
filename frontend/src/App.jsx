
import { BrowserRouter, Routes, Route, Navigate, Outlet, Link, useNavigate } from "react-router-dom";
import { ToastContainer, toast } from "react-toastify";
import { useState } from "react";

import { useAuth } from "./context/AuthContext";

// Authentication
import Login from "./auth/Login";
import Signup from "./auth/Signup";
import ForgotPassword from "./auth/ForgotPassword";

// ================== SESSION FEEDBACK ==================
function SessionFeedback() {
    const { loading, authError, refreshUser } = useAuth();

    return (
        <section className="container-fluid py-5 text-center">
            {loading ? (
                <p role="status">Checking your session...</p>
            ) : (
                <>
                    <p role="alert">{authError}</p>

                    <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => refreshUser()}
                    >
                        Try Again
                    </button>
                </>
            )}
        </section>
    );
}

// ================== ROOT REDIRECT ==================
function RootRedirect() {
    const { user, loading, authError } = useAuth();

    if (loading || authError) {
        return <SessionFeedback />;
    }

    return <Navigate to={user ? "/chat" : "/login"} replace />;
}

// ================== GUEST ACCESS ==================
function GuestAccess() {
    const { user, loading, authError } = useAuth();

    if (loading || authError) {
        return <SessionFeedback />;
    }

    if (user) {
        return <Navigate to="/chat" replace />;
    }

    return <Outlet />;
}

// ================== USER ACCESS ==================
function UserAccess() {
    const { user, loading, authError } = useAuth();

    if (loading || authError) {
        return <SessionFeedback />;
    }

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    if (user.role !== "user") {
        return (
            <section className="container py-5 text-center">
                <h2>Access Denied</h2>
                <p>You do not have permission to access this page.</p>
            </section>
        );
    }

    return <Outlet />;
}

// ================== CHAT PLACEHOLDER ==================
function ChatPlaceholder() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const [loggingOut, setLoggingOut] = useState(false);

    const handleLogout = async () => {
        if (loggingOut) return;

        setLoggingOut(true);

        try {
            await logout();

            navigate("/login", { replace: true });
            toast.success("Logged out successfully.");
        } catch (error) {
            toast.error(
                error.response?.data?.message ||
                "Unable to logout. Please try again."
            );
        } finally {
            setLoggingOut(false);
        }
    };

    return (
        <main className="container py-5">
            <h2>Welcome to QueryNest AI</h2>

            <p>Welcome, {user?.name}!</p>
            <p>Your account is ready. Chat features will be available soon.</p>

            <button
                type="button"
                className="btn btn-primary"
                onClick={handleLogout}
                disabled={loggingOut}
            >
                {loggingOut ? "Logging out..." : "Logout"}
            </button>
        </main>
    );
}

// ================== NOT FOUND ==================
function NotFound() {
    return (
        <section className="container py-5 text-center">
            <h2>404 - Page Not Found</h2>
            <p>The requested page could not be found.</p>

            <Link to="/" className="btn btn-primary">
                Go Home
            </Link>
        </section>
    );
}

// ================== APPLICATION ROUTES ==================
function App() {
    return (
        <BrowserRouter>
            <ToastContainer position="top-right" autoClose={3000} />

            <Routes>
                {/* Root */}
                <Route path="/" element={<RootRedirect />} />

                {/* Authentication */}
                <Route element={<GuestAccess />}>
                    <Route path="/login" element={<Login />} />
                    <Route path="/signup" element={<Signup />} />
                    <Route path="/forgot-password" element={<ForgotPassword />} />
                </Route>

                {/* User Panel */}
                <Route element={<UserAccess />}>
                    <Route path="/chat" element={<ChatPlaceholder />} />
                </Route>

                {/* Not Found */}
                <Route path="*" element={<NotFound />} />
            </Routes>
        </BrowserRouter>
    );
}

export default App;
