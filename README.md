# QueryNest AI — AI Chat & Document Assistant

QueryNest AI is a full-stack AI assistant for everyday questions, coding help, writing assistance and document-based conversations.

Users can upload PDF and Word documents, ask questions about their content, generate summaries and review resumes. Saved conversations make it possible to continue discussions with relevant document context.

Built with MongoDB, Express, React and Node.js, QueryNest AI combines a responsive chat workspace with Groq and Google Gemini provider routing.

**Live Website:** [querynest-ai-40r0.onrender.com](https://querynest-ai-40r0.onrender.com)

## About the Project

I built QueryNest AI to bring general AI conversations and document assistance into one workspace.

Users can ask questions directly or upload documents for more specific assistance. The backend extracts document text, divides it into chunks and retrieves relevant content to support document-related answers and follow-up questions.

AI requests are handled through a provider-routing layer with request limits, token budgets and fallback handling.

The application is organized into three areas:

- **Guest Dashboard:** Preview the chat interface and access signup or login.
- **Chat Workspace:** Start conversations, upload documents and revisit saved chats.
- **My Profile:** Manage personal details, update a profile picture, view usage and clear chat history.

Chat, document uploads and account features require authentication.

## Features

### Chat Workspace

- General questions, coding help and writing assistance.
- Streaming AI responses.
- Saved conversations and sidebar history.
- Response regeneration and response history.
- Markdown formatting and syntax-highlighted code blocks.
- Conversation titles displayed in the browser tab.
- Responsive sidebar and mobile navigation.
- Auto-expanding message composer.

### Document Assistance

- PDF and Word (.docx) uploads.
- Document summaries and content-based questions.
- Resume review and writing improvement.
- Text extraction, chunking and embedding generation.
- Relevant document retrieval for follow-up questions.
- File size, type and extracted-content limits.

### Account and Profile

- Signup, login and logout.
- Login using email or phone number.
- Email OTP-based password recovery.
- Name and profile picture updates.
- Read-only registered email and phone details.
- AI usage and application limit information.
- Clear all chat history with confirmation.
- Guest dashboard access after logout.

## Tech Stack

| Area | Technologies |
| --- | --- |
| Frontend | React, Vite, React Router |
| User Interface | Material UI, Bootstrap, CSS, Font Awesome |
| API Requests | Axios |
| Notifications | React Toastify |
| Response Rendering | React Markdown, Remark GFM, React Syntax Highlighter |
| Backend | Node.js, Express |
| Database | MongoDB Atlas, Mongoose |
| AI Providers | Groq, Google Gemini |
| Document Retrieval | Embeddings, MongoDB Atlas Vector Search |
| Document Processing | PDF Parse, Mammoth |
| Authentication | JWT, HttpOnly cookies, bcrypt |
| Validation | Joi |
| File Handling | Multer, File Type |
| Profile Image Storage | Cloudinary |
| Email | Brevo |
| Deployment | Render |
| API Testing | Postman |

## Application Workflow

1. A user creates an account or signs in.
2. The user starts a conversation and submits a message or document.
3. The backend validates the request, ownership and usage limits.
4. Uploaded documents are processed into searchable text chunks.
5. Relevant document content is retrieved when the question requires it.
6. The AI routing service selects a provider according to its configured rules and availability.
7. The response streams to the interface and is saved in the conversation.
8. The user can continue the discussion or revisit it from chat history.

General questions can be answered without uploading documents. Document follow-ups use relevant content from the associated conversation.

Provider quotas still apply when using fallback routing.

## Authentication and Validation

Authentication uses signed JWTs stored in HttpOnly cookies, with active session records and session revocation.

Backend controls include:

- Password hashing with bcrypt.
- Unique email and phone constraints.
- Server-side request validation.
- Authentication and conversation ownership checks.
- Shared account login limits for email and phone identifiers.
- Origin checks for state-changing API requests.
- Restricted cross-origin access.
- Upload validation and rate limiting before file parsing.
- Chat request limits and AI token budgets.
- Session invalidation after password reset.

Password recovery uses a six-digit email OTP with a ten-minute validity, a sixty-second resend cooldown and limits on requests and incorrect verification attempts.

HTTP request limiters use process memory. Multiple backend instances require a shared limiter store.


## Project Structure

```text
QueryNest_AI/
├── backend/
│   ├── config/
│   │   ├── aiProviders.js
│   │   ├── cloudinary.js
│   │   ├── db.js
│   │   ├── email.js
│   │   └── usageLimits.js
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── chatController.js
│   │   ├── documentController.js
│   │   ├── passwordResetController.js
│   │   ├── usageController.js
│   │   └── userController.js
│   ├── middleware/
│   │   ├── authMiddleware.js
│   │   ├── csrfMiddleware.js
│   │   ├── errorMiddleware.js
│   │   ├── ownershipMiddleware.js
│   │   ├── rateLimiter.js
│   │   ├── uploadMiddleware.js
│   │   └── validateMiddleware.js
│   ├── models/
│   │   ├── AIUsage.js
│   │   ├── AuthSession.js
│   │   ├── Conversation.js
│   │   ├── Document.js
│   │   ├── DocumentChunk.js
│   │   ├── Message.js
│   │   ├── PasswordReset.js
│   │   └── User.js
│   ├── routes/
│   │   ├── authRoutes.js
│   │   ├── chatRoutes.js
│   │   ├── documentRoutes.js
│   │   ├── usageRoutes.js
│   │   └── userRoutes.js
│   ├── services/
│   │   ├── ai/
│   │   │   ├── aiRouter.js
│   │   │   ├── contextBuilder.js
│   │   │   ├── geminiProvider.js
│   │   │   ├── groqProvider.js
│   │   │   ├── promptTemplates.js
│   │   │   └── taskRouter.js
│   │   ├── documents/
│   │   │   ├── chunkService.js
│   │   │   ├── docxExtractor.js
│   │   │   └── pdfExtractor.js
│   │   ├── retrieval/
│   │   │   ├── embeddingService.js
│   │   │   └── retrievalService.js
│   │   ├── usage/
│   │   │   ├── requestScheduler.js
│   │   │   ├── tokenBudget.js
│   │   │   └── usageService.js
│   │   ├── deletionService.js
│   │   └── emailService.js
│   ├── utils/
│   │   ├── ExpressError.js
│   │   ├── generateToken.js
│   │   └── streamResponse.js
│   ├── validations/
│   │   └── schema.js
│   ├── app.js
│   ├── server.js
│   ├── package.json
│   └── package-lock.json
│
├── frontend/
│   ├── public/
│   │   └── images/
│   │       ├── default-avatar.svg
│   │       ├── QueryNest_AI_Favicon.png
│   │       └── QueryNest_AI_Logo.png
│   ├── src/
│   │   ├── auth/
│   │   │   ├── ForgotPassword.jsx
│   │   │   ├── Login.jsx
│   │   │   └── Signup.jsx
│   │   ├── components/
│   │   │   ├── chat/
│   │   │   │   ├── ChatHistory.jsx
│   │   │   │   ├── ChatSidebar.jsx
│   │   │   │   ├── CodeBlock.jsx
│   │   │   │   ├── MessageComposer.jsx
│   │   │   │   └── MessageList.jsx
│   │   │   └── common/
│   │   │       ├── NotFound.jsx
│   │   │       └── ProtectedRoute.jsx
│   │   ├── config/
│   │   │   ├── appConfig.js
│   │   │   └── seoConfig.js
│   │   ├── context/
│   │   │   └── AuthContext.jsx
│   │   ├── css/
│   │   │   ├── auth.css
│   │   │   ├── global.css
│   │   │   └── panel.css
│   │   ├── hooks/
│   │   │   └── usePageSEO.js
│   │   ├── layouts/
│   │   │   ├── AuthLayout.jsx
│   │   │   └── ChatLayout.jsx
│   │   ├── services/
│   │   │   ├── api.js
│   │   │   ├── chatService.js
│   │   │   └── documentService.js
│   │   ├── user/
│   │   │   ├── ChatDashboard.jsx
│   │   │   ├── Conversation.jsx
│   │   │   └── Profile.jsx
│   │   ├── utils/
│   │   │   ├── formatDate.js
│   │   │   └── groupConversations.js
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── eslint.config.js
│   ├── index.html
│   ├── package.json
│   ├── package-lock.json
│   └── vite.config.js
│
├── .gitignore
├── backend_packages.txt
├── frontend_package.txt
└── README.md
```

Local `.env` files, `node_modules` directories and generated `dist` files are excluded from this structure.

## Local Setup

### Prerequisites

- Node.js 24 and npm.
- MongoDB Atlas database with transaction support.
- Atlas vector-search index matching the retrieval service configuration.
- Groq and Google Gemini API credentials.
- Cloudinary account.
- Brevo account with a verified sender.
- Nodemon for the backend development script.

### 1. Get the Project

Clone this repository using its GitHub URL, or download and extract the source.

Open a terminal in the project folder:

```bash
cd QueryNest_AI
```

### 2. Install Dependencies

```bash
npm ci --prefix backend
npm ci --prefix frontend
```

If nodemon is not installed:

```bash
npm install -g nodemon
```

### 3. Configure Environment Variables

Create `backend/.env`:

```env
NODE_ENV=development
PORT=8080
CLIENT_ORIGIN=http://localhost:5173

DB_URI=your_mongodb_connection_string
JWT_SECRET=your_generated_secret

GROQ_API_KEY=your_groq_api_key
GEMINI_API_KEY=your_gemini_api_key

CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

BREVO_API_KEY=your_brevo_api_key
BREVO_SENDER_EMAIL=your_verified_sender_email
BREVO_SENDER_NAME=QueryNest AI

TRUST_PROXY_HOPS=0
SERVE_FRONTEND=false
```

Generate a JWT secret:

```bash
node -e "console.log(require('node:crypto').randomBytes(64).toString('hex'))"
```

Create `frontend/.env`:

```env
VITE_API_URL=http://localhost:8080/api
```

Replace the placeholders with your own credentials. Keep `.env` files out of version control and allow your backend's connection IP in MongoDB Atlas.

Configure the vector-search index to match the index name, embedding dimensions and fields expected by the retrieval service.

### 4. Start the Backend

```bash
npm run dev --prefix backend
```

### 5. Start the Frontend

Run this command in a separate terminal:

```bash
npm run dev --prefix frontend
```

Open the URL shown by Vite. It should match the backend's `CLIENT_ORIGIN` setting.

The backend health endpoint is available at:

```text
http://localhost:8080/api/health
```

The dashboard is accessible to guests. Sign in to use conversations, document uploads and profile features.

## Deployment

The application is deployed on Render. The frontend and backend use a single Web Service, with Express serving the frontend production build and API under the same domain.

- **MongoDB Atlas** stores application data and document retrieval records.
- **Cloudinary** stores profile images.
- **Brevo** sends password recovery emails.
- **Groq and Google Gemini** handle AI requests.
- **Render environment variables** store deployment configuration and credentials.

### Build Command

```bash
npm ci --prefix backend && npm ci --prefix frontend --include=dev && npm run build --prefix frontend
```

### Start Command

```bash
npm start --prefix backend
```

### Production Settings

Alongside the database and service credentials, configure:

```env
NODE_ENV=production
VITE_API_URL=/api
SERVE_FRONTEND=true
CLIENT_ORIGIN=https://querynest-ai-40r0.onrender.com
```

Set `NODE_VERSION` to the Node.js version used to validate the application.

Render provides the server port through `PORT`; a manually configured port is not required.

Set `TRUST_PROXY_HOPS` according to the actual hosting and proxy configuration. Verify it before relying on client-IP-based rate limiting.

Use your own service URL for `CLIENT_ORIGIN` when deploying another instance.

The production frontend build completed successfully. Full live end-to-end testing is pending.

## Author

**Krushna Chandra Mohanty**

[GitHub](https://github.com/krushna706)