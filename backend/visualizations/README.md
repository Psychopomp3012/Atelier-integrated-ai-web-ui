# System Architecture & User Flow Visualizations

This directory contains modern, dark-themed vector diagrams generated via Mermaid (`mmdc`) documenting the system architecture and end-to-end user lifecycle of the Integrated Web UI platform.

---

## 🚀 How to View the Diagrams

You can view these diagrams in three convenient ways:

1. **Interactive In-Browser Viewer (Recommended):**
   Open the included interactive dashboard in Google Chrome or your default browser:
   ```bash
   google-chrome backend/visualizations/index.html
   # or
   xdg-open backend/visualizations/index.html
   ```
   This gives you tabbed navigation between diagrams, high-definition zoom/pan, and one-click SVG/PNG export buttons.

2. **In Antigravity IDE / VS Code:**
   - Open this file ([`visualizations/README.md`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/visualizations/README.md)) and press **`Ctrl+Shift+V`** (or click the **Markdown Preview** button in the top-right corner of the editor tab).
   - Or click directly on the image files in the sidebar file tree:
     - [`architecture-diagram.svg`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/visualizations/architecture-diagram.svg) / [`architecture-diagram.png`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/visualizations/architecture-diagram.png)
     - [`user-flow-diagram.svg`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/visualizations/user-flow-diagram.svg) / [`user-flow-diagram.png`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/visualizations/user-flow-diagram.png)
     - [`codex-auth-flow.svg`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/visualizations/codex-auth-flow.svg) / [`codex-auth-flow.png`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/visualizations/codex-auth-flow.png)

3. **From the Terminal / Native Image Viewer:**
   ```bash
   xdg-open visualizations/architecture-diagram.png
   xdg-open visualizations/user-flow-diagram.png
   xdg-open visualizations/codex-auth-flow.png
   ```

---

## 1. System Architecture Diagram (`architecture-beta`)

Built strictly with Mermaid's native **`architecture-beta`** syntax matching the cloud-only execution model:
- **`group client(cloud)`**: React 19 Frontend UI (with custom modals & Tailwind v3 design tokens) & Cloud Inspector telemetry client hosted on **Vercel**.
- **`group backend(server)`**: Fastify API core & SSE streaming, 7-day JWT auth guard, **Context Compactor** (stitching past conversation turns into one-shot CLI prompts), and **Google Cloud Firestore** (persisting user profiles, active 7-day sessions, linked CLI credentials, conversation messages, and sandbox allocations with zero host disk usage) hosted on **Heroku**.
- **`group sandbox(cloud)`**: Dedicated E2B MicroVM Sandbox Pool (up to 3 microVMs per user) housing the isolated AI CLIs (**Google Antigravity (`agy`)**, **OpenAI Codex (`codex`)**, and **Anthropic Claude (`claude`)**) under DAC `agent-runner` security boundary with zero peer-to-peer coupling.
- **Fastify Core to Sandbox Connection**: A single unified dispatch line from `Fastify API Core` into the E2B Sandbox entry point, which branches to the respective CLI environment.
- **Directional Port Pinning**: Precision rectilinear grid edges using Mermaid port connectors (`:T`, `:B`, `:L`, `:R`) with pure white paths (`#ffffff`) and zero line crossing.

![System Architecture Diagram](architecture-diagram.png)

---

## 2. End-to-End User Flow Diagram (`flowchart TD`)

Built with Mermaid's **`flowchart TD`** visual decision engine featuring native FontAwesome iconography and condition branches:
- **Session & Identity**: OS theme auto-detection (`fa:fa-adjust`) and 7-day JWT auth check (`fa:fa-key`) with Google OAuth fallback.
- **Subscription Linking Flow**: Zero-key account linking via provider OAuth (`fa:fa-shield`, `fa:fa-user-check`), unlocking AI providers in the model menu.
- **Sandbox-Coupled Model Discovery**:
  - **No VM Running**: Prompts user that a Sandbox VM is required (`fa:fa-rocket`) with one-click creation.
  - **VM Active but Detached**: Prompts user to select and attach an existing sandbox microVM (`fa:fa-link-slash`) to the current chat session.
  - **VM Attached**: Automatically executes live CLI discovery inside the microVM (`agy models`, `codex debug models`, and live quota queries) strictly adhering to the zero-hardcode and zero-Firestore volatile limit rules.
  - **Dynamic Model Selection**: Renders discovered models with supported reasoning effort levels (`fa:fa-sliders`) and live quota gauges (5h rolling & weekly window for Antigravity, rolling limit for Codex).
- **Multi-Sandbox Pooling & Sharing**: Sandbox decision branch (`fa:fa-cubes`):
  - **Manage / Delete**: Custom Red Delete Modal (`fa:fa-trash-alt`) prompting quota slot release and workspace cleanup in Firestore (`fa:fa-minus-circle`).
  - **Attach Existing**: Multiplexes and shares active microVM workspace across multiple chats (`fa:fa-link`).
  - **Create New**: Firecracker microVM launch (`fa:fa-cloud`), 1GB swap allocation (`fa:fa-microchip`), DAC isolation boundary (`fa:fa-lock`), and pre-warmed credentials.
