#!/usr/bin/env bash
set -euo pipefail

# Build the custom E2B template using the official E2B CLI
# Requires E2B_API_KEY environment variable or prior `e2b auth login`
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
BACKEND_DIR="$(cd "$DIR/../.." >/dev/null 2>&1 && pwd)"
ROOT_DIR="$(cd "$DIR/../../.." >/dev/null 2>&1 && pwd)"

# Auto-source .env if present in root or backend to pick up E2B_API_KEY
if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  source "$ROOT_DIR/.env" 2>/dev/null || true
  set +a
elif [ -f "$BACKEND_DIR/.env" ]; then
  set -a
  source "$BACKEND_DIR/.env" 2>/dev/null || true
  set +a
fi

cd "$DIR"

echo "=========================================================="
echo " Building Custom E2B Template: atelier-agent-vm"
echo " Pre-baking CLIs: agy, @openai/codex, @anthropic-ai/claude-code"
echo "=========================================================="

npx -y @e2b/cli template create atelier-agent-vm \
  --dockerfile e2b.Dockerfile \
  --cpu-count 2 \
  --memory-mb 2048 \
  "$@"

echo ""
echo "=========================================================="
echo " Template 'atelier-agent-vm' built successfully!"
echo " Ready for instant microVM boots with zero CLI downloads."
echo "=========================================================="
