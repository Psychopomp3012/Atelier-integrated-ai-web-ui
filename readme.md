Problem Statement:
1. Ability to switch between CLIs seamlessly.
2. The task keeps on executing on cloud in a sandbox

Instructions(for me):
1. Avoid Coding???
2. Figure out, if i can't code what is in my hand? => Prompts Engineering?
3. 

Architecture:
Frontend(React + TS + Tailwind(v3))

Backend(TS + Fastify)

"Atelier" (or Atelier Studio) — French for a master craftsman's workshop

Features:


Sandbox(E2B):
- 2vCPU + 500MB-RAM
- upto 3 sandboxes max
- 0.1656 USD / hour
- 15 min inactivity timeout
- costs nothing when inactive


Antigravity(Useful settings):
/settings: 
1. Artifact Review: ask for review | always proceed
2. Sandbox Mode: on | off
3. Tool Permission: request-review | proceed-in-sandbox | always proceed | strict

Current principle:
"Every user turn spawns a new one-shot process"
"Problem is that all clis has a different way of caching messages"

Scenarios:
potentially read their own ~/.gemini/oauth_creds.json inside the VM.


Future Objectives:
- Claude Auth (no auth for free account?)
- No visual testing possible as a cloud server has no GUI?
- add a limit to text typed in frontend and correesponding in backend (does not seem that important)
- attaching a very big file
- polling for quota => refactored to single unified /api/v1/quota endpoint (DONE)


Mistral free models:
1. codestral-2508
2. ministral-14b-2512
3. ministral-8b-2512
4. ministral-3b-2512
5. voxtral-small-2507

---

## Visual Architecture & Plan
google-chrome backend/visualizations/index.html
# or
xdg-open backend/visualizations/index.html

---

## 🛡️ API Architecture, Authentication & Calibrated Rate Limiting

### 1. Request Lifecycle Pipeline (Execution Order)
Every backend endpoint strictly adheres to the following four-phase defense-in-depth pipeline:
1. **Phase 1: Cryptographic JWT Verification (`preValidation`)**
   - For authenticated routes (`requireAuth`), extracts `Authorization: Bearer <token>` and verifies HMAC-SHA256 signature via `tokenUtil.verifyJwt`.
   - Rejects unauthenticated callers immediately with `401 UNAUTHORIZED`. Unauthenticated callers cannot trigger schema parsing or downstream compute.
   - For public/discovery routes, `optionalAuth` safely extracts identity if present.
2. **Phase 2: Multi-Tenant Sliding-Window Rate Limiting (`preValidation` - Velocity)**
   - Controls request frequency within a 1-minute sliding window.
   - Keys quotas by `user:<userId>` (for authenticated users) or `ip:<ip>` (for public visitors), guaranteeing multi-tenant isolation (one user cannot starve another).
   - Executed in `preValidation` immediately after JWT authentication to drop abusive floods fast (`O(1)`) before spending CPU on schema parsing.
   - Injects standard headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.
   - On bucket exhaustion, emits `429 RATE_LIMIT_EXCEEDED` with `Retry-After: <seconds>`.
3. **Phase 3: Strict Parameter & Body Schema Validation (`Validation`)**
   - Fastify's Ajv schema validator compiles route JSON schemas (`params`, `querystring`, `body`).
   - Strictly enforces types: if a parameter expects `boolean` but receives a number (`123`), string (`"notaboolean"`), or missing required fields, it is rejected with `400 VALIDATION_ERROR` with detailed validation paths.
4. **Phase 4: Per-Tenant Resource Capacity & Quota Guard (`Capacity & Concurrency`)**
   - Binds total concurrent stateful resources allocated to a tenant (independent of request rate).
   - **MicroVM Sandbox Ceiling**: Capped at **`3 active sandboxes per user`** (`MAX_SANDBOXES_PER_USER = 3`).
   - Before allocating cloud compute (`POST /api/v1/sandbox/create`), verifies active user sandbox count:
     - If at capacity (3/3 full): Rejects immediately with `400 Bad Request` (`QUOTA_EXCEEDED`) and an actionable message to delete an existing sandbox. Under no circumstances is an existing sandbox deleted automatically.
   - Protects against resource exhaustion, memory leaks, and runaway cloud compute costs.

