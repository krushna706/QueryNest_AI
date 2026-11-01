const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";
const EMAIL_TIMEOUT_MS = 15000;
const OTP_VALIDITY_MINUTES = 10;

function getEmailConfig() {
    const apiKey = process.env.BREVO_API_KEY?.trim();
    const senderEmail = process.env.BREVO_SENDER_EMAIL?.trim();

    const senderName = process.env.BREVO_SENDER_NAME?.trim() || "QueryNest AI";

    if (!apiKey || !senderEmail) {
        throw new Error("Brevo email configuration is incomplete.");
    }

    return {
        apiKey,
        senderEmail,
        senderName,
    };
}

module.exports = { BREVO_API_URL, EMAIL_TIMEOUT_MS, OTP_VALIDITY_MINUTES, getEmailConfig };
