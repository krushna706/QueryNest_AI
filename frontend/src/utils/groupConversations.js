// Group conversations
function groupConversations(conversations) {
    const now = new Date();

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const groups = {
        Today: [],
        Yesterday: [],
        Older: [],
    };

    conversations.forEach((conversation) => {
        const date = new Date(conversation.lastActivityAt || conversation.updatedAt || conversation.createdAt);

        if (!Number.isNaN(date.getTime()) && date >= today) {
            groups.Today.push(conversation);
        } else if (!Number.isNaN(date.getTime()) && date >= yesterday) {
            groups.Yesterday.push(conversation);
        } else {
            groups.Older.push(conversation);
        }
    });

    return groups;
}

export default groupConversations;
