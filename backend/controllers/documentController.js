
const mongoose = require("mongoose");

const Conversation = require("../models/Conversation");
const Document = require("../models/Document");
const DocumentChunk = require("../models/DocumentChunk");
const Message = require("../models/Message");
const ExpressError = require("../utils/ExpressError");

const { APP_USAGE_LIMITS } = require("../config/usageLimits");

const { extractPdf } = require("../services/documents/pdfExtractor");
const { extractDocx } = require("../services/documents/docxExtractor");
const { chunkDocumentText } = require("../services/documents/chunkService");
const { embedDocumentChunks } = require("../services/retrieval/embeddingService");

// ================== DOCUMENT LIMITS ==================
const MAX_FILES = APP_USAGE_LIMITS.maxPdfPerConversation;
const MAX_PDF_PAGES = APP_USAGE_LIMITS.maxPagesPerConversation;
const MAX_DOCX_TOKENS = 20000;

// ================== PUBLIC DOCUMENT RESPONSE ==================
function toDocumentResponse(document) {
    return {
        _id: document._id,
        conversationId: document.conversationId,
        originalName: document.originalName,
        fileType: document.fileType,
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
        status: document.status,
        pageCount: document.pageCount,
        extractedCharCount: document.extractedCharCount,
        extractedTokenCount: document.extractedTokenCount,
        chunkCount: document.chunkCount,
        errorCode: document.errorCode,
        processedAt: document.processedAt,
        createdAt: document.createdAt,
    };
}

// ================== VERIFY CONVERSATION OWNERSHIP ==================
function getOwnedConversation(req, { allowNew = false } = {}) {
    if (!req.user?._id) {
        throw new ExpressError(401, "Please login to continue.");
    }

    if (
        allowNew &&
        !req.conversation &&
        !req.params?.conversationId
    ) {
        return {
            userId: req.user._id,
            conversationId: null,
        };
    }

    if (
        !req.conversation?._id ||
        String(req.conversation.userId) !== String(req.user._id) ||
        req.conversation.status !== "active"
    ) {
        throw new ExpressError(404, "Conversation not found.");
    }

    return {
        userId: req.user._id,
        conversationId: req.conversation._id,
    };
}

// ================== READ EXISTING DOCUMENT ALLOWANCE ==================
async function readDocumentAllowance(userId, conversationId, session) {
    const query = Document.find({
        userId,
        conversationId,
        status: {
            $in: ["uploaded", "processing", "ready"],
        },
    }).select("fileType status pageCount");

    if (session) {
        query.session(session);
    }

    const existing = await query.lean();

    // ================== CHECK PENDING UPLOADS ==================
    if (
        existing.some(
            (document) => document.status !== "ready"
        )
    ) {
        throw new ExpressError(
            409,
            "Another document upload is processing. Try again after it completes."
        );
    }

    // ================== COUNT PDF PAGES ==================
    let pagesUsed = 0;

    for (const document of existing) {
        if (document.fileType !== "pdf") {
            continue;
        }

        if (
            !Number.isSafeInteger(document.pageCount) ||
            document.pageCount < 1
        ) {
            throw new ExpressError(
                409,
                "Existing PDF page information is incomplete."
            );
        }

        pagesUsed += document.pageCount;
    }

    return {
        filesUsed: existing.length,
        pagesUsed,
    };
}

// ================== VALIDATE CONVERSATION LIMITS ==================
function checkDocumentAllowance(
    allowance,
    newFileCount,
    newPageCount
) {
    if (
        allowance.filesUsed + newFileCount >
        MAX_FILES
    ) {
        throw new ExpressError(
            409,
            `Only ${MAX_FILES} documents are allowed per conversation.`
        );
    }

    if (
        allowance.pagesUsed + newPageCount >
        MAX_PDF_PAGES
    ) {
        throw new ExpressError(
            413,
            `PDF documents cannot exceed ${MAX_PDF_PAGES} pages combined.`
        );
    }
}

// ================== EXTRACT, CHUNK AND EMBED ==================
async function prepareDocument(file, remainingPages, signal) {
    // ================== VALIDATE FILE ==================
    if (
        !Buffer.isBuffer(file.buffer) ||
        !["pdf", "docx"].includes(file.fileType)
    ) {
        throw new ExpressError(
            400,
            "Invalid uploaded document."
        );
    }

    // ================== EXTRACT DOCUMENT ==================
    const extracted = file.fileType === "pdf"
        ? await extractPdf(file.buffer, {
            remainingPages,
            signal,
        })
        : await extractDocx(file.buffer, {
            fileName: file.originalname,
            signal,
        });

    // ================== GENERATE TEXT CHUNKS ==================
    const result = chunkDocumentText({
        fileType: file.fileType,
        pages: extracted.pages,
        paragraphs: extracted.paragraphs,
    });

    // ================== DOCX TOKEN LIMIT ==================
    if (
        file.fileType === "docx" &&
        result.extractedTokenCount > MAX_DOCX_TOKENS
    ) {
        throw new ExpressError(
            413,
            `DOCX extracted text cannot exceed ${MAX_DOCX_TOKENS} estimated tokens.`
        );
    }

    if (signal.aborted) {
        throw new ExpressError(
            408,
            "Document upload cancelled."
        );
    }

    // ================== GENERATE EMBEDDINGS ==================
    const chunks = await embedDocumentChunks(
        result.chunks,
        {
            title: file.originalname,
            signal,
        }
    );

    // ================== PREPARED DOCUMENT ==================
    return {
        originalName: file.originalname,
        fileType: file.fileType,
        mimeType: file.mimeType,
        sizeBytes: file.buffer.length,

        pageCount: file.fileType === "pdf"
            ? extracted.pageCount
            : null,

        extractedText: extracted.extractedText,
        extractedCharCount:
            result.extractedCharCount,
        extractedTokenCount:
            result.extractedTokenCount,

        chunkCount: chunks.length,
        chunks,
    };
}

