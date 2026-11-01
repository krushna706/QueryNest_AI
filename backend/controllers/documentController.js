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

// Document limits
const MAX_FILES = APP_USAGE_LIMITS.maxPdfPerConversation;
const MAX_PDF_PAGES = APP_USAGE_LIMITS.maxPagesPerConversation;
const MAX_DOCX_TOKENS = 20000;

// Public document response
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

// Verify conversation ownership
function getOwnedConversation(req, { allowNew = false } = {}) {
    if (!req.user?._id) {
        throw new ExpressError(401, "Please login to continue.");
    }

    if (allowNew && !req.conversation && !req.params?.conversationId) {
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

// Read existing document allowance
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

    if (existing.some((document) => document.status !== "ready")) {
        throw new ExpressError(409, "Another document upload is processing. Try again after it completes.");
    }

    let pagesUsed = 0;

    for (const document of existing) {
        if (document.fileType !== "pdf") {
            continue;
        }

        if (!Number.isSafeInteger(document.pageCount) || document.pageCount < 1) {
            throw new ExpressError(409, "Existing PDF page information is incomplete.");
        }

        pagesUsed += document.pageCount;
    }

    return {
        filesUsed: existing.length,
        pagesUsed,
    };
}

// Validate conversation limits
function checkDocumentAllowance(allowance, newFileCount, newPageCount) {
    if (allowance.filesUsed + newFileCount > MAX_FILES) {
        throw new ExpressError(409, `Only ${MAX_FILES} documents are allowed per conversation.`);
    }

    if (allowance.pagesUsed + newPageCount > MAX_PDF_PAGES) {
        throw new ExpressError(413, `PDF documents cannot exceed ${MAX_PDF_PAGES} pages combined.`);
    }
}

// Extract, chunk and embed
async function prepareDocument(file, remainingPages, signal) {
    if (!Buffer.isBuffer(file.buffer) || !["pdf", "docx"].includes(file.fileType)) {
        throw new ExpressError(400, "Invalid uploaded document.");
    }

    const extracted =
        file.fileType === "pdf"
            ? await extractPdf(file.buffer, {
                  remainingPages,
                  signal,
              })
            : await extractDocx(file.buffer, {
                  fileName: file.originalname,
                  signal,
              });

    const result = chunkDocumentText({
        fileType: file.fileType,
        pages: extracted.pages,
        paragraphs: extracted.paragraphs,
    });

    if (file.fileType === "docx" && result.extractedTokenCount > MAX_DOCX_TOKENS) {
        throw new ExpressError(413, `DOCX extracted text cannot exceed ${MAX_DOCX_TOKENS} estimated tokens.`);
    }

    if (signal.aborted) {
        throw new ExpressError(408, "Document upload cancelled.");
    }

    const chunks = await embedDocumentChunks(result.chunks, {
        title: file.originalname,
        signal,
    });

    return {
        originalName: file.originalname,
        fileType: file.fileType,
        mimeType: file.mimeType,
        sizeBytes: file.buffer.length,

        pageCount: file.fileType === "pdf" ? extracted.pageCount : null,

        extractedText: extracted.extractedText,
        extractedCharCount: result.extractedCharCount,
        extractedTokenCount: result.extractedTokenCount,

        chunkCount: chunks.length,
        chunks,
    };
}

// Upload documents
async function uploadDocuments(req, res, next) {
    const files = req.files;

    const controller = new AbortController();

    const onDisconnect = () => {
        controller.abort();
    };

    res.once("close", onDisconnect);

    try {
        const { userId, conversationId } = getOwnedConversation(req, {
            allowNew: true,
        });

        if (!Array.isArray(files) || files.length < 1 || files.length > MAX_FILES) {
            throw new ExpressError(400, "Upload 1 to 3 PDF or DOCX files.");
        }

        const initialAllowance = conversationId
            ? await readDocumentAllowance(userId, conversationId)
            : {
                  filesUsed: 0,
                  pagesUsed: 0,
              };

        checkDocumentAllowance(initialAllowance, files.length, 0);

        const prepared = [];
        let newPageCount = 0;

        for (const file of files) {
            if (controller.signal.aborted) {
                throw new ExpressError(408, "Document upload cancelled.");
            }

            const remainingPages = MAX_PDF_PAGES - initialAllowance.pagesUsed - newPageCount;

            const result = await prepareDocument(file, remainingPages, controller.signal);

            prepared.push(result);

            newPageCount += result.pageCount || 0;

            // Original file is no longer required.
            file.buffer = null;
        }

        checkDocumentAllowance(initialAllowance, prepared.length, newPageCount);

        if (controller.signal.aborted) {
            throw new ExpressError(408, "Document upload cancelled.");
        }

        const result = await mongoose.connection.transaction(async (session) => {
            let activeId = conversationId;
            let newConversation = null;

            if (activeId) {
                const updated = await Conversation.updateOne(
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
                    throw new ExpressError(404, "Conversation not found.");
                }

                // Recheck limits within the transaction.
                const allowance = await readDocumentAllowance(userId, activeId, session);

                checkDocumentAllowance(allowance, prepared.length, newPageCount);
            } else {
                const title =
                    prepared[0].originalName
                        .replace(/\.(pdf|docx)$/i, "")
                        .trim()
                        .slice(0, 120) || "New Chat";

                [newConversation] = await Conversation.create(
                    [
                        {
                            userId,
                            title,
                            status: "active",
                            lastActivityAt: new Date(),
                        },
                    ],
                    { session }
                );

                activeId = newConversation._id;
            }

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
                    extractedCharCount: item.extractedCharCount,
                    extractedTokenCount: item.extractedTokenCount,
                    chunkCount: item.chunkCount,

                    status: "ready",
                    processedAt: new Date(),
                })),
                { session }
            );

            const chunkRecords = documents.flatMap((document, index) =>
                prepared[index].chunks.map((chunk) => ({
                    userId,
                    conversationId: activeId,
                    documentId: document._id,

                    fileType: chunk.fileType,
                    chunkIndex: chunk.chunkIndex,

                    text: chunk.text,
                    tokenCount: chunk.tokenCount,

                    pageNumber: chunk.pageNumber,
                    sectionTitle: chunk.sectionTitle,
                    paragraphStart: chunk.paragraphStart,
                    paragraphEnd: chunk.paragraphEnd,

                    embeddingModel: chunk.embeddingModel,
                    embedding: chunk.embedding,
                }))
            );

            await DocumentChunk.insertMany(chunkRecords, {
                session,
                ordered: true,
            });

            return {
                conversationId: activeId,

                conversation: newConversation
                    ? {
                          _id: newConversation._id,
                          title: newConversation.title,
                          status: newConversation.status,
                          lastActivityAt: newConversation.lastActivityAt,
                          createdAt: newConversation.createdAt,
                      }
                    : null,

                documents: documents.map(toDocumentResponse),
            };
        });

        res.set("Cache-Control", "no-store");

        return res.status(201).json({
            success: true,
            message: "Document(s) processed successfully.",
            ...result,
        });
    } catch (error) {
        return next(error);
    } finally {
        res.off("close", onDisconnect);

        if (Array.isArray(files)) {
            for (const file of files) {
                file.buffer = null;
            }
        }

        req.files = [];
    }
}

