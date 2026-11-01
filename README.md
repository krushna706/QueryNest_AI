# QueryNest AI

**Smart Conversations. Smarter Insights.**

QueryNest AI is a full-stack MERN application for AI conversations and document assistance. It supports general questions, coding help, PDF and Word document analysis, resume reviews, and writing assistance.

Built as a learning and portfolio project with authenticated chat access, document retrieval, and dual-provider AI routing.

## Features

### AI Conversations
- Stream AI responses in real time.
- Ask general questions and get coding or writing assistance.
- Regenerate responses and view response history.
- Read formatted Markdown and syntax-highlighted code.
- Access saved conversations from the sidebar.

### Document Assistance
- Upload PDF and Word (.docx) documents.
- Generate summaries and ask document-related questions.
- Review resumes and improve written content.
- Retrieve relevant document sections for follow-up questions.
- Enforce upload size and extracted-content limits.

### Authentication
- Register with a unique email address and phone number.
- Sign in using email or phone and password.
- Reset passwords through email OTP verification.
- Maintain authenticated sessions using HttpOnly cookies.
- Revoke sessions on logout and password reset.

### Profile
- Update your name and profile picture.
- View registered email and phone number.
- View AI usage and application limits.
- Clear all chat history with confirmation.

### Interface
- Guest access to the chat dashboard.
- Sign-in required for conversations, document uploads, and profile access.
- Responsive sidebar and mobile navigation.
- Auto-expanding message composer.
- Page-specific browser titles and metadata.
- Conversation titles displayed in the browser tab.

## Technology Stack

| Layer | Technologies |
| --- | --- |
| Frontend | React, Vite, React Router |
| UI | Material UI, Bootstrap, custom CSS, Font Awesome |
| API Client | Axios |
| Response Rendering | React Markdown, Remark GFM, React Syntax Highlighter |
| Backend | Node.js, Express |
| Database | MongoDB, Mongoose |
| AI Providers | Groq, Google Gemini |
| Authentication | JSON Web Tokens, HttpOnly cookies, bcrypt |
| Validation | Joi |
| Document Processing | PDF Parse, Mammoth |
| Image Storage | Cloudinary |
| Email Delivery | Brevo |

## AI and Document Workflow

1. The user submits a message or uploads a document.
2. The backend validates the request, ownership, and applicable limits.
3. Uploaded documents are processed into text chunks and embeddings.
4. Relevant document content is retrieved when needed.
5. The AI service selects a provider based on the configured routing rules and availability.
6. The response streams to the interface and is stored with the conversation.

Provider availability and account quotas apply. Routing does not provide unlimited AI usage.

## Project Structure

| Location | Purpose |
| --- | --- |
| `backend/config/` | Database, email, Cloudinary, AI configuration, and limits |
| `backend/controllers/` | Request handling |
| `backend/middleware/` | Authentication, ownership, validation, uploads, and rate limits |
| `backend/models/` | Database schemas |
| `backend/routes/` | API endpoints |
| `backend/services/` | AI routing, document processing, retrieval, and email delivery |
| `frontend/src/auth/` | Login, signup, and password recovery |
| `frontend/src/components/chat/` | Sidebar, composer, and message components |
| `frontend/src/components/common/` | Route protection and shared components |
| `frontend/src/config/` | Application limits and page metadata |
| `frontend/src/context/` | Authentication state |
| `frontend/src/hooks/` | Reusable React hooks |
| `frontend/src/layouts/` | Chat workspace layout |
| `frontend/src/services/` | API communication and streaming |
| `frontend/src/user/` | Dashboard, conversation, and profile pages |
| `frontend/src/utils/` | Shared utility functions |
| `frontend/public/images/` | Logo, favicon, and image assets |

## Local Setup

### Prerequisites

- Node.js 24 and npm.
- MongoDB with transaction support, such as MongoDB Atlas or a local replica set.
- A configured Atlas vector-search index for document retrieval.
- Groq and Gemini API credentials.
- Brevo credentials and a verified sender.
- Cloudinary credentials.
- Nodemon available for the backend development script.

### 1. Configure Environment Variables

Create `backend/.env` with the following configuration:

| Variable | Purpose |
| --- | --- |
| `PORT` | Backend port, such as `8080` |
| `DB_URI` | MongoDB connection string |
| `JWT_SECRET` | Strong random secret of at least 32 bytes |
| `CLIENT_ORIGIN` | Frontend origin, such as `http://localhost:5173` |
| `GROQ_API_KEY` | Groq API key |
| `GEMINI_API_KEY` | Gemini API key |
| `BREVO_API_KEY` | Brevo API key |
| `BREVO_SENDER_EMAIL` | Verified sender email |
| `BREVO_SENDER_NAME` | Email sender display name |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret |
| `NODE_ENV` | `development` for local development |
| `TRUST_PROXY_HOPS` | `0` locally; configure for the actual deployment proxy |
| `SERVE_FRONTEND` | `false` when running Vite separately |

Create `frontend/.env`:

```env
VITE_API_URL=http://localhost:8080/api
```

Use the same hostname consistently for the frontend and backend. Keep API keys and other secrets in the backend environment only.

### 2. Install Dependencies

Backend:

```bash
cd backend
npm ci
```

Frontend, from a separate terminal at the project root:

```bash
cd frontend
npm ci
```

`npm ci` installs the dependency versions recorded in each lockfile. Use `npm install` when intentionally adding or updating dependencies.

If nodemon is not already installed:

```bash
npm install -g nodemon
```

### 3. Start Development Servers

Backend:

```bash
cd backend
npm run dev
```

Frontend:

```bash
cd frontend
npm run dev
```

Open the local URL shown by Vite in the terminal.

## Available Scripts

| Folder | Command | Purpose |
| --- | --- | --- |
| `backend` | `npm run dev` | Start the backend with nodemon |
| `backend` | `npm start` | Start the backend with Node.js |
| `frontend` | `npm run dev` | Start the Vite development server |
| `frontend` | `npm run lint` | Run ESLint |
| `frontend` | `npm run build` | Generate a production frontend build |
| `frontend` | `npm run preview` | Preview the generated frontend build locally |

## Page Metadata

Page metadata is managed through:

- `frontend/src/config/seoConfig.js`
- `frontend/src/hooks/usePageSEO.js`

Each page applies its own title, description, keywords, and robots directive. The initial fallback is defined in `frontend/index.html`.

Account, authentication, conversation, and error pages use `noindex`. Conversation pages display the selected chat title in the browser tab.

Metadata controls are separate from authentication and access permissions.

## Security

- Password hashing with bcrypt.
- JWT authentication using HttpOnly cookies.
- Active session checks and session revocation.
- Email OTP expiry, resend cooldown, and verification attempt limits.
- Shared account login limits for email and phone identifiers.
- Origin validation and restricted CORS.
- Conversation and document ownership checks.
- Request validation with Joi.
- File size, extension, and content checks.
- Upload rate limits applied before file parsing.
- Separate chat request limits and AI usage budgets.
- Backend-only storage of provider credentials.

HTTP rate limiters use process memory. A multi-instance deployment requires a shared limiter store.

## Scope and Limitations

- Guest users can explore the dashboard; chat and document features require sign-in.
- Document support is limited to PDF and DOCX files.
- Edited Word document generation and export are not included.
- AI responses may contain inaccuracies and should be reviewed.
- Free-provider quotas and service availability can affect requests.
- Live service testing and deployment verification are separate from local code checks.

## Author

**Krushna Chandra Mohanty**

Developed for full-stack learning, portfolio demonstration, and interview discussions.