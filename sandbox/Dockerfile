# Cloud-Native Agent Execution Sandbox Environment
# Designed for isolated, safe code and shell execution for AI agents
FROM node:20-bookworm-slim

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install essential dev utilities, compilers, and runtimes
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    git \
    jq \
    make \
    procps \
    python3 \
    python3-pip \
    python3-venv \
    tar \
    unzip \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Install pre-packaged AI agent CLIs (Antigravity CLI agy)
COPY bin/agy* /usr/local/bin/
RUN if [ -f /usr/local/bin/agy ]; then chmod +x /usr/local/bin/agy; fi

# Install OpenAI Codex CLI and Anthropic Claude Code CLI
RUN npm install -g @openai/codex @anthropic-ai/claude-code

# Configure isolated workspace directory and grant ownership to node user (UID 1000)
RUN mkdir -p /workspace /home/node/.gemini/antigravity-cli && chown -R node:node /workspace /home/node

# Set working directory to isolated sandbox workspace
WORKDIR /workspace

# Switch to non-root node user (UID 1000) for security isolation
USER node

# Configure user environment
ENV HOME=/home/node \
    PATH=/home/node/.local/bin:/usr/local/bin:$PATH \
    NODE_ENV=development

# Keep container alive to accept interactive commands via docker exec
CMD ["sleep", "infinity"]
