#!/bin/bash

# Ragussy Installation Script
# Run: curl -fsSL https://raw.githubusercontent.com/mojomast/ragussy/main/install.sh | bash

set -e

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
cd frontend
npm install
cd ..

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
echo -e "\033[33mNext steps:\033[0m"
echo ""
echo -e "\033[37m1. Start Qdrant (in a separate terminal):\033[0m"
echo -e "   \033[90mdocker run -p 6333:6333 qdrant/qdrant\033[0m"
echo ""
echo -e "\033[37m2. Start Ragussy:\033[0m"
echo -e "   \033[90mnpm run dev:all\033[0m"
echo ""
echo -e "\033[37m3. Open your browser:\033[0m"
echo -e "   \033[36mhttp://localhost:5173\033[0m"
echo ""
echo -e "\033[37mThe setup wizard will guide you through\033[0m"
echo -e "\033[37mconfiguring API keys and settings.\033[0m"
echo ""
