<div align="center">

  <img src="frontend/public/brand/originhub-icon.svg" alt="OriginHub" width="72" height="72">

  # OriginHub

  End-to-end encrypted web messenger with real-time delivery, client-side cryptography, and a single-page web client.

</div>

---

[![FastAPI](https://img.shields.io/badge/backend-FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Vite](https://img.shields.io/badge/frontend-Vite-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev/)
[![PostgreSQL](https://img.shields.io/badge/database-PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org/)

## Overview

OriginHub is a browser-based messaging application where message plaintext is encrypted and decrypted only in the client. The backend stores ciphertext, routes WebSocket events, and manages authentication and metadata. It does not hold the keys required to read message content.

The project exists to provide a small, inspectable reference for building encrypted chat with:

- Hybrid encryption in the browser (Web Crypto API)
- Double-encrypted message storage (separate ciphertext for sender and recipient)
- Real-time delivery over WebSockets with offline fallback
- Incremental UI updates without full chat rerenders

OriginHub is still under development. It is suitable for learning, self-hosting experiments, and contribution — not as a drop-in replacement for established messengers without additional hardening and review.

---

## Features

### Implemented

- [x] Basic user registration and login (JWT, bcrypt password hashing)
- [x] Client-side key generation (RSA-OAEP 2048)
- [x] Password-encrypted private key backup for multi-device login
- [x] End-to-end encrypted text messaging (AES-GCM-256 + RSA-OAEP)
- [x] Double ciphertext storage (`content_recipient` / `content_sender`)
- [x] Real-time message delivery via WebSocket
- [x] Offline message queue for disconnected recipients
- [x] Chat history sync from PostgreSQL (paginated)
- [x] Reply to messages
- [x] Message reactions (emoji, one per user per message)
- [x] Read receipts and delivery acknowledgements
- [x] Typing indicators and online presence (privacy-controlled)
- [x] Message and conversation deletion
- [x] Link detection with safe URL rendering and security notice
- [x] Profile settings (display name, bio, avatar)
- [x] Contact mini-profiles (hover cards)
- [x] Light / dark / system theme and glass intensity controls
- [x] Local drafts, preferences, and chat history cache
- [x] Contact search and chat export
- [x] Keyboard shortcuts and context menus

---

## Screenshots

Screenshots of the OriginHub interface.

### Login

<p align="center">
  <img src="docs/screenshots/originhub-login.png" alt="OriginHub Login Screen" width="750" /><br>
  <em>Authentication screen with username/password login and registration.</em>
</p>

### Chat

<p align="center">
  <img src="docs/screenshots/originhub-light.png" alt="OriginHub Chat Light" width="48%" /> 
  <img src="docs/screenshots/originhub-dark.png" alt="OriginHub Chat Dark" width="48%" />
  <br>
  <em>Active conversation with message list, composer, and sidebar (Light and Dark modes).</em>
</p>

### Profile

<p align="center">
  <img src="docs/screenshots/originhub-profile.png" alt="OriginHub Login Screen" width="750" /><br>
  <em>Profile settings: identity, privacy controls, storage overview.</em>
</p>

### Settings

<p align="center">
  <table>
    <tr>
      <td align="center">
        <img src="docs/screenshots/originhub-settings.png" alt="Theme Settings" width="380"/><br>
        <sub>Theme Configuration</sub>
      </td>
      <td align="center">
        <img src="docs/screenshots/originhub-privacy.png" alt="Glass Intensity" width="380"/><br>
        <sub>Privacy Controls</sub>
      </td>
    </tr>
    <tr>
      <td align="center">
        <img src="docs/screenshots/originhub-security.png" alt="Composer Behaviour" width="380"/><br>
        <sub>Security settings</sub>
      </td>
      <td align="center">
        <img src="docs/screenshots/originhub-data.png" alt="Privacy Settings" width="380"/><br>
        <sub>Data control</sub>
      </td>
    </tr>
  </table>
</p>



---

## Architecture

OriginHub is split into a static frontend (Vite) and a FastAPI backend. All message encryption runs in the browser. PostgreSQL stores users, encrypted payloads, reactions, and delivery metadata.

```mermaid
flowchart TB
    subgraph Client["Browser (Frontend)"]
        UI["UI Layer<br/>ui.js, overlays, themes"]
        Crypto["Crypto Layer<br/>Web Crypto API"]
        State["Local State<br/>localStorage, drafts, cache"]
        UI --> Crypto
        UI --> State
    end

    subgraph Server["Backend (FastAPI)"]
        REST["REST API<br/>auth, history, profile"]
        WS["WebSocket Manager<br/>routing, presence, events"]
        REST --> DB
        WS --> DB
    end

    subgraph Data["PostgreSQL"]
        DB[("users · chat_history<br/>message_reactions · offline_messages")]
    end

    Client -->|"HTTPS + JWT"| REST
    Client -->|"WSS + JWT"| WS
```

| Layer | Role |
|-------|------|
| **Frontend** | SPA built with Vite. Vanilla JavaScript modules, no framework. Handles UI, routing, encryption, and local persistence. |
| **Backend** | FastAPI application. Authenticates requests, persists ciphertext, fans out WebSocket events. |
| **Database** | PostgreSQL. Stores encrypted blobs, public keys, profile metadata, reactions, read state. |
| **WebSocket** | Persistent connection per authenticated user. Delivers messages, status updates, presence, and deletions in real time. |
| **Encryption** | Entirely client-side. Server receives and stores only encrypted bytes and routing metadata. |

---

## Message Flow

When User A sends a message to User B:

1. A's browser encrypts plaintext twice — once with B's public key, once with A's own public key.
2. Ciphertext is sent over WebSocket to the server.
3. The server forwards ciphertext to B if online, then persists both ciphertext columns to PostgreSQL.
4. A receives a `message_ack` with the database `id`.
5. B decrypts with B's private key. A can later decrypt their copy with A's private key from history.

```mermaid
sequenceDiagram
    participant A as User A (Browser)
    participant S as Server (FastAPI)
    participant DB as PostgreSQL
    participant B as User B (Browser)

    A->>A: Generate AES key, encrypt plaintext (AES-GCM)
    A->>A: Wrap AES key with RSA-OAEP (recipient + sender keys)
    A->>S: WebSocket: message { content_recipient, content_sender }
    S->>B: WebSocket: message { content (recipient blob) }
    S->>DB: INSERT chat_history (ciphertext only)
    S->>A: WebSocket: message_ack { id, client_message_id }
    S->>A: WebSocket: message_status { status: sent }
    B->>B: Decrypt with private key
    B->>S: WebSocket: delivery_ack
    S->>A: WebSocket: message_status { status: delivered }
    B->>S: WebSocket: read_receipt
    S->>A: WebSocket: message_status { status: read }
```

---

## Encryption

### Where encryption happens

All message and key operations run in the browser via the [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API):

| Operation | Algorithm | Location |
|-----------|-----------|----------|
| Message encryption | AES-GCM-256 (content) + RSA-OAEP-2048 (key wrap) | Client |
| Message decryption | Same | Client |
| Key pair generation | RSA-OAEP-2048 | Client |
| Private key at rest (server) | PBKDF2-SHA256 (100k iter) + AES-GCM-256 | Client, before upload |
| Password authentication | bcrypt | Server |

Each message uses a fresh AES key and IV. The envelope is JSON (`v: 2`) containing base64-encoded `iv`, `ek` (encrypted key), and `ct` (ciphertext).

### What the server sees

- Usernames and bcrypt password hashes
- Public keys (JWK)
- Password-encrypted private keys (opaque blob)
- Ciphertext for sender and recipient (`content_sender`, `content_recipient`)
- Message metadata: timestamps, `client_message_id`, `reply_to_message_id`, delivery/read timestamps
- Reactions (emoji per user per message)
- Profile fields: display name, bio, avatar (base64 data URL)

### What the server does not see

- Message plaintext
- Private keys in decrypted form
- User passwords in plaintext (only bcrypt hashes)

### Limitations

> **This is not a formal security proof.** The implementation has not undergone an independent audit.

- **Server trust model:** The server could serve a modified client, log ciphertext for traffic analysis, or withhold delivery. Users must trust the deployed frontend bundle.
- **No forward secrecy:** Messages use long-lived RSA keys. Compromise of a private key exposes historical ciphertext stored on the server.
- **Metadata is visible:** Who talks to whom, when, and message sizes are observable by the server operator.
- **Profile data is not E2EE:** Display names, bios, and avatars are stored in plaintext on the server.
- **JWT secret:** A weak or default `JWT_SECRET_KEY` breaks session security. Always set a strong secret in production.
- **Hardcoded production URLs:** The frontend points to fixed API/WebSocket hosts; verify you deploy matching backend and frontend builds.

---

## Real-Time Synchronization

After login, the client opens a WebSocket to `/ws?token=<JWT>`, sends a `join` packet with username and public key, then handles incoming event types:

| Event | Purpose |
|-------|---------|
| `message` | Incoming ciphertext from another user |
| `message_ack` | Confirms persistence; assigns server `id` to outgoing message |
| `message_sync` | Updates recipient copy with `id` after save |
| `message_status` | Sent / delivered / read status for outgoing messages |
| `reaction_sync` | Reaction added or removed on a message |
| `message_deleted` | Single message removed for both participants |
| `conversation_deleted` | Entire thread cleared |
| `typing` | Partner is typing (if enabled in privacy settings) |
| `presence` / `presence_sync` | Online/offline state |
| `profile_updated` | Contact profile metadata changed |
| `unread_sync` | Unread count for a conversation |

The frontend uses incremental DOM updates (`appendMessage`, targeted patches) rather than rebuilding the full message list on every event. Message actions (reply, react, delete) use event delegation on the messages container so handlers survive DOM changes.

```mermaid
flowchart LR
    WS[WebSocket Event] --> Handler[app.js handler]
    Handler --> State[chatHistory state]
    Handler --> Patch[DOM patch / append]
    State --> LS[(localStorage cache)]
```

---

## Technology Stack

| Category | Technology |
|----------|------------|
| **Languages** | JavaScript (ES modules), Python 3 |
| **Frontend** | Vite 8, vanilla JS, CSS custom properties |
| **Backend** | FastAPI, Uvicorn, WebSockets |
| **Database** | PostgreSQL (`psycopg2` connection pool) |
| **Auth** | JWT (PyJWT, HS256), bcrypt |
| **Crypto (client)** | Web Crypto API — RSA-OAEP, AES-GCM, PBKDF2 |
| **Deployment** | Frontend: Vercel · Backend: Render (current production setup) |

---

## Project Structure

```
origin-e2e-chat/
├── backend/
│   ├── main.py              # FastAPI app, REST routes, WebSocket endpoint
│   ├── ws_manager.py        # Connection manager, event routing, presence
│   ├── database.py          # PostgreSQL schema, queries, connection pool
│   └── requirements.txt
├── frontend/
│   ├── index.html           # SPA shell and inline critical styles
│   ├── vite.config.js
│   ├── vercel.json          # SPA rewrite rules for deployment
│   ├── js/
│   │   ├── app.js           # Application entry, WebSocket handlers, routing
│   │   ├── crypto.js        # Key generation, encrypt/decrypt, key backup
│   │   ├── api.js           # REST client
│   │   ├── network.js       # WebSocket client with reconnect
│   │   ├── ui.js            # DOM rendering, message list, actions
│   │   ├── messageSync.js   # Ack, status, read receipt logic
│   │   ├── messageReactions.js
│   │   ├── messageReply.js
│   │   ├── messageDelete.js
│   │   ├── realtime.js      # Presence, typing, unread state
│   │   ├── profile.js       # Local profile identity
│   │   ├── profileSettings.js
│   │   ├── miniProfile.js   # Contact hover cards
│   │   └── …
│   ├── ui/overlays/         # Dropdown, context menu, popover, modal system
│   └── public/
│       ├── brand/           # Logo assets (SVG)
│       └── css/             # Theme, layout, component styles
└── README.md
```

| Path | Description |
|------|-------------|
| `backend/main.py` | HTTP API and WebSocket entry point |
| `backend/ws_manager.py` | Real-time event dispatch and session state |
| `backend/database.py` | Schema migrations on startup, all SQL access |
| `frontend/js/crypto.js` | Encryption implementation — start here for security review |
| `frontend/js/app.js` | Orchestrates login, chat, and WebSocket event handling |
| `frontend/ui/overlays/` | Shared overlay manager used by menus and modals |

---

## Installation

### Prerequisites

- **Node.js** 18+ and npm
- **Python** 3.10+
- **PostgreSQL** 14+ (local or hosted)

### 1. Clone the repository

```bash
git clone https://github.com/<shytyk-develop>/origin-e2e-chat.git
cd origin-e2e-chat
```

### 2. Backend setup

```bash
cd backend
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Create `backend/.env`:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/originhub
JWT_SECRET_KEY=replace_with_a_long_random_secret_at_least_32_bytes
```

Tables are created automatically when the backend module loads (`database.init_db()` runs on import).

Start the API server:

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Verify: `http://localhost:8000/docs` (FastAPI OpenAPI UI).

### 3. Frontend setup

```bash
cd frontend
npm install
```

For local development, point the client at your backend by editing:

- `frontend/js/api.js` — set `API_URL` to `http://localhost:8000`
- `frontend/js/network.js` — set `WS_BASE_URL` to `ws://localhost:8000/ws`

Also add your dev origin to CORS in `backend/main.py` if it is not already listed.

Start the dev server:

```bash
npm run dev
```

Open the URL shown by Vite (default `http://localhost:5173`).

### 4. First use

1. Register a new account (a key pair is generated in the browser).
2. Register a second account in another browser profile or window.
3. Search for the second user and open a chat.
4. Send a message — inspect the network tab to confirm only ciphertext is transmitted.

---

## Configuration

### Backend environment variables

Create a `.env` file in `backend/` (never commit it):

```env
# Required — PostgreSQL connection string
DATABASE_URL=postgresql://user:password@host:5432/dbname

# Required in production — signs JWT access tokens (HS256)
# Use a cryptographically random string, at least 32 bytes
JWT_SECRET_KEY=
```

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL DSN used by the connection pool |
| `JWT_SECRET_KEY` | Yes (production) | Secret for signing and verifying JWT tokens. A fallback default exists in code for local dev only — **do not use it in production**. |

### Frontend configuration

There is no `.env` layer for the frontend today. Production URLs are constants:

| File | Constant | Default |
|------|----------|---------|
| `frontend/js/api.js` | `API_URL` | `https://originhub.onrender.com` |
| `frontend/js/network.js` | `WS_BASE_URL` | `wss://originhub.onrender.com/ws` |

CORS allowed origins are configured in `backend/main.py`.

---

## Development

### Backend

```bash
cd backend
source venv/bin/activate
uvicorn main:app --reload --port 8000
```

Interactive API docs: `http://localhost:8000/docs`

### Frontend

```bash
cd frontend
npm run dev       # development server with HMR
npm run build     # production build → frontend/dist/
npm run preview   # serve production build locally
```

### Production deployment

**Backend (example: Render)**

1. Create a Web Service from the `backend/` directory.
2. Set start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
3. Add environment variables: `DATABASE_URL`, `JWT_SECRET_KEY`.
4. Attach a PostgreSQL instance and copy its connection string.

**Frontend (example: Vercel)**

1. Set root directory to `frontend/`.
2. Build command: `npm run build`
3. Output directory: `dist`
4. `vercel.json` rewrites all routes to `index.html` for client-side routing.

After deployment, update `API_URL` and `WS_BASE_URL` in the frontend source and rebuild, then add the frontend origin to backend CORS.

---

## Security Notes

### Protected

- Message body content (encrypted before leaving the browser)
- Private keys (encrypted with user password before server upload; decrypted only client-side after login)

### Not protected

- Usernames, profile text, avatars
- Message timestamps, IDs, reply references, reaction emoji
- Traffic metadata (conversation graph, online status if shared)
- Client-side data in `localStorage` (accessible to anyone with physical access to the unlocked browser)

### Operational recommendations

- Use HTTPS and WSS in production.
- Set a strong, unique `JWT_SECRET_KEY`.
- Review CORS origins — allow only your frontend domain.
- Treat the frontend bundle as part of your trusted computing base; consider subresource integrity or self-hosting.
- Back up PostgreSQL regularly; ciphertext without keys is useless, but keys without ciphertext loses history.

---

## Roadmap

- [ ] Environment-based frontend configuration (no hardcoded API URLs)
- [ ] Encrypted file attachments
- [ ] Message forwarding
- [ ] Automated test suite (crypto round-trip, WebSocket flows)
- [ ] Independent security review
- [ ] Mobile-responsive layout improvements

---

## Contributing

Contributions are welcome. For substantial changes, open an issue first to discuss scope.

1. Fork the repository and create a feature branch from `main`.
2. Keep changes focused — separate UI, crypto, and backend concerns when possible.
3. Do not commit secrets (`.env`, tokens, keys).
4. Test locally with two user accounts before opening a pull request.
5. Describe **what** changed and **why** in the PR body.

Bug reports should include steps to reproduce, browser version, and whether the issue occurs on the production or local deployment.

---

## License

OriginHub is released under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0).

You may use, modify, and distribute this software under the terms of that license. If you deploy a modified version as a network service, you must offer corresponding source code to users who interact with it remotely. The full legal text is in the [LICENSE](LICENSE) file.

---

## Further reading

| Topic | Starting point |
|-------|----------------|
| Encryption implementation | [`frontend/js/crypto.js`](frontend/js/crypto.js) |
| WebSocket event routing | [`backend/ws_manager.py`](backend/ws_manager.py) |
| Message UI and incremental render | [`frontend/js/ui.js`](frontend/js/ui.js) |
| Database schema and queries | [`backend/database.py`](backend/database.py) |

---

<div align="center">

**OriginHub**

Encrypted in the browser. Routed in real time. Documented for developers.

[Contributing](#contributing) · [License](LICENSE) · [Security](#security-notes)

</div>
