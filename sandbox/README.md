# Agent Execution Sandbox

Isolated, secure container execution environment for AI agents.

## Architecture

- **Control Plane**: Fastify backend manages authentication, conversation history, and model reasoning.
- **Execution Plane**: This sandbox container executes shell commands, code compilation, and filesystem operations in complete isolation.
- **Zero Secrets Policy**: No AI API keys or developer credentials ever enter the sandbox container.

## Local Docker Build

```bash
docker build -t integrated-agent-sandbox:latest ./sandbox
```

## Running Manually (for debugging)

```bash
docker run -d --name test-sandbox --rm integrated-agent-sandbox:latest
docker exec -it test-sandbox bash
```
