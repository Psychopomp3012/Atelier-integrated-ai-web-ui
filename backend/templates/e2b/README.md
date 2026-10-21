# Custom E2B Sandbox Base Template (`atelier-agent-vm`)

This template pre-packages all agent CLI toolchains and system boundaries directly into an E2B Firecracker microVM image, eliminating all runtime downloads and reducing sandbox boot time from ~28 seconds down to **~1.5 seconds**.

## Included Toolchains & Boundaries
- **Antigravity CLI (`agy`)**: Installed at `/usr/local/bin/agy` and `/usr/local/bin/antigravity`.
- **OpenAI Codex CLI (`codex`)**: Installed globally at `/usr/local/bin/codex` via `@openai/codex`.
- **Anthropic Claude CLI (`claude`)**: Installed globally at `/usr/local/bin/claude` via `@anthropic-ai/claude-code`.
- **Dual-User Linux DAC Security**:
  - `agent-runner` user: isolated user for CLI executions with restricted credential directory (`/home/agent-runner`).
  - `user` user: standard developer user owning `/home/user/workspace` and `/workspace`.

## How to Build the Template

Run the build script:
```bash
./backend/templates/e2b/build-template.sh
```

Or manually using the E2B CLI:
```bash
cd backend/templates/e2b
npx -y @e2b/cli template create atelier-agent-vm --dockerfile e2b.Dockerfile --cpu-count 2 --memory-mb 2048
```

## Environment Configuration
Set in your `.env` (or environment variables):
```env
E2B_TEMPLATE=atelier-agent-vm
```
If not specified, the backend defaults to `atelier-agent-vm`.
