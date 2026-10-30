
// ================== TASK TYPES ==================
const TASK_TYPES = Object.freeze({
    GENERAL_CHAT: "general_chat",
    CODING: "coding",
    DOCUMENT_QA: "document_qa",
    SUMMARY: "summary",
    COMPARISON: "comparison",
    RESUME_ANALYSIS: "resume_analysis",
    DOCUMENT_IMPROVEMENT: "document_improvement",
});

// ================== DOCUMENT TASKS ==================
const DOCUMENT_TASKS = new Set([
    TASK_TYPES.DOCUMENT_QA,
    TASK_TYPES.SUMMARY,
    TASK_TYPES.COMPARISON,
    TASK_TYPES.RESUME_ANALYSIS,
    TASK_TYPES.DOCUMENT_IMPROVEMENT,
]);

// ================== TASK PATTERNS ==================
const TASK_PATTERNS = {
    resume: /\b(?:review|analy[sz]e|evaluate|improve|optimi[sz]e|tailor|match|compare|check|rewrite)\b.{0,90}\b(?:resume|cv)\b|\b(?:resume|cv)\b.{0,90}\b(?:review|analysis|feedback|improvement|job description|jd|ats|match)\b/i,

    comparison: /\b(?:compare|comparison|differences?|versus|vs\.?|match(?:ing)?|align)\b/i,

    summary: /\b(?:summari[sz]e|summary|brief overview|key points|main takeaways|highlights)\b/i,

    improvement: /\b(?:proofread|correct grammar|grammar check|fix grammar|improve wording|improve writing|rewrite|edit (?:this|my|the) (?:document|file|text))\b/i,

    coding: /\b(?:code|coding|debug|bug|programming|syntax error|stack trace|javascript|typescript|react|next\.?js|node\.?js|express\.?js|python|java|css|html|sql|api|function)\b/i,

    document: /\b(?:my|this|the|these|those|attached|uploaded|selected|provided|both|two)\s+(?:[\w-]+\s+){0,2}(?:pdfs?|docx|documents?|files?|attachments?|resumes?|cvs?|word documents?)\b|\b(?:page|chapter|section)\s+\d+\b/i,

    followUp: /^(?:and|also|what about|how about|explain (?:that|this|more)|tell me more|elaborate|continue|what does (?:that|it) mean)\b/i,
};

// ================== IDENTIFY TASK ==================
function identifyTask({
    message,
    hasDocuments = false,
    hasSourceText = false,
    previousTask = null,
} = {}) {
    // ================== VALIDATE INPUT ==================
    if (typeof message !== "string" || !message.trim()) {
        throw new Error("User message is required.");
    }

    if (
        typeof hasDocuments !== "boolean" ||
        typeof hasSourceText !== "boolean"
    ) {
        throw new Error("Invalid document context.");
    }

    const content = message.trim();
    const text = content.replace(/\s+/g, " ");

    const documentReferenced =
        TASK_PATTERNS.document.test(text);

    const sourceAvailable =
        hasDocuments || hasSourceText;

    let task = TASK_TYPES.GENERAL_CHAT;

    // ================== CONTEXT FOLLOW-UP ==================
    if (
        DOCUMENT_TASKS.has(previousTask) &&
        TASK_PATTERNS.followUp.test(text)
    ) {
        task = previousTask;
    }

    // ================== RESUME ANALYSIS ==================
    else if (TASK_PATTERNS.resume.test(text)) {
        task = TASK_TYPES.RESUME_ANALYSIS;
    }

    // ================== DOCUMENT COMPARISON ==================
    else if (
        TASK_PATTERNS.comparison.test(text) &&
        documentReferenced
    ) {
        task = TASK_TYPES.COMPARISON;
    }

    // ================== SUMMARY ==================
    else if (TASK_PATTERNS.summary.test(text)) {
        task = TASK_TYPES.SUMMARY;
    }

    // ================== DOCUMENT IMPROVEMENT ==================
    else if (
        TASK_PATTERNS.improvement.test(text) &&
        (documentReferenced || hasDocuments)
    ) {
        task = TASK_TYPES.DOCUMENT_IMPROVEMENT;
    }

    // ================== CODING ==================
    else if (
        TASK_PATTERNS.coding.test(text) ||
        /```[\s\S]*?```/.test(content)
    ) {
        task = TASK_TYPES.CODING;
    }

    // ================== DOCUMENT QUESTIONS ==================
    else if (documentReferenced) {
        task = TASK_TYPES.DOCUMENT_QA;
    }

    // ================== DOCUMENT REQUIREMENT ==================
    const requiresDocumentContext =
        task === TASK_TYPES.DOCUMENT_QA ||
        task === TASK_TYPES.RESUME_ANALYSIS ||
        task === TASK_TYPES.DOCUMENT_IMPROVEMENT ||
        (
            [TASK_TYPES.SUMMARY, TASK_TYPES.COMPARISON]
                .includes(task) &&
            (
                documentReferenced ||
                TASK_PATTERNS.followUp.test(text)
            )
        );

    const needsClarification =
        requiresDocumentContext && !sourceAvailable;

    // ================== RESULT ==================
    return {
        task,
        requiresDocumentContext,
        needsClarification,
        clarification: needsClarification
            ? "Please attach a PDF or Word document, or provide the relevant text."
            : null,
    };
}

// ================== EXPORT ==================
module.exports = {
    TASK_TYPES,
    identifyTask,
};
