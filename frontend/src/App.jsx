import { BrowserRouter, Routes, Route } from "react-router-dom";

import { ToastContainer } from "react-toastify";

import ProtectedRoute, { RootRedirect, GuestAccess, ChatAccess } from "./components/common/ProtectedRoute";
import NotFound from "./components/common/NotFound";

// Authentication
import Login from "./auth/Login";
import Signup from "./auth/Signup";
import ForgotPassword from "./auth/ForgotPassword";

// Layout
import ChatLayout from "./layouts/ChatLayout";

// User panel
import ChatDashboard from "./user/ChatDashboard";
import Conversation from "./user/Conversation";
import Profile from "./user/Profile";

// Application routes
function App() {
    return (
        <BrowserRouter>
            <ToastContainer position="top-right" autoClose={3000} />

            <Routes>
                <Route path="/" element={<RootRedirect />} />
                <Route element={<GuestAccess />}>
                    <Route path="/login" element={<Login />} />

                    <Route path="/signup" element={<Signup />} />

                    <Route path="/forgot-password" element={<ForgotPassword />} />
                </Route>
                <Route element={<ChatAccess />}>
                    <Route element={<ChatLayout />}>
                        <Route path="/chat" element={<ChatDashboard />} />
                        <Route element={<ProtectedRoute />}>
                            {/* Conversation */}
                            <Route path="/chat/:conversationId" element={<Conversation />} />

                            {/* My Profile */}
                            <Route path="/profile" element={<Profile />} />
                        </Route>
                    </Route>
                </Route>
                <Route path="*" element={<NotFound />} />
            </Routes>
        </BrowserRouter>
    );
}

export default App;
