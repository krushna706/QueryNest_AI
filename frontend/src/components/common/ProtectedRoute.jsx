import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

function AccessDenied() {
    return (
        <section className="container py-5 text-center">
            <h2>Access Denied</h2>
            <p>You do not have permission to access this page.</p>
        </section>
    );
}

// Session feedback
function SessionFeedback() {
    const { loading, authError, refreshUser } = useAuth();

    return (
        <section className="container-fluid py-5 text-center">
            {loading ? (
                <p role="status">Checking your session...</p>
            ) : (
                <>
                    <p role="alert">{authError}</p>

                    <button type="button" className="btn btn-primary" onClick={() => refreshUser()}>
                        Try Again
                    </button>
                </>
            )}
        </section>
    );
}

// Root redirect
function RootRedirect() {
    const { loading, authError } = useAuth();

    if (loading || authError) {
        return <SessionFeedback />;
    }

    return <Navigate to="/chat" replace />;
}

// Guest access
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

// Chat access
function ChatAccess() {
    const { user, loading, authError } = useAuth();

    if (loading || authError) {
        return <SessionFeedback />;
    }

    if (user && user.role !== "user") {
        return <AccessDenied />;
    }

    return <Outlet />;
}

// User access
function ProtectedRoute() {
    const { user, loading, authError } = useAuth();

    if (loading || authError) {
        return <SessionFeedback />;
    }

    if (!user) {
        return <Navigate to="/chat" replace state={{ authRequired: true }} />;
    }

    if (user.role !== "user") {
        return <AccessDenied />;
    }

    return <Outlet />;
}

export { RootRedirect, GuestAccess, ChatAccess };
export default ProtectedRoute;
