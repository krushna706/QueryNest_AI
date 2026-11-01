// Format message time
export function formatMessageTime(date) {
    if (!date) return "";

    const value = new Date(date);

    if (Number.isNaN(value.getTime())) {
        return "";
    }

    return value.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
    });
}
