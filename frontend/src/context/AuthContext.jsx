import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import api from "../services/api";

// ================== AUTH CONTEXT ==================
const AuthContext = createContext(null);

const SESSION_EVENT = "querynest-ai-session-change";

// ================== DEFAULT AVATAR ==================
const DEFAULT_AVATAR = "/images/default-avatar.svg";

// ================== SESSION NOTIFICATION ==================
function notifyOtherTabs() {
    try {
        localStorage.setItem(
            SESSION_EVENT,
            `${Date.now()}-${Math.random()}`
        );
    } catch {
        // Session checks still work without localStorage.
    }
}

// ================== USER DATA ==================
function normalizeAuthUser(user) {
    if (!user) return null;

    const uploadedAvatar =
        user.avatar?.url ||
        user.avatarUrl ||
        "";

    return {
        ...user,
        avatarUrl: uploadedAvatar || DEFAULT_AVATAR,
    };
}

// ================== AUTH PROVIDER ==================
export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [authError, setAuthError] = useState("");

    const sessionRequestId = useRef(0);
    const backgroundRequest = useRef(false);

    const clearSession = useCallback(() => {
        sessionRequestId.current += 1;

        setUser(null);
        setAuthError("");
        setLoading(false);
    }, []);

    const refreshUser = useCallback(async (options = {}) => {
        const silent = options?.silent === true;
        const requestId = ++sessionRequestId.current;

        if (!silent) {
            setLoading(true);
            setAuthError("");
        }

        try {
            const { data } = await api.get("/auth/me", {
                skipSessionHandling: true,
            });

            if (requestId !== sessionRequestId.current) return;

            setUser(normalizeAuthUser(data.user));
            setAuthError("");
        } catch (error) {
            if (requestId !== sessionRequestId.current) return;

            const status = error.response?.status;

            if (status === 401 || status === 403) {
                setUser(null);
                setAuthError("");
            } else if (!silent) {
                setUser(null);
                setAuthError(
                    "Unable to check your session. Please try again."
                );
            }
        } finally {
            if (requestId === sessionRequestId.current) {
                setLoading(false);
            }
        }
    }, []);

    useEffect(() => {
        const requestId = api.interceptors.request.use(
            (config) => {
                config.authRequestId =
                    sessionRequestId.current;

                return config;
            }
        );

        const responseId = api.interceptors.response.use(
            (response) => response,
            (error) => {
                const config = error.config;

                if (
                    config &&
                    !config.skipSessionHandling &&
                    config.authRequestId ===
                        sessionRequestId.current
                ) {
                    if (error.response?.status === 401) {
                        clearSession();
                    }

                    if (error.response?.status === 403) {
                        refreshUser({ silent: true });
                    }
                }

                return Promise.reject(error);
            }
        );

        return () => {
            api.interceptors.request.eject(requestId);
            api.interceptors.response.eject(responseId);
        };
    }, [clearSession, refreshUser]);

    useEffect(() => {
        refreshUser();

        return () => {
            sessionRequestId.current += 1;
        };
    }, [refreshUser]);

    useEffect(() => {
        async function checkSession() {
            if (
                document.visibilityState !== "visible" ||
                backgroundRequest.current
            ) {
                return;
            }

            backgroundRequest.current = true;

            try {
                await refreshUser({ silent: true });
            } finally {
                backgroundRequest.current = false;
            }
        }

        function onStorage(event) {
            if (event.key === SESSION_EVENT) {
                checkSession();
            }
        }

        window.addEventListener("focus", checkSession);
        window.addEventListener("storage", onStorage);

        document.addEventListener(
            "visibilitychange",
            checkSession
        );

        return () => {
            window.removeEventListener("focus", checkSession);
            window.removeEventListener("storage", onStorage);

            document.removeEventListener(
                "visibilitychange",
                checkSession
            );
        };
    }, [refreshUser]);

    const login = useCallback(async (credentials) => {
        const { data } = await api.post(
            "/auth/login",
            credentials,
            {
                skipSessionHandling: true,
            }
        );

        sessionRequestId.current += 1;

        setUser(normalizeAuthUser(data.user));
        setAuthError("");
        setLoading(false);

        notifyOtherTabs();

        return data;
    }, []);

    const signup = useCallback(async (details) => {
        const { data } = await api.post(
            "/auth/signup",
            details,
            {
                skipSessionHandling: true,
            }
        );

        return data;
    }, []);

    const updateUserProfile = useCallback((profile) => {
        if (!profile?._id) return;

        setUser((current) => {
            if (
                !current ||
                String(current._id) !== String(profile._id)
            ) {
                return current;
            }

            const fields = ["name", "avatar"];

            const changes = Object.fromEntries(
                fields
                    .filter(
                        (key) => profile[key] !== undefined
                    )
                    .map(
                        (key) => [key, profile[key]]
                    )
            );

            return normalizeAuthUser({
                ...current,
                ...changes,
                avatarUrl: undefined,
            });
        });

        notifyOtherTabs();
    }, []);

    const logout = useCallback(async () => {
        try {
            await api.post(
                "/auth/logout",
                null,
                {
                    skipSessionHandling: true,
                }
            );
        } catch (error) {
            if (
                error.response?.status !== 401 &&
                error.response?.status !== 403
            ) {
                throw error;
            }
        }

        clearSession();
        notifyOtherTabs();
    }, [clearSession]);

    return (
        <AuthContext.Provider
            value={{
                user,
                loading,
                authError,
                isAuthenticated: Boolean(user),
                login,
                signup,
                logout,
                refreshUser,
                updateUserProfile,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

// ================== AUTH HOOK ==================
export function useAuth() {
    const context = useContext(AuthContext);

    if (!context) {
        throw new Error(
            "useAuth must be used inside AuthProvider."
        );
    }

    return context;
}
