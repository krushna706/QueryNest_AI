
import usePageSEO from "../../hooks/usePageSEO";
import { seoPages } from "../../config/seoConfig";

import { Link } from "react-router-dom";

function NotFound() {
    usePageSEO(seoPages.notFound);
    
    return (
        <main className="not-found-page">
            <section className="not-found-card" aria-labelledby="not-found-title">
                <img src="/images/QueryNest_AI_Logo.png" alt="QueryNest AI" />
                <span className="not-found-code">404</span>
                <h1 id="not-found-title">Page not found</h1>
                <p>This page may have moved, or the link may be incorrect.</p>
                <Link to="/chat" className="not-found-link">
                    Back to chat <span aria-hidden="true">→</span>
                </Link>
            </section>
        </main>
    );
}

export default NotFound;
