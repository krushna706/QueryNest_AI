import { DOCUMENT_LIMITS } from "../config/appConfig";
import api from "./api";

// Document limits
const MAX_FILES = DOCUMENT_LIMITS.maxFiles;
const MAX_FILE_SIZE = DOCUMENT_LIMITS.maxFileSize;

const ALLOWED_EXTENSIONS = DOCUMENT_LIMITS.extensions;

// Validate document id
function validateDocumentId(id, fieldName = "Document ID") {
    if (typeof id !== "string" || !/^[a-f0-9]{24}$/i.test(id)) {
        throw new Error(`Invalid ${fieldName}.`);
    }

    return id;
}

// Validate upload files
function validateUploadFiles(files) {
    const selectedFiles = Array.from(files || []);

    if (selectedFiles.length === 0 || selectedFiles.length > MAX_FILES) {
        throw new Error("Select 1 to 3 documents.");
    }

    for (const file of selectedFiles) {
        if (!(file instanceof File)) {
            throw new Error("Invalid document selected.");
        }

        const extension = file.name.split(".").pop().toLowerCase();

        if (!ALLOWED_EXTENSIONS.includes(extension)) {
            throw new Error("Only PDF and Word (.docx) files are allowed.");
        }

        if (file.size === 0 || file.size > MAX_FILE_SIZE) {
            throw new Error(`${file.name}: File size must be between 1 byte and 5 MB.`);
        }
    }

    return selectedFiles;
}

// Upload documents
async function uploadDocuments(files, { conversationId = null, onUploadProgress, signal } = {}) {
    const selectedFiles = validateUploadFiles(files);

    const formData = new FormData();

    selectedFiles.forEach((file) => {
        formData.append("files", file);
    });

    const endpoint = conversationId
        ? `/documents/${validateDocumentId(conversationId, "Conversation ID")}`
        : "/documents";

    const { data } = await api.post(endpoint, formData, {
        // Embedding generation can take longer
        // than normal API requests.
        timeout: 180000,

        signal,

        onUploadProgress: (event) => {
            if (typeof onUploadProgress !== "function" || !event.total) {
                return;
            }

            const percentage = Math.min(100, Math.round((event.loaded / event.total) * 100));

            onUploadProgress(percentage);
        },
    });

    return data;
}

// Get conversation documents
async function getDocuments(conversationId, { signal } = {}) {
    const id = validateDocumentId(conversationId, "Conversation ID");

    const { data } = await api.get(`/documents/${id}`, {
        signal,
    });

    return data;
}

// Delete document
async function deleteDocument(conversationId, documentId) {
    const validConversationId = validateDocumentId(conversationId, "Conversation ID");

    const validDocumentId = validateDocumentId(documentId, "Document ID");

    const { data } = await api.delete(`/documents/${validConversationId}/${validDocumentId}`);

    return data;
}

// Exports
export { uploadDocuments, getDocuments, deleteDocument };
