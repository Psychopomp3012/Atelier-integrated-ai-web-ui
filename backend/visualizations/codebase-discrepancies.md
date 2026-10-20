# Codebase Architectural & Functional Discrepancies Audit

> **Comprehensive Analysis**: Exhaustive, function-by-function audit across all Backend and Frontend classes, services, controllers, and state management hooks based on the consolidated Master Class Diagram.

---

## 📋 Executive Summary Table

| ID | Area / Domain | File & Symbol | Discrepancy / Edge Case | Severity | Current Behavior | Expected / Desired Behavior | Recommended Remedy |
| :--- | :--- | :--- | :--- | :---: | :--- | :--- | :--- |
| **D-01** | Agent Streaming | [`agent.controller.ts:152`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/modules/agent/agent.controller.ts#L152)<br>`executePromptStream` | **Missing SSE Disconnect / Abort Listener** | **RESOLVED**<br>*(Implemented)* | Disconnects previously lost in-flight runs, and clicking Stop didn't kill microVM CLI. | Explicit Stop dispatches `POST /api/v1/agent/stop` and kills VM process (`pkill`). Tab disconnects finish and save directly to Firestore. | Added `POST /api/v1/agent/stop`, `killAgentProcesses`, `req.raw.on('close')`, and server-side Firestore persistence. |
| **D-02** | Agent Execution | [`agent.controller.ts:43`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/modules/agent/agent.controller.ts#L43)<br>`executePrompt` | **Dead Non-Streaming REST Endpoint** | **RESOLVED**<br>*(Removed)* | `executePrompt` was an unused synchronous prototype endpoint that tied up server sockets. | Entire platform is built around SSE streaming tokens and real-time step visualization. | Removed unused route and controller method; app is 100% SSE streaming powered. |
| **D-03** | Agent Routing | [`agent.service.ts:655`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/modules/agent/agent.service.ts#L655)<br>`callLiveAI` | **Auto-Defaulting Fallback Routing & Pre-check** | **RESOLVED**<br>*(Implemented)* | Backend previously dispatched CLI commands into microVMs without checking if user linked the subscription, causing slow crashes. Switching sessions also hijacked selected model. | Pre-check link status before VM dispatch; throw `CLI_NOT_LINKED` immediately; preserve user's model preference across session switches. | Added backend link pre-check, SSE `code: CLI_NOT_LINKED` event, and decoupled session switching from promptbar model selection. |
| **D-04** | Live Quota | [`codex-quota.service.ts`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/modules/quota/codex-quota.service.ts)<br>`queryCodexVersion` | **Hardcoded Fallback Version String & Extra MicroVM Call** | **RESOLVED**<br>*(Removed)* | Quota fetch previously executed an extra `codex --version` shell process in the microVM on every request, and returned hardcoded fallback `'0.163.0'`. Frontend never reads this description. | Live discovery should not run redundant microVM commands for unused fields or use hardcoded fallbacks. | Completely removed `queryCodexVersion` and the extra microVM execution, matching Antigravity quota service. |
| **D-05** | Cloud Sandbox | [`e2b-sandbox.provider.ts`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/modules/sandbox/e2b-sandbox.provider.ts)<br>`createSandbox` | **Legacy API Key Environment Seeding** | **RESOLVED**<br>*(Removed)* | Inspects `process.env.GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` into an unused array in `createSandbox`. | Platform rule requires subscription-based OAuth device auth without raw developer API keys. | Removed dead `envExports` and raw API key seeding block; microVM relies strictly on OAuth device credentials. |
| **D-06** | MicroVM Permissions | [`e2b-sandbox.provider.ts`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/modules/sandbox/e2b-sandbox.provider.ts)<br>`readFile` & `executeCliInSandbox` | **Dual-User Permission Boundary Mismatch** | **RESOLVED**<br>*(Implemented)* | Prompts execute under `agent-runner` user, but filesystem inspector reads files as `user` (UID 1000). If `agent-runner` writes `0600` files, inspector fails. | Files created in `/workspace` should be world-readable (`chmod 664`) or group-shared across both users. | Added `chmod -R 2777` SetGID to `/workspace`, post-execution `chmod -R a+rX` sweep, and `sudo cat` fallback in `readFile`. |
| **D-07** | CLI Authentication | [`cli-auth.service.ts`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/modules/auth/cli-auth.service.ts)<br>`unlinkUserCli` | **MicroVM Credential Purge Incomplete on Unlink** | **RESOLVED**<br>*(Implemented)* | Calling `unlinkCli` deletes Firestore tokens and backend profiles, but left active running microVM credentials (`/home/agent-runner/.codex/auth.json`, `.gemini`, etc.) intact. | Unlinking should actively scrub credentials from all currently running microVMs attached to that user. | Implemented `purgeUserCredentialsFromSandboxes` in `E2BSandboxProvider`, `SandboxService`, `unlinkUserCli`, and controller unlink endpoints. |
| **D-08** | Authentication | [`api.util.ts`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/frontend/src/utils/api.util.ts)<br>`apiFetch` & [`App.tsx`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/frontend/src/App.tsx) | **Silent Token Expiration Disconnect** | **RESOLVED**<br>*(Implemented)* | JWT expires after 7 days (`7d`). If a tab is kept open idle for >7 days, the next SSE execution fails with an unhandled 401 instead of prompt. | Frontend should detect token expiry and smoothly refresh or display the session expiration dialog. | Added `isTokenExpired` check, reactive 401 dispatching in `apiFetch`, tab `visibilitychange` handler, and automated cleanup/re-login trigger. |
| **D-09** | Session Persistence | [`App.tsx`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/frontend/src/App.tsx) & [`sessionSync.service.ts`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/frontend/src/services/sessionSync.service.ts)<br>`saveSession` | **`session.messageCount` Slicing Desync** | **RESOLVED**<br>*(Implemented)* | When frontend sends a capped 25-message window, `mergeMessages` retains historical messages, but `messageCount` was locally set to `incoming.length` (25), resetting the sidebar badge. | `session.messageCount` should always reflect the total length including earlier unrendered messages (`remainingMessageCount + msgs.length`) and server-merged count. | Factored `remainingMessageCount` into `messageCount` calculations in `App.tsx` and re-synced backend merged `messageCount` in `sessionSyncService.saveSession`. |
| **D-10** | Session Reconciliation | [`sessionSync.service.ts:65`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/frontend/src/services/sessionSync.service.ts#L65)<br>`loadAndReconcileSessions` | **Deleted Session Re-Hydration from LocalStorage** | **RESOLVED**<br>*(Implemented)* | Merges localStorage sessions with backend sessions. If user deletes a session on device B, device A's localStorage may re-upload the deleted session. | Deletions should persist a lightweight tombstone or use cloud sessions as source-of-truth when online. | Implemented tombstone tracking (`getTombstones`, `addTombstone`), cloud authority reconciliation, and auto-pruning of stale remote deletions. |
| **D-11** | Model Selection | [`ModelSelectorDropdown.tsx:806`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/frontend/src/components/ModelSelectorDropdown.tsx#L806)<br>`handleSelectModel` | **Reasoning Effort Leaks Across Model Switches** | **RESOLVED**<br>*(Verified / By-Design)* | When switching from a model with effort options (`gemini-2.5-pro-high`) to one without (`gemini-2.5-flash`), `reasoningEffortAtom` was hypothesized to leak. | Effort is embedded 1:1 in model IDs and parsed via regex. Non-reasoning models receive no effort flags. Direct parent click intentionally selects minimum effort (`low`). | Verified effort isolation in CLI command builder; direct parent model clicks intentionally select minimum effort (`low`). |
| **D-12** | Cloud Inspector | [`CloudInspector.tsx`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/frontend/src/components/CloudInspector.tsx) | **Stateless Terminal Execution (`cd` lost)** | **RESOLVED**<br>*(Verified / By-Design)* | Cloud Inspector was hypothesized to lose working directory context during interactive terminal execution. | Cloud Inspector is intentionally a File Explorer & Media/Code Previewer, not an interactive shell. AI agent prompt executions supply absolute paths. | Verified that Cloud Inspector is purely an inspector/previewer; AI execution pipelines explicitly specify absolute execution directories. |
| **D-13** | Cloud Sandbox Isolation | [`e2b-sandbox.provider.ts:342`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/modules/sandbox/e2b-sandbox.provider.ts#L342)<br>`syncActiveSessions` & `clearAllAttachedSessions` | **Cross-Tenant Sandbox Session Detachment Cascade** | **RESOLVED**<br>*(Implemented)* | In `syncActiveSessions`, entries in `sessionToSandboxId` not in caller's active session IDs were wiped without checking `record.userId !== userId`. Additionally, deleting the last session (`clearAllSessions=true`) called `clearAllAttachedSessions()`, detaching all active sessions across ALL users. | Session attachment syncing and deletion must be strictly scoped to the authenticated `userId`. One user's session operations must never detach another user's microVM sessions. | Scoped `syncActiveSessions`, `clearAllAttachedSessions(userId)`, and `detachSession(sessionId, userId)` strictly by `userId`. Verified multi-tenant session isolation. |
| **D-14** | CLI Authentication | [`cli-auth.service.ts:1670`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/modules/auth/cli-auth.service.ts#L1670)<br>`startClaudeCliLogin` | **Direct Host Process Execution & Global Singleton Race in Claude Auth** | **MEDIUM** | Spawns `claude auth login` on the backend host machine (`os.homedir()`), violating the cloud sandbox execution rule. Additionally, `this.activeClaudeLogin` is an un-isolated singleton—a second user initiating login aborts the first user's process. | Claude authentication must run inside isolated microVMs or maintain isolated per-user state without host CLI reliance. | Map active logins by `userId` and migrate Claude CLI checks into user microVMs. |
| **D-16** | Rate Limiting & Auth | [`sandbox.routes.ts`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/modules/sandbox/sandbox.routes.ts), [`auth.routes.ts`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/modules/auth/auth.routes.ts), [`session.routes.ts`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/modules/session/session.routes.ts) | **Missing Rate Limiting & Unauthenticated Query Bypasses on Endpoints** | **RESOLVED**<br>*(Implemented)* | `rateLimitService.consume` was only hooked into the SSE prompt streaming route. High-cost microVM provisioning (`POST /api/v1/sandbox/create`), auth endpoints, and session endpoints lacked calibrated rate limits, and unauthenticated callers could spoof `?userId=victim`. | Enforce strict JWT verification on all authenticated endpoints (removing query/body bypasses) and apply calibrated, multi-tenant rate limiters across all 36 Fastify routes. | Implemented `requireAuth`/`optionalAuth` middleware and tiered rate limiters (`sandboxProvisionLimiter`: 5 req/min, `agentPromptLimiter`: 20 req/min, `authSensitiveLimiter`: 20 req/min, `mutationLimiter`: 60 req/min, `readApiLimiter`: 120 req/min, `publicLimiter`: 120 req/min) across all routes with standard `X-RateLimit-*` and `Retry-After` headers. |
| **D-17** | Telemetry & Diagnostics | [`logger.util.ts:80`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/utils/logger.util.ts#L80)<br>`writeToFile` & hooks | **Multi-Tenant Diagnostic Log Interleaving in `app_debug.log`** | **RESOLVED**<br>*(Implemented)* | Diagnostic file logging writes to a single shared file `test_suite/app_debug.log`. When multiple users or browser tabs are active concurrently, logs interleave without tenant tags or filters. | Logger should tag entries with `[User: usr_xxx]` and request IDs to allow tenant filtering. | Implemented structured tenant prefixes `[User: usr_xxx]`, `[Sess: sess_xxx]`, `[Req: req-xxx]`. Completely omits `[User: ...]` on unauthenticated calls (never writes `anonymous`), and injects `request.id` and `request.userId` across all Fastify lifecycle hooks (`onRequest`, `onResponse`, `setErrorHandler`). |

---

## 🔍 Detailed Domain-by-Domain Analysis

### 1. Agent Streaming & Execution Pipeline

#### [D-01] Missing SSE Client Disconnect Handler
* **Component**: `AgentController.executePromptStream` & `AgentService.stopAgentStream`
* **File**: [`backend/src/modules/agent/agent.controller.ts:L150-L185`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/modules/agent/agent.controller.ts#L150-L185)
* **Root Cause**:
  Fastify's `reply.raw` provides standard Node `http.ServerResponse`. When a client terminates an SSE connection (e.g. user clicks Stop in UI or closes browser tab), the underlying TCP socket fires `'close'` or `'aborted'`. The controller checks `if (reply.raw.destroyed) return;` inside callbacks, but **does not listen** for socket close to notify `agentService`:
  ```typescript
  // MISSING:
  req.raw.on('close', () => {
    logger.info('Client closed SSE connection, aborting execution');
    agentService.stopAgentStream(executionId);
  });
  ```
* **Impact**: Background E2B microVM keeps executing the CLI, consuming user API quota and cloud CPU cycles even though the user cancelled the generation.

#### [D-03] Auto-Defaulting Fallback on Model Selection
* **Component**: `AgentService.callLiveAI` & `App.tsx`
* **File**: [`backend/src/modules/agent/agent.service.ts:L601-L612`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/modules/agent/agent.service.ts#L601-L612)
* **Root Cause**:
  If a user has **only** linked Antigravity (Google), but their session or default state selected a model from OpenAI Codex (e.g. `gpt-4o` or `codex-reasoning`), `callLiveAI` assigns `targetCli = 'codex'`. Because Codex is not linked, it fails and triggers the "Link AI Subscriptions" modal.
* **Impact**: Unnecessary user friction when typing a prompt after logging in with only one AI platform linked.

---

### 2. Multi-Tenant Live Quota Discovery & Telemetry

#### [D-04] Hardcoded Fallback Version in Codex Quota Service
* **Component**: `CodexQuotaService.queryCodexVersion`
* **File**: [`backend/src/modules/quota/codex-quota.service.ts:L102`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/modules/quota/codex-quota.service.ts#L102)
* **Root Cause**:
  ```typescript
  return '0.163.0'; // Hardcoded fallback if sandbox command fails
  ```
  `AntigravityQuotaService` does not have any hardcoded fallback version. Returning a fake version string violates the project rule: *"DO NOT EVER hardcode quota values, rate limits, or user quota responses"*.

---

### 3. Cloud Sandbox & MicroVM Isolation

#### [D-06] Dual-User Permission Boundary Mismatch in E2B
* **Component**: `E2BSandboxProvider.readFile` vs `executeCliInSandbox`
* **File**: [`backend/src/modules/sandbox/e2b-sandbox.provider.ts`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/modules/sandbox/e2b-sandbox.provider.ts)
* **Root Cause**:
  All AI agent commands run under the isolated Linux user `agent-runner` (`sudo -u agent-runner ...`) to prevent prompts from reading sensitive environment tokens. However, the E2B filesystem API (`sandbox.files.read`) runs as the container default user `user`. If `agent-runner` creates a directory or file with standard `0700`/`0600` permissions, the Cloud Inspector and file reader cannot inspect the generated code.

#### [D-07] Unlink Credential Scrubbing in Running MicroVMs
* **Component**: `CliAuthService.unlinkCli`
* **File**: [`backend/src/modules/auth/cli-auth.service.ts:L420`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/modules/auth/cli-auth.service.ts#L420)
* **Root Cause**:
  When unlinking a platform (e.g. Codex), `CliAuthService` deletes the tokens from Firestore and local cache, but does not send a command to active running E2B microVMs to remove `/home/agent-runner/.config/codex/credentials.json`. An attacker or subsequent execution in that existing sandbox could theoretically still use the cached credential until microVM teardown.

---

### 4. Session Persistence & Merging

#### [D-09] Message Count Desync During Sliced Message Saves
* **Component**: `FirestoreBackendService.saveSession`
* **File**: [`backend/src/services/firestore.service.ts:L140`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/services/firestore.service.ts#L140)
* **Root Cause**:
  The frontend sends a capped 25-message window to protect browser memory. `FirestoreBackendService.mergeMessages` merges incoming messages with earlier messages stored in Firestore. However, if `session.messageCount` is copied from the incoming object, the sidebar shows `25 messages` instead of the true total (e.g. `84 messages`).

#### [D-10] Re-Hydration of Deleted Sessions from LocalStorage
* **Component**: `SessionSyncServiceClient.loadAndReconcileSessions`
* **File**: [`frontend/src/services/sessionSync.service.ts:L65-L135`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/frontend/src/services/sessionSync.service.ts#L65-L135)
* **Status**: **RESOLVED** *(Implemented)*
* **Root Cause & Fix**:
  Previously, `loadAndReconcileSessions` loaded all local storage sessions into its merge map first. If a session was deleted on another device or tab, it was absent from Firestore, but the client treated it as a fresh session and revived it in the UI and cloud. Fixed by implementing tombstone tracking (`getTombstones`, `addTombstone`, `removeTombstone`), treating cloud sessions as the authoritative list for existing sessions, and automatically pruning local sessions absent from Firestore (unless created in the last 60 seconds as an unsaved draft).

---

### 5. Frontend UI State & Dropdowns

#### [D-11] Reasoning Effort Leaks Across Model Switches
* **Component**: `ModelSelectorDropdown.tsx`
* **File**: [`frontend/src/components/ModelSelectorDropdown.tsx:L806`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/frontend/src/components/ModelSelectorDropdown.tsx#L806)
* **Status**: **RESOLVED** *(Verified / By-Design)*
* **Resolution**:
  Audited and verified. No separate `reasoningEffortAtom` exists in the implementation; reasoning effort is unified directly into compound model IDs (`gpt-5-high`, `o3-mini-low`). When switching to non-reasoning models like `gemini-2.5-flash`, the model ID lacks an effort suffix and no effort parameter is emitted to the CLI. Clicking a parent reasoning model row directly intentionally selects minimum effort (`low`) via `getMinimumEffortModelId`.

### 6. Cloud Sandbox Multi-Tenant Isolation

#### [D-13] Cross-Tenant Sandbox Session Detachment Cascade
* **Component**: `E2BSandboxProvider.syncActiveSessions`, `E2BSandboxProvider.clearAllAttachedSessions`, & `E2BSandboxProvider.detachSession`
* **File**: [`backend/src/modules/sandbox/e2b-sandbox.provider.ts:L342-L415`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/modules/sandbox/e2b-sandbox.provider.ts#L342-L415) & [`backend/src/modules/sandbox/sandbox.controller.ts:L240-L260`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/modules/sandbox/sandbox.controller.ts#L240-L260)
* **Status**: **RESOLVED** *(Implemented & Verified)*
* **Root Cause & Fix**:
  Previously, `syncActiveSessions` iterated over `this.sessionToSandboxId` and deleted any session not present in the caller's active session list, detaching other users' sessions. In addition, `sandboxController.deleteSandbox` when deleting the last session (`clearAllSessions=true`) executed `clearAllAttachedSessions()` which wiped all session attachments server-wide across all users. Fixed by strictly scoping `syncActiveSessions` to the caller's sandboxes (`record.userId === userId`), parameterizing `clearAllAttachedSessions(userId)` and `detachSession(sessionId, userId)`, and enforcing sandbox ownership checks. Fully tested and verified with multi-user simulation.

---

### 7. CLI Authentication & Third-Party Integration

#### [D-14] Host Process Execution & Global Singleton Race in Claude Auth
* **Component**: `CliAuthService.startClaudeCliLogin` & `CliAuthService.refreshClaudeStatus`
* **File**: [`backend/src/modules/auth/cli-auth.service.ts:L1670-L1780`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/modules/auth/cli-auth.service.ts#L1670-L1780)
* **Root Cause**:
  Directly executes `claude auth login` on the backend host machine (`os.homedir()`), violating sandbox isolation. Additionally, `this.activeClaudeLogin` is a single shared field on the service—concurrent logins by multiple users terminate each other's processes.
* **Remedy**: Move Claude CLI verification into user sandboxes and isolate in-flight auth processes in a `Map<userId, ActiveLogin>`.

---

### 8. PromptBar & Slash Commands

#### [D-15] Missing Claude CLI Slash Commands & Category Fallback
* **Component**: `resolveProviderCategory` & `SlashCommandPalette`
* **File**: [`frontend/src/utils/slashCommands.ts:L705`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/frontend/src/utils/slashCommands.ts#L705) & [`frontend/src/components/SlashCommandPalette.tsx:L31`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/frontend/src/components/SlashCommandPalette.tsx#L31)
* **Root Cause**:
  `SlashCategory` is typed as `'antigravity' | 'codex'`. When a user selects a Claude model (e.g. `claude-3-7-sonnet`), `resolveProviderCategory` defaults to `'antigravity'`. Typing `/` presents Google `agy` commands instead of Claude CLI commands (`/cost`, `/doctor`, `/compact`).
* **Remedy**: Add `'claude'` to `SlashCategory` with native Claude slash commands and badge metadata.

---

### 9. Rate Limiting & Abuse Prevention

#### [D-16] Unprotected MicroVM Provisioning, Auth Endpoints, and Unverified Session Access
* **Component**: `Fastify Middleware`, `SandboxRoutes`, `AuthRoutes`, `SessionRoutes`, `AgentRoutes`, `QuotaRoutes`
* **File**: [`backend/src/middleware/auth.middleware.ts`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/middleware/auth.middleware.ts) & [`backend/src/middleware/rate-limit.middleware.ts`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/middleware/rate-limit.middleware.ts)
* **Root Cause**:
  `rateLimitService.consume` was only applied on the SSE streaming route. The high-cost sandbox creation endpoint (`POST /api/v1/sandbox/create`), authentication routes, and session endpoints had no rate limits attached. Furthermore, `session.controller.ts` and `sandbox.controller.ts` had fallback logic (`query?.userId && query.userId !== 'default_user'`) that allowed unauthenticated callers to access user sessions or sandboxes simply by supplying someone else's `userId`.
* **Remedy**:
  1. Created [`backend/src/middleware/auth.middleware.ts`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/middleware/auth.middleware.ts) implementing `requireAuth` and `optionalAuth` with cryptographic `tokenUtil.verifyJwt` verification, binding `req.userId`, `req.userEmail`, and `req.token`.
  2. Removed all insecure query/body `userId` spoofing bypasses across `session.controller.ts`, `sandbox.controller.ts`, and `cli-auth.controller.ts`.
  3. Created [`backend/src/middleware/rate-limit.middleware.ts`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/middleware/rate-limit.middleware.ts) with multi-tenant client key resolution (`user:${req.userId}` or `ip:${ip}`) and calibrated rate limit tiers:
     - `sandboxProvisionLimiter`: 5 req/min (high-cost cloud microVM provisioning)
     - `agentPromptLimiter`: 20 req/min (AI execution and prompt streaming)
     - `authSensitiveLimiter`: 20 req/min (login, device auth, platform link codes)
     - `mutationLimiter`: 60 req/min (sessions, detachments, commands, stops)
     - `readApiLimiter`: 120 req/min (session history, files, usage, status, quotas)
     - `publicLimiter`: 120 req/min (health, config, metrics, debug)
  4. Attached pre-handler hooks across all 36 Fastify routes. Automatically injects `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers, and emits 429 `RATE_LIMIT_EXCEEDED` with `Retry-After` on exhaustion.
  5. Verified via automated test suite covering 401 unauthenticated rejections, query spoofing rejections, 429 rate limit triggers, and multi-tenant quota isolation.

---

### 10. Multi-Tenant Diagnostics

#### [D-17] Diagnostic Log Interleaving in `app_debug.log`
* **Component**: `Logger.writeToFile` & Fastify lifecycle hooks
* **File**: [`backend/src/utils/logger.util.ts:L79-L180`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/utils/logger.util.ts#L79-L180), [`backend/src/app.ts:L35-L85`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/app.ts#L35-L85)
* **Root Cause**:
  All diagnostic logging appended to a single unstructured file without explicit tenant headers or correlation IDs, causing multi-tab and multi-user events to interleave.
* **Remedy**: Structured prefixes `[<timestamp>] [<LEVEL>] [User: usr_xxx] [Sess: sess_xxx] [Req: req-xxx]` in both console and file outputs. Unauthenticated calls omit `[User: ...]` completely (no `anonymous` noise). Fastify hooks pass `request.id` and early-resolved `request.userId`. Redundant correlation IDs are stripped from trailing JSON payloads.
* **Status**: **RESOLVED** (Implemented & verified with automated tenant logging audit suite).

---

## 🎯 Proposed Roadmap for Resolution

1. **Phase 1: Critical Reliability & Security**
   - Implement `req.raw.on('close')` abort listener in `AgentController` (D-01).
   - Enforce group-read permissions (`umask 002`) in `/workspace` for E2B (D-06).
   - Actively scrub microVM credential files upon `unlinkCli` (D-07).

2. **Phase 2: Data Integrity & Persistence**
   - Correct `session.messageCount = mergedMessages.length` in Firestore backend (D-09).
   - Add tombstone tracking in `sessionSyncService` to prevent resurrection of deleted sessions (D-10).

3. **Phase 3: UX & State Hygiene**
   - Auto-reset `reasoningEffortAtom` when selecting models without effort variants (D-11).
   - Implement Smart Auto-Defaulting for linked AI platforms (D-03).
   - Deprecate/remove legacy synchronous `executePrompt` (D-02).
   - Clean up hardcoded fallback version in `CodexQuotaService` (D-04).
