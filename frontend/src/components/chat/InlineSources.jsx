import { Fragment } from "react";

// ================== SOURCE LABEL ==================
function getSourceLabel(source) {
    if (
        typeof source.label === "string" &&
        source.label.trim()
    ) {
        return source.label.trim();
    }

    const filename =
        typeof source.filename === "string" &&
        source.filename.trim()
            ? source.filename.trim()
            : "Document";

    if (
        source.fileType === "pdf" &&
        Number.isInteger(source.pageNumber) &&
        source.pageNumber > 0
    ) {
        return `${filename} — Page ${source.pageNumber}`;
    }

    if (source.fileType === "docx") {
        const section =
            typeof source.sectionTitle === "string"
                ? source.sectionTitle.trim()
                : "";

        const start = source.paragraphStart;
        const end = source.paragraphEnd;

        const paragraphs =
            Number.isInteger(start) && start > 0
                ? Number.isInteger(end) && end > start
                    ? `Paragraphs ${start}–${end}`
                    : `Paragraph ${start}`
                : "";

        const reference = [
            section,
            paragraphs,
        ].filter(Boolean).join(" · ");

        return reference
            ? `${filename} — ${reference}`
            : filename;
    }

    return filename;
}

// ================== SOURCE REFERENCE ID ==================
function getCitationId(source, index) {
    const value = String(
        source.citationId || ""
    ).trim();

    return /^S\d{1,4}$/i.test(value)
        ? value.toUpperCase()
        : `S${index + 1}`;
}

// ================== SOURCE EXCERPT ==================
function getSourceExcerpt(source) {
    if (typeof source.text !== "string") {
        return "";
    }

    return source.text.trim();
}

// ================== INLINE SOURCES ==================
function InlineSources({ sources = [] }) {
    const validSources = Array.isArray(sources)
        ? sources.filter(
            (source) =>
                source &&
                typeof source === "object" &&
                !Array.isArray(source)
        )
        : [];

    if (!validSources.length) {
        return null;
    }

    return (
        <section className="inline-sources mt-3" aria-label="AI response document sources">
            <div className="d-flex align-items-center gap-2 mb-2">
                <i className="fa-regular fa-file-lines text-secondary" aria-hidden="true" />

                <span className="fw-semibold small">
                    Sources
                </span>

                <span className="text-secondary small">
                    ({validSources.length})
                </span>
            </div>
            <div className="d-flex flex-wrap gap-2">
                {validSources.map((source, index) => {
                    const citationId = getCitationId(
                        source,
                        index
                    );

                    const label = getSourceLabel(source);

                    const excerpt = getSourceExcerpt(source);

                    const isPDF =
                        source.fileType === "pdf";

                    const iconClass = isPDF
                        ? "fa-regular fa-file-pdf"
                        : source.fileType === "docx"
                            ? "fa-regular fa-file-word"
                            : "fa-regular fa-file-lines";

                    const sourceKey = [
                        source.chunkId ||
                            source.documentId ||
                            "source",
                        citationId,
                        index,
                    ].join("-");

                    return (
                        <Fragment key={sourceKey}>
                            <details
                                className="inline-source-item border rounded-3 qn-source-item"
                            >
                                <summary
                                    className="d-flex align-items-center gap-2 px-3 py-2 qn-source-summary"
                                    
                                    title={label}
                                >
                                    <i className={`${iconClass} qn-source-icon`} aria-hidden="true"  />

                                    <strong className="small qn-source-index" >
                                        [{citationId}]
                                    </strong>

                                    <span className="small qn-source-label" >
                                        {label}
                                    </span>

                                    <i className="fa-solid fa-chevron-down text-secondary ms-auto qn-source-expand-icon" aria-hidden="true"  />
                                </summary>
                                <div className="border-top px-3 py-3">
                                    <div className="d-flex align-items-center gap-2 mb-2">
                                        <i className="fa-solid fa-quote-left text-secondary" aria-hidden="true" />

                                        <span className="fw-semibold small">
                                            Extracted Source Text
                                        </span>
                                    </div>

                                    {excerpt ? (
                                        <p className="small mb-0 qn-source-excerpt" >
                                            {excerpt}
                                        </p>
                                    ) : (
                                        <p className="text-secondary small mb-0">
                                            Source text is not available.
                                        </p>
                                    )}
                                    <div className="border-top mt-3 pt-2">
                                        <span className="text-secondary small">
                                            <i className="fa-solid fa-link me-2" aria-hidden="true" />

                                            {label}
                                        </span>
                                    </div>
                                </div>
                            </details>
                        </Fragment>
                    );
                })}
            </div>
        </section>
    );
}

export default InlineSources;
