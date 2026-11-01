const mongoose = require("mongoose");

// Database connection
// Connect MongoDB before the server starts accepting requests.
async function connectDB() {
    const dbURI = process.env.DB_URI;

    // Stop startup when database configuration is missing.
    if (!dbURI || !dbURI.trim()) {
        throw new Error("DB_URI is missing in environment configuration.");
    }

    // Reject the connection attempt if MongoDB is unavailable.
    // server.js will handle startup errors.
    await mongoose.connect(dbURI, {
        serverSelectionTimeoutMS: 10000,
    });

    console.log("MongoDB connected successfully.");
}

// Export
module.exports = connectDB;