// ================== UPLOAD DOCUMENTS ==================
async function uploadDocuments(req, res, next) {
    const files = req.files;

    const controller = new AbortController();

    const onDisconnect = () => {
        controller.abort();
    };

    res.once("close", onDisconnect);

    try {
        // ================== VERIFY USER ==================
        const {
            userId,
            conversationId,
        } = getOwnedConversation(req, {
            allowNew: true,
        });

        // ================== VALIDATE FILE COUNT ==================
        if (
            !Array.isArray(files) ||
            files.length < 1 ||
            files.length > MAX_FILES
        ) {
            throw new ExpressError(
                400,
                "Upload 1 to 3 PDF or DOCX files."
            );
        }

        // ================== CHECK EXISTING ALLOWANCE ==================
        const initialAllowance = conversationId
            ? await readDocumentAllowance(
                userId,
                conversationId
            )
            : {
                filesUsed: 0,
                pagesUsed: 0,
            };

        checkDocumentAllowance(
            initialAllowance,
            files.length,
            0
        );

        // ================== PROCESS DOCUMENTS ==================
        const prepared = [];
        let newPageCount = 0;

        for (const file of files) {
            if (controller.signal.aborted) {
                throw new ExpressError(
                    408,
                    "Document upload cancelled."
                );
            }

            const remainingPages =
                MAX_PDF_PAGES -
                initialAllowance.pagesUsed -
                newPageCount;

            const result = await prepareDocument(
                file,
                remainingPages,
                controller.signal
            );

            prepared.push(result);

            newPageCount += result.pageCount || 0;

            // Original file is no longer required.
            file.buffer = null;
        }

        checkDocumentAllowance(
            initialAllowance,
            prepared.length,
            newPageCount
        );

        if (controller.signal.aborted) {
            throw new ExpressError(
                408,
                "Document upload cancelled."
            );
        }

        // ================== ATOMIC DATABASE TRANSACTION ==================
        const result = await mongoose.connection.transaction(
            async (session) => {
                let activeId = conversationId;
                let newConversation = null;

                // ================== EXISTING CONVERSATION ==================
                if (activeId) {
                    const updated =
                        await Conversation.updateOne(
                            {
                                _id: activeId,
                                userId,
                                status: "active",
                            },
                            {
                                $currentDate: {
                                    lastActivityAt: true,
                                },
                            },
                            { session }
                        );

                    if (updated.matchedCount !== 1) {
                        throw new ExpressError(
                            404,
                            "Conversation not found."
                        );
                    }

                    // Recheck limits within the transaction.
                    const allowance =
                        await readDocumentAllowance(
                            userId,
                            activeId,
                            session
                        );

                    checkDocumentAllowance(
                        allowance,
                        prepared.length,
                        newPageCount
                    );

                // ================== NEW CONVERSATION ==================
                } else {
                    const title = prepared[0].originalName
                        .replace(/\.(pdf|docx)$/i, "")
                        .trim()
                        .slice(0, 120) || "New Chat";

                    [newConversation] =
                        await Conversation.create(
                            [{
                                userId,
                                title,
                                status: "active",
                                lastActivityAt: new Date(),
                            }],
                            { session }
                        );

                    activeId = newConversation._id;
                }

                // ================== SAVE DOCUMENT METADATA ==================
                const documents = await Document.create(
                    prepared.map((item) => ({
                        userId,
                        conversationId: activeId,

                        originalName: item.originalName,
                        fileType: item.fileType,
                        mimeType: item.mimeType,
                        sizeBytes: item.sizeBytes,

                        pageCount: item.pageCount,
                        extractedText: item.extractedText,
                        extractedCharCount:
                            item.extractedCharCount,
                        extractedTokenCount:
                            item.extractedTokenCount,
                        chunkCount: item.chunkCount,

                        status: "ready",
                        processedAt: new Date(),
                    })),
                    { session }
                );

                // ================== PREPARE VECTOR RECORDS ==================
                const chunkRecords = documents.flatMap(
                    (document, index) =>
                        prepared[index].chunks.map(
                            (chunk) => ({
                                userId,
                                conversationId: activeId,
                                documentId: document._id,

                                fileType: chunk.fileType,
                                chunkIndex: chunk.chunkIndex,

                                text: chunk.text,
                                tokenCount: chunk.tokenCount,

                                pageNumber: chunk.pageNumber,
                                sectionTitle: chunk.sectionTitle,
                                paragraphStart:
                                    chunk.paragraphStart,
                                paragraphEnd:
                                    chunk.paragraphEnd,

                                embeddingModel:
                                    chunk.embeddingModel,
                                embedding: chunk.embedding,
                            })
                        )
                );

                // ================== SAVE VECTOR CHUNKS ==================
                await DocumentChunk.insertMany(
                    chunkRecords,
                    {
                        session,
                        ordered: true,
                    }
                );

                // ================== TRANSACTION RESULT ==================
                return {
                    conversationId: activeId,

                    conversation: newConversation
                        ? {
                            _id: newConversation._id,
                            title: newConversation.title,
                            status: newConversation.status,
                            lastActivityAt:
                                newConversation.lastActivityAt,
                            createdAt:
                                newConversation.createdAt,
                        }
                        : null,

                    documents: documents.map(
                        toDocumentResponse
                    ),
                };
            }
        );

        // ================== SUCCESS RESPONSE ==================
        res.set("Cache-Control", "no-store");

        return res.status(201).json({
            success: true,
            message: "Document(s) processed successfully.",
            ...result,
        });

    } catch (error) {
        return next(error);

    } finally {
        // ================== REMOVE EVENT LISTENER ==================
        res.off("close", onDisconnect);

        // ================== RELEASE ORIGINAL BUFFERS ==================
        if (Array.isArray(files)) {
            for (const file of files) {
                file.buffer = null;
            }
        }

        req.files = [];
    }
}

