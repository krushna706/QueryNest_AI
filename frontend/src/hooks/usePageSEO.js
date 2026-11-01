import { useEffect } from "react";
import { siteName } from "../config/seoConfig";

// Update existing meta tags
function setMeta(name, content) {
    let meta = document.head.querySelector(`meta[name="${name}"]`);

    if (!content) {
        meta?.remove();
        return;
    }

    if (!meta) {
        meta = document.createElement("meta");
        meta.name = name;
        document.head.appendChild(meta);
    }

    meta.content = content;
}

// Page metadata
export default function usePageSEO({
    title,
    description,
    keywords = "",
    noIndex = false,
}) {
    useEffect(() => {
        if (title) {
            document.title = `${title} | ${siteName}`;
        }

        setMeta("description", description);
        setMeta("keywords", keywords);
        setMeta("robots", noIndex ? "noindex,nofollow" : "index,follow");
    }, [title, description, keywords, noIndex]);
}