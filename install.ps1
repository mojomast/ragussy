# Ragussy Installation Script for Windows
# Run: powershell -ExecutionPolicy Bypass -File install.ps1

Write-Host ""
Write-Host "  ____                                  " -ForegroundColor Magenta
Write-Host " |  _ \ __ _  __ _ _   _ ___ ___ _   _  " -ForegroundColor Magenta
Write-Host " | |_) / _` |/ _` | | | / __/ __| | | | " -ForegroundColor Magenta
Write-Host " |  _ < (_| | (_| | |_| \__ \__ \ |_| | " -ForegroundColor Magenta
Write-Host " |_| \_\__,_|\__, |\__,_|___/___/\__, | " -ForegroundColor Magenta
Write-Host "             |___/               |___/  " -ForegroundColor Magenta
Write-Host ""
Write-Host "Universal RAG Chatbot Installation" -ForegroundColor Cyan
Write-Host ""

# Check Node.js
Write-Host "Checking prerequisites..." -ForegroundColor Yellow

$nodeVersion = node --version 2>$null
if (-not $nodeVersion) {
    Write-Host "ERROR: Node.js is not installed!" -ForegroundColor Red
    Write-Host "Please install Node.js 20+ from https://nodejs.org" -ForegroundColor Yellow
    exit 1
}

$majorVersion = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
if ($majorVersion -lt 20) {
    Write-Host "ERROR: Node.js 20+ required. Found: $nodeVersion" -ForegroundColor Red
    exit 1
}
Write-Host "  Node.js: $nodeVersion" -ForegroundColor Green

# Check Docker
$dockerVersion = docker --version 2>$null
if ($dockerVersion) {
    Write-Host "  Docker: Found" -ForegroundColor Green
} else {
    Write-Host "  Docker: Not found (optional, needed for Qdrant)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Installing dependencies..." -ForegroundColor Yellow

# Install backend dependencies
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to install backend dependencies" -ForegroundColor Red
    exit 1
}

# Install frontend dependencies
Set-Location frontend
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to install frontend dependencies" -ForegroundColor Red
    exit 1
}
Set-Location ..

Write-Host ""
Write-Host "Creating default configuration..." -ForegroundColor Yellow

# Create .env if it doesn't exist
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "  Created .env from template" -ForegroundColor Green
} else {
    Write-Host "  .env already exists, skipping" -ForegroundColor Yellow
}

# Create docs folder if it doesn't exist
if (-not (Test-Path "docs")) {
    New-Item -ItemType Directory -Path "docs" | Out-Null
    Write-Host "  Created docs folder" -ForegroundColor Green
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Installation Complete!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host ""
Write-Host "1. Start Qdrant (in a separate terminal):" -ForegroundColor White
Write-Host "   docker run -p 6333:6333 qdrant/qdrant" -ForegroundColor Gray
Write-Host ""
Write-Host "2. Start Ragussy:" -ForegroundColor White
Write-Host "   npm run dev:all" -ForegroundColor Gray
Write-Host ""
Write-Host "3. Open your browser:" -ForegroundColor White
Write-Host "   http://localhost:5173" -ForegroundColor Cyan
Write-Host ""
Write-Host "The setup wizard will guide you through" -ForegroundColor White
Write-Host "configuring API keys and settings." -ForegroundColor White
Write-Host ""
