import axios from "axios";

// Api configuration
const baseURL = import.meta.env.VITE_API_URL?.trim();

if (!baseURL) {
    throw new Error("VITE_API_URL is missing in frontend environment configuration.");
}

// Shared axios instance
const api = axios.create({
    baseURL,
    withCredentials: true,
    timeout: 15000,
});

// Export
export default api;
