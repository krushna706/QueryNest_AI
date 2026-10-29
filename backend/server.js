
 // ================== ENVIRONMENT CONFIGURATION ==================
require("dotenv").config();

const app = require("./app");
const connectDB = require("./config/db");

// ================== SERVER CONFIGURATION ==================
const PORT = Number(process.env.PORT);

// ================== START SERVER ==================
async function startServer() {
    try {
        if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
            throw new Error("PORT must be an integer between 1 and 65535.");
        }

        // Connect to MongoDB before starting the server.
        await connectDB();

        const server = app.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}.`);
        });

        // Handle server startup errors.
        server.on("error", (error) => {
            if (error.code === "EADDRINUSE") {
                console.error(`Port ${PORT} is already in use.`);
            } else {
                console.error("HTTP server failed to start.");
            }

            process.exit(1);
        });
    } catch (error) {
        console.error(
            "Server startup failed. Check PORT, DB_URI and MongoDB Atlas access settings."
        );

        process.exit(1);
    }
}

// ================== INITIALIZE ==================
startServer();
