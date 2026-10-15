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
   - Open this file ([`backend/visualizations/README.md`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/visualizations/README.md)) and press **`Ctrl+Shift+V`** (or click the **Markdown Preview** button in the top-right corner of the editor tab).
   - Or click directly on the image files in the sidebar file tree:
     - [`architecture-diagram.svg`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/visualizations/architecture-diagram.svg) / [`architecture-diagram.png`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/visualizations/architecture-diagram.png)
     - [`user-flow-diagram.svg`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/visualizations/user-flow-diagram.svg) / [`user-flow-diagram.png`](file:///home/psychopomp3012/Projects/Integrated-Web-UI/backend/visualizations/user-flow-diagram.png)

3. **From the Terminal / Native Image Viewer:**
   ```bash
   xdg-open backend/visualizations/architecture-diagram.png
   xdg-open backend/visualizations/user-flow-diagram.png
   ```

---

## 1. System Architecture Diagram (`architecture-beta`)

Built strictly with Mermaid's native **`architecture-beta`** syntax matching the cloud-only execution model:
- **`group client(cloud)`**: React 19 Frontend UI & Cloud Inspector telemetry client hosted on **Vercel**.
- **`group backend(server)`**: Fastify API core, 7-day JWT auth guard, and **Google Cloud Firestore** (persisting user profiles, active 7-day sessions, linked CLI credentials, and conversation logs) hosted on **Heroku**.
- **`group sandbox(cloud)`**: Dedicated E2B MicroVM Sandbox housing the isolated AI CLIs (**Google Antigravity**, **OpenAI Codex**, and **Anthropic Claude**) with zero peer-to-peer coupling.
- **Fastify Core to Sandbox Connection**: A single unified dispatch line from `Fastify API Core` into the E2B Sandbox entry point, which branches to the respective CLI environment.
- **Directional Port Pinning**: Precision directional edges using Mermaid port connectors (`:T`, `:B`, `:L`, `:R`) with pure white paths (`#ffffff`).

![System Architecture Diagram](architecture-diagram.png)

---

## 2. End-to-End User Flow Diagram (`flowchart TD`)

Built with Mermaid's **`flowchart TD`** visual decision engine featuring native FontAwesome iconography and condition branches:
- **Session & Identity**: OS theme auto-detection (`fa:fa-adjust`) and 7-day JWT auth check (`fa:fa-key`) with Google OAuth fallback.
- **Subscription Linking Flow**: Zero-key account linking via provider OAuth (`fa:fa-shield`, `fa:fa-user-check`).
- **Cloud MicroVM Provisioning**: Firecracker microVM launch (`fa:fa-cloud`), 1GB swap allocation (`fa:fa-microchip`), DAC isolation boundary (`fa:fa-lock`), CLI pre-installation (`fa:fa-download`), and pre-warmed credentials.
- **Dynamic Post-Boot Hot-Swap**: Conditional check for credentials linked after VM start with live token injection (`fa:fa-bolt`).
- **Execution & Observability**: Native CLI execution (`fa:fa-terminal`), exit validation (`fa:fa-question-circle`), real-time SSE token stream (`fa:fa-stream`), and live Cloud Inspector file & telemetry viewing (`fa:fa-desktop`).

![User Flow Diagram](user-flow-diagram.png)

---

## 🛠️ Regenerating Visualizations

Both diagrams can be regenerated at any time using the pre-configured `mmdc` CLI tool:

```bash
# Architecture Diagram (SVG & High-Res PNG)
mmdc -p ~/.mermaid-puppeteer.json -i backend/visualizations/architecture-diagram.mmd -o backend/visualizations/architecture-diagram.svg -b "#0b0f19"
mmdc -p ~/.mermaid-puppeteer.json -i backend/visualizations/architecture-diagram.mmd -o backend/visualizations/architecture-diagram.png -b "#0b0f19" -s 2

# User Flow Diagram (SVG & High-Res PNG)
mmdc -p ~/.mermaid-puppeteer.json -i backend/visualizations/user-flow-diagram.mmd -o backend/visualizations/user-flow-diagram.svg -b "#0b0f19"
mmdc -p ~/.mermaid-puppeteer.json -i backend/visualizations/user-flow-diagram.mmd -o backend/visualizations/user-flow-diagram.png -b "#0b0f19" -s 2
```
