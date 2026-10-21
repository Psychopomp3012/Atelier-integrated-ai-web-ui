# Custom E2B Base Template for Atelier Cloud Agent Workspace
# Pre-bakes all CLI toolchains (agy, codex, claude) and security boundaries
# so microVM launches are instantaneous with ZERO runtime downloads.

FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# 1. Install base utilities and dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    wget \
    git \
    tar \
    gzip \
    ca-certificates \
    sudo \
    build-essential \
    python3 \
    python3-pip \
    jq \
    && rm -rf /var/lib/apt/lists/*

# 2. Install Node.js LTS (v22) and bundled npm
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# 3. Pre-install AI Agent CLIs globally
# - Antigravity CLI (agy)
RUN (curl -sSL "https://github.com/google-antigravity/antigravity-cli/releases/latest/download/agy_cli_linux_x64.tar.gz" -o /tmp/agy.tar.gz \
    || curl -sSL "https://github.com/google-antigravity/antigravity-cli/releases/download/1.3.6/agy_cli_linux_x64.tar.gz" -o /tmp/agy.tar.gz) \
    && tar -xzf /tmp/agy.tar.gz -C /usr/local/bin \
    && ln -sf /usr/local/bin/antigravity /usr/local/bin/agy \
    && chmod +x /usr/local/bin/antigravity /usr/local/bin/agy \
    && rm -f /tmp/agy.tar.gz

# - OpenAI Codex CLI (@openai/codex)
RUN npm install -g @openai/codex@latest

# - Anthropic Claude CLI (@anthropic-ai/claude-code)
RUN npm install -g @anthropic-ai/claude-code@latest

# 4. Pre-configure dual-user security boundaries and workspace
RUN id -u user >/dev/null 2>&1 || useradd -m -s /bin/bash user \
    && id -u agent-runner >/dev/null 2>&1 || useradd -m -s /bin/bash agent-runner \
    && usermod -a -G user agent-runner \
    && usermod -a -G agent-runner user \
    && echo "user ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers \
    && echo "agent-runner ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers \
    && mkdir -p /home/agent-runner/.gemini/antigravity-cli /home/agent-runner/.claude /home/agent-runner/.codex /home/agent-runner/.local/bin \
    && chmod 700 /home/agent-runner \
    && chmod 700 /home/agent-runner/.gemini /home/agent-runner/.claude /home/agent-runner/.codex \
    && chmod 755 /home/user \
    && mkdir -p /home/user/workspace \
    && chown -R user:user /home/user/workspace \
    && chmod -R 2777 /home/user/workspace \
    && ln -s /home/user/workspace /workspace

WORKDIR /home/user/workspace
