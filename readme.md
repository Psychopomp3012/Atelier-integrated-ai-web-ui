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
4. Claude Auth (no auth for free account?)
5. No visual testing possible as a cloud server has no GUI?


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

# Hosting
## Deploy the backend folder to Heroku
git subtree push --prefix backend heroku main



agy:
agy is a Go terminal binary that uses a raw terminal reader and opens /dev/tty directly. When Node.js spawns it with standard anonymous pipes (stdio: ['pipe', 'pipe', 'pipe']), agy's terminal reader ignores anonymous pipes and blocks waiting on a real pseudo-terminal (PTY) until its 60-second internal timeout expires!
- It allocates a pseudo-terminal (openpty), connects agy to the PTY slave, and bi-directionally bridges Node's pipe stdin/stdout into the PTY master.