// ================== LIST CONVERSATION DOCUMENTS ==================
async function getDocuments(req, res, next) {
    try {
        const {
            userId,
            conversationId,
        } = getOwnedConversation(req);

        // ================== FETCH OWNED DOCUMENTS ==================
        const documents = await Document.find({
            userId,
            conversationId,
            status: {
                $ne: "deleting",
            },
        })
            .sort({
                createdAt: 1,
                _id: 1,
            })
            .select("-extractedText")
            .lean();

        // ================== RESPONSE ==================
        res.set("Cache-Control", "no-store");

        return res.status(200).json({
            success: true,
            documents: documents.map(
                toDocumentResponse
            ),
        });

    } catch (error) {
        return next(error);
    }
}

// ================== DELETE DOCUMENT ==================
async function deleteDocument(req, res, next) {
    try {
        const {
            userId,
            conversationId,
        } = getOwnedConversation(req);

        const documentId =
            req.validated?.params?.documentId ??
            req.params?.documentId;

        // ================== VALIDATE DOCUMENT ID ==================
        if (
            typeof documentId !== "string" ||
            !/^[a-f\d]{24}$/i.test(documentId)
        ) {
            throw new ExpressError(
                400,
                "Invalid document ID."
            );
        }

        const id = new mongoose.Types.ObjectId(
            documentId
        );

        // ================== ATOMIC DELETE ==================
        await mongoose.connection.transaction(
            async (session) => {
                // ================== LOCK CONVERSATION ==================
                const updated =
                    await Conversation.updateOne(
                        {
                            _id: conversationId,
                            userId,
                            status: "active",
                        },
                        {
                            $currentDate: {
                                lastActivityAt: true,
                            },
                        },
                        { session }
                    );

                if (updated.matchedCount !== 1) {
                    throw new ExpressError(
                        404,
                        "Conversation not found."
                    );
                }

                // ================== VERIFY DOCUMENT OWNERSHIP ==================
                const document = await Document.findOne({
                    _id: id,
                    userId,
                    conversationId,
                }).session(session);

                if (!document) {
                    throw new ExpressError(
                        404,
                        "Document not found."
                    );
                }

                // ================== DELETE EMBEDDINGS ==================
                await DocumentChunk.deleteMany(
                    {
                        userId,
                        conversationId,
                        documentId: id,
                    },
                    { session }
                );

                // ================== REMOVE MESSAGE REFERENCES ==================
                await Message.updateMany(
                    {
                        userId,
                        conversationId,
                    },
                    {
                        $pull: {
                            attachmentIds: id,
                            sources: {
                                documentId: id,
                            },
                        },
                    },
                    { session }
                );

                // ================== DELETE DOCUMENT ==================
                await Document.deleteOne(
                    {
                        _id: id,
                        userId,
                        conversationId,
                    },
                    { session }
                );
            }
        );

        // ================== SUCCESS RESPONSE ==================
        return res.status(200).json({
            success: true,
            message: "Document deleted successfully.",
        });

    } catch (error) {
        return next(error);
    }
}

// ================== EXPORTS ==================
module.exports = {
    uploadDocuments,
    getDocuments,
    deleteDocument,
};
