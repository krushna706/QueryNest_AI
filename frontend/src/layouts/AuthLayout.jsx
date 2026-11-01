import { Link } from "react-router-dom";

import "../css/auth.css";

// Introduction content
const features = [
    {
        icon: "fa-comments",
        title: "Smart Conversations",
        description: "Get answers, explanations and coding assistance.",
    },
    {
        icon: "fa-file-pdf",
        title: "Document Intelligence",
        description: "Explore PDFs and understand your documents.",
    },
    {
        icon: "fa-brain",
        title: "AI-Powered Insights",
        description: "Analyze resumes and improve your skills.",
    },
];

// Auth layout
function AuthLayout({ title, description, children, footer }) {
    return (
        <div className="auth-layout">
            <main className="auth-main">
                <div className="auth-card">
                    {/* Introduction */}
                    <aside className="auth-introduction">
                        <div className="auth-introduction-content">
                            <span className="auth-section-label">YOUR INTELLIGENT AI ASSISTANT</span>

                            <h2 className="auth-introduction-title">
                                Think Smarter.
                                <span> Explore Further.</span>
                            </h2>

                            <p className="auth-introduction-description">
                                One intelligent workspace for conversations, documents and meaningful insights.
                            </p>

                            <ul className="auth-features">
                                {features.map((feature) => (
                                    <li key={feature.title}>
                                        <span className="auth-feature-icon">
                                            <i className={`fa-solid ${feature.icon}`} aria-hidden="true" />
                                        </span>

                                        <div>
                                            <h3>{feature.title}</h3>
                                            <p>{feature.description}</p>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <p className="auth-introduction-note">Smart Conversations. Smarter Insights.</p>
                    </aside>

                    {/* Authentication form */}
                    <section className="auth-form-panel" aria-labelledby="auth-page-title">
                        <div className="auth-form-content">
                            <header className="auth-form-header">
                                <Link to="/login" className="auth-brand" aria-label="QueryNest AI">
                                    <img
                                        src="/images/QueryNest_AI_Logo.png"
                                        alt="QueryNest AI"
                                        width="270"
                                        height="90"
                                    />
                                </Link>

                                <h1 id="auth-page-title" className="auth-form-title">
                                    {title}
                                </h1>

                                {description && <p className="auth-form-description">{description}</p>}
                            </header>

                            <div className="auth-form-body">{children}</div>

                            {footer && <div className="auth-form-footer">{footer}</div>}
                        </div>
                    </section>
                </div>
            </main>
        </div>
    );
}

export default AuthLayout;
