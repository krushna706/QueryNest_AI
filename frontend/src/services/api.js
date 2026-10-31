import axios from "axios";

// ================== API CONFIGURATION ==================
const baseURL = import.meta.env.VITE_API_URL?.trim();

if (!baseURL) {
    throw new Error("VITE_API_URL is missing in frontend environment configuration.");
}

// ================== SHARED AXIOS INSTANCE ==================
const api = axios.create({
    baseURL,
    withCredentials: true,
    timeout: 15000,
});

// ================== EXPORT ==================
export default api;
