#!/bin/bash

# Ragussy Installation Script
# Run: curl -fsSL https://raw.githubusercontent.com/mojomast/ragussy/main/install.sh | bash

set -euo pipefail

WITH_DISCORD=false
SKIP_SETUP=false
NON_INTERACTIVE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-discord)
      WITH_DISCORD=true
      shift
      ;;
    --skip-setup)
      SKIP_SETUP=true
      shift
      ;;
    --non-interactive)
      NON_INTERACTIVE=true
      shift
      ;;
    *)
      echo -e "\033[31mUnknown argument: $1\033[0m"
      echo -e "Usage: ./install.sh [--with-discord] [--skip-setup] [--non-interactive]"
      exit 1
      ;;
  esac
done

prompt_yes_no() {
  local message="$1"
  local default_answer="${2:-Y}"

  if [[ "$NON_INTERACTIVE" == "true" ]]; then
    [[ "$default_answer" == "Y" ]]
    return
  fi

  local suffix="[Y/n]"
  if [[ "$default_answer" == "N" ]]; then
    suffix="[y/N]"
  fi

  read -r -p "$message $suffix " answer
  answer="${answer:-$default_answer}"

  case "${answer,,}" in
    y|yes) return 0 ;;
    n|no) return 1 ;;
    *)
      [[ "$default_answer" == "Y" ]]
      ;;
  esac
}

echo ""
echo -e "\033[35m  ____                                  \033[0m"
echo -e "\033[35m |  _ \ __ _  __ _ _   _ ___ ___ _   _  \033[0m"
echo -e "\033[35m | |_) / _\` |/ _\` | | | / __/ __| | | | \033[0m"
echo -e "\033[35m |  _ < (_| | (_| | |_| \__ \__ \ |_| | \033[0m"
echo -e "\033[35m |_| \_\__,_|\__, |\__,_|___/___/\__, | \033[0m"
echo -e "\033[35m             |___/               |___/  \033[0m"
echo ""
echo -e "\033[36mUniversal RAG Chatbot Installation\033[0m"
echo ""

# Check Node.js
echo -e "\033[33mChecking prerequisites...\033[0m"

if ! command -v node &> /dev/null; then
    echo -e "\033[31mERROR: Node.js is not installed!\033[0m"
    echo -e "\033[33mPlease install Node.js 20+ from https://nodejs.org\033[0m"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo -e "\033[31mERROR: Node.js 20+ required. Found: $(node -v)\033[0m"
    exit 1
fi
echo -e "  \033[32mNode.js: $(node -v)\033[0m"

# Check Docker
if command -v docker &> /dev/null; then
    echo -e "  \033[32mDocker: Found\033[0m"
else
    echo -e "  \033[33mDocker: Not found (optional, needed for Qdrant)\033[0m"
fi

echo ""
echo -e "\033[33mInstalling dependencies...\033[0m"

# Install backend dependencies
npm install

# Install frontend dependencies
npm install --prefix frontend

if [[ "$WITH_DISCORD" == "true" ]]; then
  echo -e "\033[33mInstalling Discord bot dependencies...\033[0m"
  npm install --prefix discord-bot
fi

echo ""
echo -e "\033[33mCreating default configuration...\033[0m"

# Create .env if it doesn't exist
if [ ! -f ".env" ]; then
    cp .env.example .env
    echo -e "  \033[32mCreated .env from template\033[0m"
else
    echo -e "  \033[33m.env already exists, skipping\033[0m"
fi

# Create docs folder if it doesn't exist
if [ ! -d "docs" ]; then
    mkdir -p docs
    echo -e "  \033[32mCreated docs folder\033[0m"
fi

echo ""
echo -e "\033[36m============================================\033[0m"
echo -e "  \033[32mInstallation Complete!\033[0m"
echo -e "\033[36m============================================\033[0m"
echo ""

if [[ "$SKIP_SETUP" == "false" ]] && prompt_yes_no "Run interactive Ragussy setup now?" "Y"; then
  echo ""
  npm run setup
fi

if [[ "$WITH_DISCORD" == "false" ]] && prompt_yes_no "Install optional Discord bot dependencies?" "N"; then
  WITH_DISCORD=true
  npm install --prefix discord-bot
fi

if [[ "$WITH_DISCORD" == "true" ]]; then
  if prompt_yes_no "Run interactive Discord bot setup now?" "Y"; then
    echo ""
    npm run setup --prefix discord-bot
  fi
fi

echo -e "\033[33mNext steps:\033[0m"
echo ""

if command -v docker &> /dev/null; then
  echo -e "\033[37m1. Start services (recommended):\033[0m"
  echo -e "   \033[90mdocker compose up -d qdrant\033[0m"
else
  echo -e "\033[37m1. Start Qdrant (in a separate terminal):\033[0m"
  echo -e "   \033[90mdocker run -p 6333:6333 qdrant/qdrant\033[0m"
fi

echo ""
echo -e "\033[37m2. Start Ragussy:\033[0m"
echo -e "   \033[90mnpm run dev:all\033[0m"
echo ""
echo -e "\033[37m3. Open your browser:\033[0m"
echo -e "   \033[36mhttp://localhost:5173\033[0m"

if [[ "$WITH_DISCORD" == "true" ]]; then
  echo ""
  echo -e "\033[37m4. Register Discord commands (optional):\033[0m"
  echo -e "   \033[90mnpm run register --prefix discord-bot\033[0m"
fi

echo ""
