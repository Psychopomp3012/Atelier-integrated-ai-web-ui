Objectives(What to do):
- Chatgpt like UI
- Cloud-only execution of all agents
- (Codex + Claude + Others) switching
- Sandbox will contain all clis to run
- Something to login user using both AI platforms involved
- Avoid putting all utilities in same file. Make appropriate folders whenever needed.
- Ensure modular and scalable architecture.
- Do web search whenever necessary, don't make up stuff.
- Do appropriate error handling to ensure smoother degugging later.

Objectives(What not to do):
1. DO NOT PUT any secret keys/private keys in a file that will be pushed.
2. DO NOT ever read files containing secrets 
3. DO NOT hardcode models listed for any provider
4. DO NOT hardcode agent response
5. DO NOT add system prompt as to what to do no matter what.
6. DO NOT use a fallback service for ai agents.
7. DO NOT try testing that takes too long, just relay me what to do, i will test myself o save tokens.

Frontend Instructions:
- Tech Stack: React + typescript + tailwind(v3)
- Keep UI mobile-friendly
- Add a day-night mode option. For day-night mode, the mode should be what the user has set for browser. If user switches mode, store that preference in localstorage in frontend. 

Backend Intructions:
- Tech stack: Fastify(Backend)
- In backend, use type whenever possible for typescript.
- Add appropriate rate limits to APIs to prevent abuse.

Login Instruction:
1. Use JWT for login in the website. The JWT should refresh every week to automatically logout user.
2. On linking the CLI a smooth UI flow should occur for that CLI. We will not use API keys for that.

Testing Instruction:
- When asked for testing, perform testing in a separate folder, so clean up will be easy.