- **One-Shot Execution & Compaction**:
  - Fetches message history from Cloud Firestore (`fa:fa-database`).
  - Context Compactor stitches previous turns into structured one-shot prompt payload (`fa:fa-compress-arrows-alt`).
  - Dynamic live credential injection if linked post-boot (`fa:fa-bolt`) or pre-flight verification (`fa:fa-check-circle`).
- **Execution & Observability**: Native one-shot CLI execution inside MicroVM (`fa:fa-terminal`), exit code validation (`fa:fa-question-circle`), saving response turns to Firestore (`fa:fa-save`), real-time SSE token stream (`fa:fa-stream`), and live Cloud Inspector file & telemetry viewing (`fa:fa-desktop`).

![User Flow Diagram](user-flow-diagram.png)

---

## 3. Codex Multi-Tenant Device Auth Flow (`flowchart TD`)

Built with Mermaid's **`flowchart TD`** documenting the zero-race-condition headless device auth handshake:
- **Client Browser & Auth Popup**:
  - User initiates "Link Codex" (`fa:fa-user`).
  - Browser opens popup `/api/v1/auth/cli/codex/login` with 7-day JWT token (`fa:fa-window-maximize`, `fa:fa-id-card`).
  - Dark-mode helper page auto-displays one-time user code (`fa:fa-copy`) and auto-opens OpenAI device page (`fa:fa-external-link-alt`).
  - User pastes code into OpenAI and grants ChatGPT authorization (`fa:fa-paste`, `fa:fa-check-circle`).
  - Browser polls completion and closes popup upon linkage (`fa:fa-check-double`).
- **Fastify Backend Orchestrator (Multi-Tenant Isolation)**:
  - Validates JWT and extracts user identity (`fa:fa-shield-halved`, `fa:fa-users`).
  - Allocates dedicated session in `activeCodexLogins` Map keyed by `userId` to eliminate multi-user race conditions (`fa:fa-network-wired`).
  - Provisions per-user isolated directory `~/.agent-codex-auth/{userId}` (`fa:fa-folder-plus`).
  - Executes headless `@openai/codex login --device-auth` with `CODEX_HOME` and `HOME` isolated to that user directory (`fa:fa-terminal`).
  - Intercepts stdout to extract verification URL and code for the popup (`fa:fa-filter`).
  - Awaits process completion (`fa:fa-clock-rotate-left`), extracts authenticated email from `auth.json` (`fa:fa-file-shield`, `fa:fa-id-badge`).
  - Persists token to multi-tenant profile storage: `~/.agent-user-profiles/{userId}/.codex/auth.json` (`fa:fa-database`).
  - Updates Firestore linkage state: `codex.linked = true` (`fa:fa-cloud-upload-alt`).
  - Securely purges temporary auth directory: `rm -rf ~/.agent-codex-auth/{userId}` (`fa:fa-broom`).
  - Dispatches `syncCredentialsToUserSandboxes` (`fa:fa-arrows-rotate`).
- **E2B MicroVM Sandbox Boundary**:
  - Hot-swaps credentials into running user microVMs at `/home/agent-runner/.codex/auth.json` (`fa:fa-bolt`).
  - Pre-warms future microVMs from persistent user profile on boot (`fa:fa-snowflake`).
  - Strictly enforces Linux DAC permissions: `chown -R agent-runner:agent-runner` and `chmod 700` (`fa:fa-lock`).
  - Enables prompt execution strictly within the cloud MicroVM (`fa:fa-play`).

![Codex Auth Flow Diagram](codex-auth-flow.png)

---

## 🛠️ Regenerating Visualizations

All diagrams can be regenerated at any time using the pre-configured `mmdc` CLI tool:

```bash
# Architecture Diagram (SVG & High-Res PNG)
mmdc -p ~/.mermaid-puppeteer.json -i visualizations/architecture-diagram.mmd -o visualizations/architecture-diagram.svg -b "#0b0f19"
mmdc -p ~/.mermaid-puppeteer.json -i visualizations/architecture-diagram.mmd -o visualizations/architecture-diagram.png -b "#0b0f19" -s 2

# User Flow Diagram (SVG & High-Res PNG)
mmdc -p ~/.mermaid-puppeteer.json -i visualizations/user-flow-diagram.mmd -o visualizations/user-flow-diagram.svg -b "#0b0f19"
mmdc -p ~/.mermaid-puppeteer.json -i visualizations/user-flow-diagram.mmd -o visualizations/user-flow-diagram.png -b "#0b0f19" -s 2

# Codex Auth Flow Diagram (SVG & High-Res PNG)
mmdc -p ~/.mermaid-puppeteer.json -i visualizations/codex-auth-flow.mmd -o visualizations/codex-auth-flow.svg -b "#0b0f19"
mmdc -p ~/.mermaid-puppeteer.json -i visualizations/codex-auth-flow.mmd -o visualizations/codex-auth-flow.png -b "#0b0f19" -s 2
```