### 2. Calibrated Rate Limiting Tiers
| Tier | Limiter Instance | Rate Limit | Scope / Purpose | Key Endpoints |
| :--- | :--- | :---: | :--- | :--- |
| **Tier 1: Cloud Provisioning** | `sandboxProvisionLimiter` | **5 req / min** | High-cost cloud microVM creation | `POST /api/v1/sandbox/create` |
| **Tier 2: AI Execution** | `agentPromptLimiter` | **20 req / min** | LLM execution & SSE streaming | `POST /api/v1/agent/prompt/stream` |
| **Tier 3: Auth Sensitive** | `authSensitiveLimiter` | **20 req / min** | Credential validation & device codes | `POST /api/v1/auth/google`, `/auth/login`, `/auth/device/*`, `/auth/cli/*/code` |
| **Tier 4: State Mutations** | `mutationLimiter` | **60 req / min** | CRUD, session management, process stops | `POST/DELETE /api/v1/sessions`, `/sessions/:id`, `/agent/stop`, `/sandbox/execute`, `DELETE /sandbox` |
| **Tier 5: Read APIs** | `readApiLimiter` | **120 req / min** | Data queries, files, usage, quota discovery | `GET /api/v1/sessions`, `/sandbox/files`, `/sandboxes`, `/quota`, `/auth/cli/status` |
| **Tier 6: Public Endpoints** | `publicLimiter` | **120 req / min** | Health checks, status, debug logging | `GET /api/v1/auth/config`, `/sandbox/logs`, `/debug/logging` |

### 3. Interactive API Documentation
Interactive OpenAPI 3.0 Swagger UI is served live at `http://localhost:4000/api/docs/` with raw spec at `http://localhost:4000/api/docs/json`.

---

# Hosting
## Deploy the backend folder to Heroku
git subtree push --prefix backend heroku main



agy:
agy is a Go terminal binary that uses a raw terminal reader and opens /dev/tty directly. When Node.js spawns it with standard anonymous pipes (stdio: ['pipe', 'pipe', 'pipe']), agy's terminal reader ignores anonymous pipes and blocks waiting on a real pseudo-terminal (PTY) until its 60-second internal timeout expires!
- It allocates a pseudo-terminal (openpty), connects agy to the PTY slave, and bi-directionally bridges Node's pipe stdin/stdout into the PTY master.



## 🚀 Future Improvements & Backlog

### Phase 4 Resource Quota & Capacity Guards (Planned)
The 4th phase of our defense pipeline (`Capacity & Resource Quota Guard`) is currently enforced for Cloud Sandboxes (capped at 3 active microVMs per tenant). Future improvements will expand Phase 4 guards across other stateful surfaces:
1. **In-Flight Agent Stream Guard (`POST /api/v1/agent/prompt/stream`)**:
   - Limit concurrent prompt executions to max **1 in-flight stream per user session**.
   - Concurrently dispatched prompts will return `409 Conflict` (`EXECUTION_IN_PROGRESS`) with a retry-after indicator, preventing race conditions and conflicting tool invocations.
2. **Per-Session Message & Context Ceiling**:
   - Cap conversation message arrays at **1,000 messages** or **750 KB** uncompressed text per session.
   - Automatically trigger history compaction or require branching a new session when the ceiling is reached to protect against memory blowup and runaway token usage.
3. **Tenant Session Storage Ceiling (`POST /api/v1/sessions`)**:
   - Limit total active chat sessions stored per user to **50 sessions**.
   - Require users to delete/archive older sessions or auto-archive the oldest session when creating a 51st.
4. **Device Authorization Pending Code Cap (`POST /api/v1/auth/device/code`)**:
   - Cap active pending CLI device authorization codes at **1 unconfirmed code per user/IP**.
   - Requesting a new device code automatically invalidates previous pending codes, mitigating authorization handshake flooding.
5. **MicroVM Command Concurrency Ceiling (`POST /api/v1/sandbox/execute`)**:
   - Cap concurrent process/PTY executions to **2 concurrent commands per microVM sandbox** to guard against CPU thrashing and runaway fork bombs.
6. **Telemetry & Log Retention Quota (`/debug/logging`)**:
   - Bound rolling in-memory debug audit records to **500 records per user**, evicting oldest logs in FIFO order.

### General Platform Improvements
- **MicroVM CLI Auto-Updates**: Automated background runner to refresh and update CLI binaries (`agy`, `gemini`, `codex`, `claude`) inside microVM templates on a 24-hour cycle.


