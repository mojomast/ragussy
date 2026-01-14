---
title: Getting Started
description: How to get started with Ragussy
---

# Getting Started

Welcome to Ragussy! This guide will help you set up your RAG chatbot.

## Prerequisites

Before you begin, make sure you have:

- Node.js 20 or later
- Docker (for running Qdrant)
- An OpenAI API key (or compatible provider)

## Installation

### Quick Install

```bash
git clone https://github.com/mojomast/ragussy.git
cd ragussy
./install.sh  # or install.ps1 on Windows
```

### Manual Install

```bash
git clone https://github.com/mojomast/ragussy.git
cd ragussy
npm install
cd frontend && npm install && cd ..
cp .env.example .env
```

## Starting the Application

1. Start Qdrant:
```bash
docker run -p 6333:6333 qdrant/qdrant
```

2. Start Ragussy:
```bash
npm run dev:all
```

3. Open http://localhost:5173

## Setup Wizard

The first time you open Ragussy, you'll see the Setup Wizard. It will guide you through:

1. **Project Configuration** - Name your project and set the docs path
2. **LLM Configuration** - Add your OpenAI or OpenRouter API key
3. **Embeddings Configuration** - Configure the embedding model
4. **Vector Database** - Connect to Qdrant

## Adding Documents

After setup, go to the Documents page to:

- Upload markdown files
- Upload zip archives containing docs
- View and manage your documentation

## Indexing

Click "Incremental Index" to process new documents, or "Full Reindex" to rebuild everything from scratch.

## Chatting

Go to the Chat page, enter your API key (from Settings), and start asking questions about your documentation!

## Next Steps

- Explore the Settings page to customize your configuration
- Check out the Vector Store page to monitor your indexed data
- Add more documentation and re-index
