
import {
    BrowserRouter,
    Routes,
    Route,
    Navigate,
    Outlet,
    Link,
} from "react-router-dom";

import { ToastContainer } from "react-toastify";

import { useAuth } from "./context/AuthContext";

// ================== AUTHENTICATION ==================
import Login from "./auth/Login";
import Signup from "./auth/Signup";
import ForgotPassword from "./auth/ForgotPassword";

// ================== LAYOUT ==================
import ChatLayout from "./layouts/ChatLayout";

// ================== USER PANEL ==================
import ChatDashboard from "./user/ChatDashboard";
import Conversation from "./user/Conversation";
import Profile from "./user/Profile";

// ================== SESSION FEEDBACK ==================
function SessionFeedback() {
    const { loading, authError, refreshUser } = useAuth();

    return (
        <section className="container-fluid py-5 text-center">
            {loading ? (
                <p role="status">
                    Checking your session...
                </p>
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

    return (
        <Navigate
            to={user ? "/chat" : "/login"}
            replace
        />
    );
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
                <p>
                    You do not have permission to access this page.
                </p>
            </section>
        );
    }

    return <Outlet />;
}

// ================== NOT FOUND ==================
function NotFound() {
    return (
        <section className="container py-5 text-center">
            <h2>404 - Page Not Found</h2>
            <p>The requested page could not be found.</p>

            <Link
                to="/"
                className="btn btn-primary"
            >
                Go Home
            </Link>
        </section>
    );
}

// ================== APPLICATION ROUTES ==================
function App() {
    return (
        <BrowserRouter>
            <ToastContainer
                position="top-right"
                autoClose={3000}
            />

            <Routes>
                {/* ================== ROOT ================== */}
                <Route
                    path="/"
                    element={<RootRedirect />}
                />

                {/* ================== AUTHENTICATION ================== */}
                <Route element={<GuestAccess />}>
                    <Route
                        path="/login"
                        element={<Login />}
                    />

                    <Route
                        path="/signup"
                        element={<Signup />}
                    />

                    <Route
                        path="/forgot-password"
                        element={<ForgotPassword />}
                    />
                </Route>

                {/* ================== USER PANEL ================== */}
                <Route element={<UserAccess />}>
                    <Route element={<ChatLayout />}>

                        {/* ================== NEW CHAT ================== */}
                        <Route
                            path="/chat"
                            element={<ChatDashboard />}
                        />

                        {/* ================== CONVERSATION ================== */}
                        <Route
                            path="/chat/:conversationId"
                            element={<Conversation />}
                        />

                        {/* ================== MY PROFILE ================== */}
                        <Route
                            path="/profile"
                            element={<Profile />}
                        />

                    </Route>
                </Route>

                {/* ================== NOT FOUND ================== */}
                <Route
                    path="*"
                    element={<NotFound />}
                />
            </Routes>
        </BrowserRouter>
    );
}

export default App;
