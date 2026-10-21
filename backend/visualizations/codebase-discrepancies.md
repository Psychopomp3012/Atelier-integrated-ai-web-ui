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
| **D-14** | CLI Authentication | [`cli-auth.service.ts:1670`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/modules/auth/cli-auth.service.ts#L1670)<br>`startClaudeCliLogin` | **Direct Host Process Execution & Global Singleton Race in Claude Auth** | **DEFERRED**<br>*(Claude)* | Spawns `claude auth login` on the backend host machine (`os.homedir()`), violating the cloud sandbox execution rule. Additionally, `this.activeClaudeLogin` is an un-isolated singleton—a second user initiating login aborts the first user's process. | Claude authentication must run inside isolated microVMs or maintain isolated per-user state without host CLI reliance. | Map active logins by `userId` and migrate Claude CLI checks into user microVMs. |
| **D-15** | Slash Commands | [`slashCommands.ts:705`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/frontend/src/utils/slashCommands.ts#L705)<br>`resolveProviderCategory` | **Missing Claude CLI Slash Commands & Fallback Desync** | **DEFERRED**<br>*(Claude)* | `SlashCategory` is typed as `'antigravity' | 'codex'`. Selecting a Claude model defaults category to `'antigravity'`, rendering Google `agy` commands instead of Claude commands (`/cost`, `/doctor`, `/compact`). | Selecting Claude models should show native Claude slash commands and appropriate badges. | Add `'claude'` category to `SlashCategory` with native command definitions. |
| **D-16** | Rate Limiting & Auth | [`sandbox.routes.ts`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/modules/sandbox/sandbox.routes.ts), [`auth.routes.ts`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/modules/auth/auth.routes.ts), [`session.routes.ts`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/modules/session/session.routes.ts) | **Missing Rate Limiting & Unauthenticated Query Bypasses on Endpoints** | **RESOLVED**<br>*(Implemented)* | `rateLimitService.consume` was only hooked into the SSE prompt streaming route. High-cost microVM provisioning (`POST /api/v1/sandbox/create`), auth endpoints, and session endpoints lacked calibrated rate limits, and unauthenticated callers could spoof `?userId=victim`. | Enforce strict JWT verification on all authenticated endpoints (removing query/body bypasses) and apply calibrated, multi-tenant rate limiters across all 36 Fastify routes. | Implemented `requireAuth`/`optionalAuth` middleware and tiered rate limiters (`sandboxProvisionLimiter`: 5 req/min, `agentPromptLimiter`: 20 req/min, `authSensitiveLimiter`: 20 req/min, `mutationLimiter`: 60 req/min, `readApiLimiter`: 120 req/min, `publicLimiter`: 120 req/min) across all routes with standard `X-RateLimit-*` and `Retry-After` headers. |
| **D-17** | Telemetry & Diagnostics | [`logger.util.ts:80`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/utils/logger.util.ts#L80)<br>`writeToFile` & hooks | **Multi-Tenant Diagnostic Log Interleaving in `app_debug.log`** | **RESOLVED**<br>*(Implemented)* | Diagnostic file logging writes to a single shared file `test_suite/app_debug.log`. When multiple users or browser tabs are active concurrently, logs interleave without tenant tags or filters. | Logger should tag entries with `[User: usr_xxx]` and request IDs to allow tenant filtering. | Implemented structured tenant prefixes `[User: usr_xxx]`, `[Sess: sess_xxx]`, `[Req: req-xxx]`. Completely omits `[User: ...]` on unauthenticated calls (never writes `anonymous`), and injects `request.id` and `request.userId` across all Fastify lifecycle hooks (`onRequest`, `onResponse`, `setErrorHandler`). |
| **D-18** | Service Monitoring | [`app.ts`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/app.ts) | **Missing Core Service Health & Readiness Endpoints (`GET /healthz` & `GET /api/v1/health`)** | **WONTFIX**<br>*(By-Design)* | Dedicated `/healthz` endpoints were previously removed. Verified that server health is already deterministically confirmed via lightweight public routes like `GET /api/v1/auth/config`. Extra health routes declined by user to keep route registry minimal. | Existing functional routes confirm server readiness; no redundant health routes needed. | Mark as By-Design / WONTFIX. Ensure test harness avoids pinging dead health routes. |
| **D-19** | Test Harness | [`run_api_tests.ts`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/test_suite/run_api_tests.ts) | **Regression Suite Desync with 4-Phase Defense Pipeline & Stable User IDs** | **RESOLVED**<br>*(Implemented)* | Test suite previously asserted against dead `/healthz` routes, outdated `/agent/prompt`, and unauthenticated `/sandbox/*` routes. | Automated regression test suite strictly tests the active 4-phase defense pipeline, stable deterministic user IDs (`getStableUserId`), SSE streaming routes, and in-memory rate limiting. | Cleaned up all dead routes from `run_api_tests.ts`, aligned auth assertions to 401, calibrated burst testing to in-memory tier. 100% (43/43) tests passing. |
| **D-20** | Model Discovery UX | [`ModelSelectorDropdown.tsx`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/frontend/src/components/ModelSelectorDropdown.tsx) | **Empty Model Discovery UX When No CLIs or Sandboxes Linked** | **WONTFIX**<br>*(By-Design)* | When a newly registered user logs in with zero linked AI CLIs and no active sandbox, `getAvailableModels` returns `[]`. All providers are locked. | Confirmed as by-design: models are only discovered from active microVMs with linked provider credentials; empty model array with locked providers correctly conveys unlinked status. | Mark as By-Design / WONTFIX. |
| **D-21** | Cloud Sandbox Isolation | [`e2b-sandbox.provider.ts:132`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/modules/sandbox/e2b-sandbox.provider.ts#L132)<br>`syncWithCloud` & `createSandbox` | **Multi-Tenant Sandbox Ownership Leak in `syncWithCloud`** | **RESOLVED**<br>*(Implemented)* | `Sandbox.list({ apiKey })` lists all microVMs account-wide. Untagged sandboxes belonging to other tenants were adopted by the first user to call `syncWithCloud`, and paused sandboxes were mistakenly deleted from Firestore. | Cloud sandboxes must be tagged with `metadata: { userId }` at creation; `syncWithCloud` must only query and adopt sandboxes belonging to caller `userId`, and must protect paused sandboxes. | Added `metadata: { userId }` to `Sandbox.create`, filtered `Sandbox.list` by `metadata: { userId }` and `state: ['running', 'paused']`, and scoped local pruning strictly to `rec.userId === userId`. |
| **D-22** | Agent Execution | [`agent.service.ts:511`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/modules/agent/agent.service.ts#L511)<br>`fetchDynamicModelsFromCli` | **Missing Dynamic Claude Model Discovery in Sandbox MicroVMs** | **DEFERRED**<br>*(Claude)* | `fetchDynamicModelsFromCli` only invokes `discoverAntigravityModels` and `discoverCodexModels`. Claude models are never discovered dynamically even when Claude CLI is linked in the sandbox microVM. | Claude models should be dynamically discovered and mapped to the active model picker when Claude CLI is linked. | Implement `discoverClaudeModels` in `AgentService` and incorporate into `Promise.allSettled` discovery pipeline. |
| **D-23** | CLI Authentication | [`cli-auth.service.ts:1133`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/modules/auth/cli-auth.service.ts#L1133)<br>`startAntigravityCliLogin` | **Global Singleton Process Race in Antigravity Login Flows** | **RESOLVED**<br>*(Implemented & Verified)* | `activeAntigravityLogin` was a global singleton field on `CliAuthService`. If a second user initiated linking, the first user's spawned login process was terminated with `SIGTERM` or received identical PKCE challenges. | Login processes must be isolated concurrently in a `Map<userId, ActiveLogin>` matching the multi-tenant architecture of Codex auth. | Migrated `activeAntigravityLogins` to per-user `Map<string, ActiveLogin>`, parameterized `startAntigravityCliLogin(userId, force)` and controller routes with `preValidation: [optionalAuth]`, verified with concurrent multi-tenant test. |
| **D-24** | Cloud Sandbox Security | [`e2b-sandbox.provider.ts:823`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/modules/sandbox/e2b-sandbox.provider.ts#L823)<br>`syncCredentialsToSandbox` | **Host Developer Credential Seeding Fallback in Sandbox MicroVMs** | **RESOLVED**<br>*(Implemented & Verified)* | When seeding microVM credentials for an unlinked user, previously fell back to `homedir/.claude/.credentials.json` and `homedir/.codex/auth.json`, leaking host developer credentials to untrusted tenants. | MicroVMs should strictly receive credentials owned by the authenticated caller; unlinked providers must remain unseeded and purged. | Removed host developer `homedir` fallbacks for Claude and Codex in `syncCredentialsToSandbox`. MicroVMs only sync from strictly isolated `.agent-user-profiles/${safeUid}` and purge unlinked paths. Verified via automated multi-tenant test. |
| **D-25** | Authentication & Security | [`token.util.ts:80`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/utils/token.util.ts#L80)<br>`verifyJwt` | **Insecure Prototype Legacy Token Bypass in `tokenUtil.verifyJwt`** | **RESOLVED**<br>*(Implemented & Verified)* | `verifyJwt` previously accepted any string starting with `harness_sess_` longer than 20 characters as `valid: true` without cryptographic HMAC verification. | All incoming tokens must strictly pass HMAC-SHA256 signature verification and expiration checks. | Removed legacy prototype bypass in `tokenUtil.verifyJwt`. Enforced strict 3-part HMAC-SHA256 signature and expiration verification for all tokens. Verified via automated security and live API tests. |
| **D-26** | Model Discovery UX | [`models.service.ts:51`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/frontend/src/services/models.service.ts#L51)<br>`fetchAvailableModels` | **Stale Models Cache Retention When Backend Returns Empty Array** | **RESOLVED**<br>*(Implemented & Verified)* | `lastModels` was previously only updated when `json.data.length > 0`. If the backend returned `[]` (e.g. sandboxes stopped or CLIs unlinked), `lastModels` was retained, presenting phantom models in UI. | Frontend model cache should accurately reflect empty array responses from the backend and isolate cache per tenant userId. | Updated `lastModels` whenever `Array.isArray(json.data)`, tracked `lastModelsUserId` for instant tenant cache invalidation, and verified via automated test suite. |
| **D-27** | Frontend State Isolation | [`App.tsx:315`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/frontend/src/App.tsx#L315) & [`sandbox.atoms.ts:27`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/frontend/src/state/sandbox.atoms.ts#L27) | **Unscoped `harness_selected_sandbox_id` in Browser LocalStorage** | **RESOLVED**<br>*(Implemented & Verified)* | `harness_selected_sandbox_id` was previously stored as an un-scoped global key in LocalStorage. When multiple users shared a browser, User B inherited User A's selected sandbox ID. | LocalStorage sandbox selection should be scoped per tenant (`harness_selected_sandbox_id_${userId}`) matching all other multi-tenant persistence keys. | Scoped LocalStorage key by `userId` (`harness_selected_sandbox_id_${userId}`) in `sandbox.atoms.ts` and `App.tsx`, and added user change listener. Verified in live browser. |
| **D-28** | Markdown Rendering | [`MarkdownContent.tsx:175`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/frontend/src/components/MarkdownContent.tsx#L175)<br>`renderInline` | **Markdown Hyperlink & Image Parsing Missing in `MarkdownContent`** | **RESOLVED**<br>*(Implemented & Verified)* | `MarkdownContent` previously parsed bold, code, and italic, but did not match `[text](url)` links or `![alt](url)` images, displaying raw unclickable text. | Markdown links should render as clickable `<a>` anchors styled with `text-primary underline` and `target="_blank"`. | Added regex parser and element builders for hyperlinks `[text](url)` and images `![alt](url)` in `renderInline`. Verified in browser evaluation. |
| **D-29** | Workspace File UX | [`MarkdownContent.tsx:237`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/frontend/src/components/MarkdownContent.tsx#L237)<br>`renderInline` | **Markdown File Links Navigating Browser Window to Broken SPA Route** | **RESOLVED**<br>*(Implemented & Verified)* | Clicking markdown workspace file links (e.g. `[abc.txt](/home/user/workspace/abc.txt)`) navigated the browser to `http://localhost:5173/home/user/workspace/abc.txt`, reloading the SPA with a broken URL route instead of presenting a clean file reference. | Distinguish external URLs from internal sandbox file paths. External links open in a new tab; workspace file references render as styled non-clickable badges with file icon and no underlines, preventing browser navigation. | Added workspace link discrimination in `MarkdownContent`, rendered internal workspace paths as styled non-clickable badges (`span`) without text/icon underlines, and added automatic route clean-up in `App.tsx`. Verified in live browser. |
| **D-30** | Session Persistence | [`agent.service.ts:1347`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/modules/agent/agent.service.ts#L1347), [`firestore.service.ts:190`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/services/firestore.service.ts#L190), [`Accordion.tsx:42`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/frontend/src/components/Accordion.tsx#L42) | **Historic Session Message Schema Mismatch (`modelBadge`, `latency`, `0/2 STEPS READY`)** | **RESOLVED**<br>*(Implemented & Verified)* | Live SSE streaming mapped `serverMsg` to client-side `ChatMessage`, but backend saved raw `AgentMessage` to Firestore. When reloaded, `modelBadge`, `latency`, and `step.completed` were missing, causing assistant to fall back to 'Atelier Assistant' and steps to show 0/N READY. | Normalize messages bi-directionally across backend Firestore persistence, frontend session hydration, and Accordion step completion checks. | Implemented `normalizeMessage` in `firestore.service.ts` and `sessionSync.service.ts`, populated UI fields on backend save, and added `isStepCompleted` in `Accordion.tsx` and fallback badge logic in `App.tsx`. |

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

### 11. Infrastructure & Service Health

#### [D-18] Service Readiness & Health Probes
* **Component**: `FastifyServer` / Route Registration
* **File**: [`backend/src/app.ts`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/app.ts)
* **Status**: **WONTFIX** *(By-Design)*
* **Resolution**:
  Dedicated health endpoints were deliberately removed in v0.1.0 to keep the route registry clean and minimal. Backend uptime and readiness are verified in production via existing lightweight public routes (e.g. `GET /api/v1/auth/config`). Adding redundant endpoints was confirmed by the user as unnecessary overhead.

---

### 12. Test Harness Synchronization

#### [D-19] Regression Suite Desync with 4-Phase Defense Pipeline & Stable User IDs
* **Component**: `test_suite/run_api_tests.ts`
* **File**: [`test_suite/run_api_tests.ts`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/test_suite/run_api_tests.ts)
* **Status**: **RESOLVED** *(Implemented & Verified)*
* **Root Cause & Fix**:
  The automated test suite previously asserted against dead endpoints (`GET /healthz`, `GET /api/v1/health`, `GET /api/v1/sandbox/metrics`, `POST /api/v1/agent/prompt`), unauthenticated `/sandbox/*` calls (which now strictly return 401 per Phase 1 `preValidation: [requireAuth]`), and non-canonical user IDs. 
  Fixed by:
  1. Removing dead route tests.
  2. Deriving test user IDs via `getStableUserId(testEmail)`.
  3. Testing SSE stream route `POST /api/v1/agent/prompt/stream` with strict 400 schema validation.
  4. Routing burst rate-limiting tests against fast in-memory endpoints (`POST /api/v1/auth/device/initiate`) rather than remote E2B microVM calls.
  All 43 of 43 regression tests now pass with 100% success.

---

### 13. Dynamic Model Discovery UX

#### [D-20] Dynamic Model Discovery UX When No CLIs or Sandboxes Linked
* **Component**: `ModelSelectorDropdown.tsx`
* **File**: [`frontend/src/components/ModelSelectorDropdown.tsx`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/frontend/src/components/ModelSelectorDropdown.tsx)
* **Status**: **WONTFIX** *(By-Design)*
* **Resolution**:
  Confirmed as intentional by design: models are never hardcoded and must be discovered from running microVMs with linked provider credentials. When a user has zero linked accounts, all providers are correctly displayed in a locked state and available models are empty.

---

### 14. Cloud Sandbox Multi-Tenant Isolation

#### [D-21] Multi-Tenant Sandbox Ownership Leak & Paused MicroVM Pruning in `syncWithCloud`
* **Component**: `E2BSandboxProvider.syncWithCloud` & `E2BSandboxProvider.createSandbox`
* **File**: [`backend/src/modules/sandbox/e2b-sandbox.provider.ts:L132-L185`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/modules/sandbox/e2b-sandbox.provider.ts#L132-L185) & [`L586`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/modules/sandbox/e2b-sandbox.provider.ts#L586)
* **Status**: **RESOLVED** *(Implemented & Verified)*
* **Root Cause & Fix**:
  `Sandbox.list({ apiKey })` queries all sandboxes running under the shared E2B Cloud account across all platform tenants. Because `Sandbox.create` previously omitted `metadata: { userId }`, microVMs in the cloud lacked ownership tags. When `syncWithCloud(userId)` ran after a server restart or cache miss, untagged cloud sandboxes created by other users were assigned to the caller (`userId: userId`) and saved into the caller's Firestore records. Furthermore, because E2B's default list query only returned actively running sandboxes, paused microVMs (15-min idle) were falsely treated as deleted from the cloud and wiped from Firestore.
  Fixed by:
  1. Passing `metadata: { userId }` in `Sandbox.create` to tag remote microVMs at birth.
  2. Querying `Sandbox.list` with `query: { metadata: { userId }, state: ['running', 'paused'] }` to fetch both running and paused microVMs strictly owned by the caller.
  3. Adding defensive client-side filtering (`item.metadata?.userId === userId`).
  4. Scoping local sandbox pruning strictly to `rec.userId === userId`, completely isolating cross-tenant caches.
  Verified with `npm run build` and automated test suite.

---

### 15. Dynamic Model Discovery & Agent Architecture

#### [D-22] Missing Dynamic Claude Model Discovery in Sandbox MicroVMs
* **Component**: `AgentService.fetchDynamicModelsFromCli`
* **File**: [`backend/src/modules/agent/agent.service.ts:L511-L527`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/modules/agent/agent.service.ts#L511-L527)
* **Severity**: **MEDIUM**
* **Root Cause**:
  `fetchDynamicModelsFromCli` uses `Promise.allSettled` to query available models from installed CLIs:
  ```typescript
  const [agyRes, codexRes] = await Promise.allSettled([
    this.discoverAntigravityModels(sandboxId, userId, sessionId),
    this.discoverCodexModels(sandboxId, userId, sessionId),
  ]);
  ```
  It completely lacks a `discoverClaudeModels` branch. Even when Claude CLI is linked and authenticated in the sandbox microVM (`/home/agent-runner/.claude/.credentials.json`), dynamic models for Claude (`claude-3-7-sonnet`, `claude-3-5-haiku`, etc.) are never discovered.
* **Remedy**:
  Implement `discoverClaudeModels(sandboxId, userId, sessionId)` in `AgentService` to query Claude models via CLI or read microVM configuration, map to standard `DynamicModelOption` interfaces, and include in the `Promise.allSettled` discovery array.

---

### 16. Multi-Tenant CLI Authentication Concurrency

#### [D-23] Global Singleton Process Race in Antigravity Login Flows
* **Component**: `CliAuthService.startAntigravityCliLogin` & `CliAuthService.submitAntigravityCliCode`
* **File**: [`backend/src/modules/auth/cli-auth.service.ts:L58`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/modules/auth/cli-auth.service.ts#L58), [`L1133-L1155`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/modules/auth/cli-auth.service.ts#L1133-L1155), [`L1280-L1385`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/modules/auth/cli-auth.service.ts#L1280-L1385)
* **Status**: **RESOLVED** *(Implemented & Verified)*
* **Root Cause & Fix**:
  In `CliAuthService`, `activeAntigravityLogin` was defined as a single instance field (`private activeAntigravityLogin: ActiveLogin | null = null;`). When User B requested an Antigravity login URL while User A had an in-flight login, User B was returned User A's exact PKCE authorization URL and `code_challenge`. Furthermore, starting a new session executed `proc.kill('SIGTERM')`, causing code submissions to fail with `SESSION_EXPIRED`.
  Fixed by:
  1. Migrating `activeAntigravityLogins` to a multi-tenant `Map<string, ActiveAntigravityLogin>` keyed by `userId` (or `sessionKey`).
  2. Updating `startAntigravityCliLogin(userId, force)` to spawn and hold distinct PTY processes with independent OAuth state and PKCE challenges per tenant.
  3. Updating `submitAntigravityCliCode(code, userId, email)` to look up the caller's specific process in `activeAntigravityLogins` and strictly check user-scoped credentials via `isAntigravityLinked(userId)`.
  4. Adding `preValidation: [optionalAuth]` across Fastify Antigravity routes and passing verified `req.userId` in `cli-auth.controller.ts`.
  5. Verified with automated concurrent multi-tenant test verifying completely distinct PKCE challenges and isolated process lifecycles.

---

### 17. Cloud Sandbox Credential Security

#### [D-24] Host Developer Credential Seeding Fallback in Sandbox MicroVMs
* **Component**: `E2BSandboxProvider.syncCredentialsToSandbox`
* **File**: [`backend/src/modules/sandbox/e2b-sandbox.provider.ts:L823-L840`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/modules/sandbox/e2b-sandbox.provider.ts#L823-L840)
* **Severity**: **HIGH**
* **Root Cause**:
  In `syncCredentialsToSandbox(sandbox, userId)`, when seeding credentials for an unlinked user, the code checks:
  ```typescript
  const claudeCredsPath = path.join(userProfileDir, '.claude', '.credentials.json');
  const hostClaudeCreds = fs.existsSync(claudeCredsPath)
    ? claudeCredsPath
    : path.join(homedir, '.claude', '.credentials.json');
  ```
  and:
  ```typescript
  const candidateCodexPaths = [
    safeUid ? path.join(homedir, '.agent-user-profiles', safeUid, '.codex', 'auth.json') : '',
    path.join(userProfileDir, '.codex', 'auth.json'),
    path.join(homedir, '.codex', 'auth.json'),
  ];
  ```
  If the host server running the backend has developer credentials in `~/.claude/.credentials.json` or `~/.codex/auth.json`, these host credentials are automatically uploaded into the remote E2B sandbox microVM created for that tenant. This leaks the host developer's private AI subscriptions and quotas to arbitrary platform tenants.
* **Remedy**:
  Completely remove the host machine `homedir` fallbacks for Claude and Codex. Sandbox microVMs must strictly and exclusively receive credentials belonging to the authenticated tenant. Unlinked providers must remain unseeded and purged.

---

### 18. Authentication & Signature Verification

#### [D-25] Insecure Prototype Legacy Token Bypass in `tokenUtil.verifyJwt`
* **Component**: `tokenUtil.verifyJwt`
* **File**: [`backend/src/utils/token.util.ts:L80-L90`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/src/utils/token.util.ts#L80-L90)
* **Severity**: **HIGH**
* **Root Cause**:
  `tokenUtil.verifyJwt` contains a legacy prototype bypass:
  ```typescript
  if (token.startsWith('harness_sess_') && token.length > 20) {
    return {
      valid: true,
      payload: {
        sub: 'legacy_user',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 7 * 86400,
      },
    };
  }
  ```
  Any caller supplying `Authorization: Bearer harness_sess_12345678901234567890` completely bypasses cryptographic HMAC-SHA256 signature verification and is granted authenticated access as `sub: 'legacy_user'`. This creates an authentication backdoor in production.
* **Remedy**:
  Remove the legacy prototype bypass from `tokenUtil.verifyJwt`. Require all tokens to be valid signed HMAC-SHA256 JWTs or fail verification.

---

### 19. Client-Side Model State Synchronization

#### [D-26] Stale Models Cache Retention When Backend Returns Empty Array
* **Component**: `models.service.ts.fetchAvailableModels`
* **File**: [`frontend/src/services/models.service.ts:L51-L56`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/frontend/src/services/models.service.ts#L51-L56)
* **Severity**: **MEDIUM**
* **Root Cause**:
  In `models.service.ts`:
  ```typescript
  if (Array.isArray(json.data) && json.data.length > 0) {
    lastModels = json.data as ModelOption[];
    lastModelsFetchTime = Date.now();
    return lastModels;
  }
  return lastModels || [];
  ```
  `lastModels` is only updated when `json.data.length > 0`. If the backend returns `[]` (e.g. all sandboxes paused or providers unlinked), `lastModels` retains stale models from earlier responses, presenting phantom models in the UI that no longer exist or are no longer accessible.
* **Remedy**:
  Update `lastModels = json.data` whenever `Array.isArray(json.data)`, ensuring that empty array responses from the backend correctly clear stale cached models.

---

### 20. Multi-Tenant Client State Isolation

#### [D-27] Unscoped `harness_selected_sandbox_id` in Browser LocalStorage
* **Component**: `App.tsx` & `sandbox.atoms.ts`
* **File**: [`frontend/src/App.tsx:L315`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/frontend/src/App.tsx#L315), [`frontend/src/state/sandbox.atoms.ts:L27`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/frontend/src/state/sandbox.atoms.ts#L27)
* **Severity**: **LOW**
* **Root Cause**:
  The selected sandbox ID is saved to LocalStorage under the global key `'harness_selected_sandbox_id'`. In contrast to sessions (`harness_sessions_${userId}`), if User A logs out and User B logs in on the same browser, User B inherits User A's `harness_selected_sandbox_id`. When User B attempts to attach or execute commands, the backend correctly rejects the call with ownership errors, causing a confusing initial error banner.
* **Remedy**:
  Scope the local storage key by current user ID (`harness_selected_sandbox_id_${currentUser.id}`) or clear `selectedSandboxIdAtom` upon user logout / auth switch.

---

### 21. Content Presentation & Rich Text Rendering

#### [D-28] Markdown Hyperlink & Image Parsing Missing in `MarkdownContent`
* **Component**: `MarkdownContent.renderInline`
* **File**: [`frontend/src/components/MarkdownContent.tsx:L175-L235`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/frontend/src/components/MarkdownContent.tsx#L175-L235)
* **Severity**: **LOW**
* **Root Cause**:
  `renderInline` in `MarkdownContent.tsx` uses regular expressions to parse bold (`**bold**`), italics (`*italic*`), and inline code (`` `code` ``), but completely lacks parsing for standard Markdown hyperlinks (`[label](url)`) and images (`![alt](url)`). URLs formatted as Markdown links are rendered as raw literal strings (e.g. `[Documentation](https://...)`), preventing users from clicking links generated by AI agents or referencing project documentation.
* **Remedy**:
  Add regex matching for Markdown links (`/\[([^\]]+)\]\(([^)]+)\)/g`) in `renderInline`, rendering them as styled HTML `<a>` tags with `target="_blank"` and `rel="noopener noreferrer"`.

---

## 🎯 Proposed Roadmap for Resolution

1. **Phase 1: High-Severity Security & Multi-Tenant Isolation (Immediate)**
   - **D-23**: *(Resolved)* Refactored `activeAntigravityLogins` to per-user `Map` collections in `CliAuthService` (`backend/src/modules/auth/cli-auth.service.ts`).
   - **D-24**: *(Resolved)* Removed host machine `homedir` fallback credential leakage in `E2BSandboxProvider` (`backend/src/modules/sandbox/e2b-sandbox.provider.ts`).
   - **D-25**: *(Resolved)* Removed prototype bypass `harness_sess_` in `tokenUtil.verifyJwt` (`backend/src/utils/token.util.ts`).

2. **Phase 2: Dynamic Discovery & Multi-Provider Parity**
   - **D-22**: Implement `discoverClaudeModels` in `AgentService` (`backend/src/modules/agent/agent.service.ts`).
   - **D-26**: *(Resolved)* Fixed stale models cache retention and scoped cache by userId in `models.service.ts` (`frontend/src/services/models.service.ts`).
   - **D-15**: Add `'claude'` category to `SlashCategory` in `slashCommands.ts` (`frontend/src/utils/slashCommands.ts`).

3. **Phase 3: Client State Hygiene & UX Polish**
   - **D-27**: *(Resolved)* Scoped `harness_selected_sandbox_id` per user in LocalStorage (`App.tsx`, `sandbox.atoms.ts`).
   - **D-28**: *(Resolved)* Added Markdown link and image parsing in `MarkdownContent.tsx` (`frontend/src/components/MarkdownContent.tsx`).
