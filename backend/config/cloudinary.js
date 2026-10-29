
const { v2: cloudinary } = require("cloudinary");

// ================== ENVIRONMENT VALIDATION ==================
const requiredVariables = ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"];

for (const variable of requiredVariables) {
    if (!process.env[variable]?.trim()) {
        throw new Error(`${variable} is missing in environment configuration.`);
    }
}

// ================== CLOUDINARY CONFIGURATION ==================
// Credentials stay on the backend and are loaded from environment variables.
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME.trim(),
    api_key: process.env.CLOUDINARY_API_KEY.trim(),
    api_secret: process.env.CLOUDINARY_API_SECRET.trim(),
    secure: true,
});

// ================== EXPORT ==================
module.exports = cloudinary;