// List conversation documents
async function getDocuments(req, res, next) {
    try {
        const { userId, conversationId } = getOwnedConversation(req);

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

        res.set("Cache-Control", "no-store");

        return res.status(200).json({
            success: true,
            documents: documents.map(toDocumentResponse),
        });
    } catch (error) {
        return next(error);
    }
}

// Delete document
async function deleteDocument(req, res, next) {
    try {
        const { userId, conversationId } = getOwnedConversation(req);

        const documentId = req.validated?.params?.documentId ?? req.params?.documentId;

        if (typeof documentId !== "string" || !/^[a-f\d]{24}$/i.test(documentId)) {
            throw new ExpressError(400, "Invalid document ID.");
        }

        const id = new mongoose.Types.ObjectId(documentId);

        await mongoose.connection.transaction(async (session) => {
            const updated = await Conversation.updateOne(
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
                throw new ExpressError(404, "Conversation not found.");
            }

            const document = await Document.findOne({
                _id: id,
                userId,
                conversationId,
            }).session(session);

            if (!document) {
                throw new ExpressError(404, "Document not found.");
            }

            await DocumentChunk.deleteMany(
                {
                    userId,
                    conversationId,
                    documentId: id,
                },
                { session }
            );

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

            await Document.deleteOne(
                {
                    _id: id,
                    userId,
                    conversationId,
                },
                { session }
            );
        });

        return res.status(200).json({
            success: true,
            message: "Document deleted successfully.",
        });
    } catch (error) {
        return next(error);
    }
}

// Exports
module.exports = {
    uploadDocuments,
    getDocuments,
    deleteDocument,
};
