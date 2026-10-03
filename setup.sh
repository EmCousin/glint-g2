#!/usr/bin/env bash
set -euo pipefail

# ─── Glint G2 Setup ──────────────────────────────────────────────────
# One-shot installer: checks prerequisites, installs npm dependencies,
# sets up the Python virtualenv for voice transcription, copies env
# files, and generates a shared bridge token.
# ─────────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
RESET='\033[0m'

info()  { printf "${GREEN}✓${RESET} %s\n" "$1"; }
warn()  { printf "${YELLOW}⚠${RESET} %s\n" "$1"; }
fail()  { printf "${RED}✗${RESET} %s\n" "$1"; exit 1; }
step()  { printf "\n${BOLD}── %s${RESET}\n" "$1"; }

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# ─── 1. Prerequisites ────────────────────────────────────────────────
step "Checking prerequisites"

# Node.js >= 20
if ! command -v node &>/dev/null; then
  fail "Node.js not found. Install Node >= 20 (https://nodejs.org) or use mise/nvm."
fi
NODE_MAJOR=$(node -e 'console.log(process.versions.node.split(".")[0])')
if [ "$NODE_MAJOR" -lt 20 ]; then
  fail "Node.js v$NODE_MAJOR found, but v20+ is required."
fi
info "Node.js v$(node --version | tr -d v)"

# npm
if ! command -v npm &>/dev/null; then
  fail "npm not found."
fi
info "npm v$(npm --version)"

# Python 3 (optional — only needed for voice transcription)
PYTHON=""
if command -v python3 &>/dev/null; then
  PYTHON="python3"
  info "Python 3 found ($(python3 --version 2>&1))"
elif command -v python &>/dev/null; then
  PY_MAJOR=$(python -c 'import sys; print(sys.version_info.major)')
  if [ "$PY_MAJOR" = "3" ]; then
    PYTHON="python"
    info "Python 3 found ($(python --version 2>&1))"
  fi
fi
if [ -z "$PYTHON" ]; then
  warn "Python 3 not found — voice transcription will not be available."
  warn "Install Python 3 later and re-run this script to enable it."
fi

# Tailscale (optional check)
if command -v tailscale &>/dev/null; then
  info "Tailscale found"
else
  warn "Tailscale not found — needed for glasses to reach this workstation."
fi

# ─── 2. npm install ──────────────────────────────────────────────────
step "Installing npm dependencies"
npm install
info "All workspaces installed"

# ─── 3. Python virtualenv (voice transcription) ──────────────────────
if [ -n "$PYTHON" ]; then
  step "Setting up Python virtualenv for voice transcription"
  if [ ! -d ".venv" ]; then
    $PYTHON -m venv .venv
    info "Created .venv"
  else
    info ".venv already exists"
  fi
  .venv/bin/pip install --quiet faster-whisper numpy
  info "Installed faster-whisper and numpy"
else
  step "Skipping Python virtualenv (Python 3 not available)"
fi

# ─── 4. Environment files ────────────────────────────────────────────
step "Setting up environment files"

TOKEN=$(openssl rand -hex 32)

copy_env() {
  local src="$1" dst="$2"
  if [ -f "$dst" ]; then
    warn "$(realpath --relative-to="$ROOT" "$dst") already exists — skipping"
  else
    cp "$src" "$dst"
    # Replace placeholder token with the generated one
    sed -i "s/replace-with-a-long-random-token/$TOKEN/" "$dst"
    info "Created $(realpath --relative-to="$ROOT" "$dst")"
  fi
}

# Unified bridge (recommended default)
copy_env apps/unified/bridge/.env.example apps/unified/bridge/.env

# Per-provider bridges
copy_env apps/signal/bridge/.env.example   apps/signal/bridge/.env
copy_env apps/whatsapp/bridge/.env.example apps/whatsapp/bridge/.env
copy_env apps/hey/bridge/.env.example      apps/hey/bridge/.env

# Plugin env files — point each at its bridge
for provider in signal whatsapp hey unified; do
  plugin_dir="apps/$provider/plugin"
  if [ -f "$plugin_dir/.env.example" ]; then
    copy_env "$plugin_dir/.env.example" "$plugin_dir/.env"
  fi
done

# ─── 5. Summary ──────────────────────────────────────────────────────
step "Setup complete"

printf "\n"
printf "  ${BOLD}Bridge token:${RESET} %s\n" "$TOKEN"
printf "  (saved in all .env files — change it later if needed)\n"
printf "\n"
printf "  ${BOLD}Quick start:${RESET}\n"
printf "    npm run simulate:unified    # mock data, all providers\n"
printf "    npm run simulate:signal     # just Signal (mock)\n"
printf "\n"
printf "  ${BOLD}With live providers:${RESET}\n"
printf "    npm run simulate:signal:gurk      # requires signal-cli + Gurk\n"
printf "    npm run simulate:whatsapp:live    # links via QR on first run\n"
printf "    npm run simulate:hey:live         # requires HEY CLI\n"
printf "\n"
printf "  See ${BOLD}README.md${RESET} for provider-specific configuration.\n"
printf "\n"
