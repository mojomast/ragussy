# Ragussy Installation Script for Windows
# Run: powershell -ExecutionPolicy Bypass -File install.ps1

param(
    [switch]$WithDiscord,
    [switch]$SkipSetup,
    [switch]$NonInteractive
)

function Ask-YesNo {
    param(
        [string]$Prompt,
        [bool]$DefaultYes = $true
    )

    if ($NonInteractive) {
        return $DefaultYes
    }

    $suffix = if ($DefaultYes) { "[Y/n]" } else { "[y/N]" }
    $answer = Read-Host "$Prompt $suffix"

    if ([string]::IsNullOrWhiteSpace($answer)) {
        return $DefaultYes
    }

    $normalized = $answer.Trim().ToLowerInvariant()
    if ($normalized -in @('y', 'yes')) { return $true }
    if ($normalized -in @('n', 'no')) { return $false }

    return $DefaultYes
}

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
npm install --prefix frontend
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to install frontend dependencies" -ForegroundColor Red
    exit 1
}

if ($WithDiscord) {
    Write-Host "Installing Discord bot dependencies..." -ForegroundColor Yellow
    npm install --prefix discord-bot
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Failed to install Discord bot dependencies" -ForegroundColor Red
        exit 1
    }
}

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

if (-not $SkipSetup -and (Ask-YesNo -Prompt "Run interactive Ragussy setup now?" -DefaultYes $true)) {
    npm run setup
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Setup wizard failed" -ForegroundColor Red
        exit 1
    }
}

if (-not $WithDiscord -and (Ask-YesNo -Prompt "Install optional Discord bot dependencies?" -DefaultYes $false)) {
    $WithDiscord = $true
    npm install --prefix discord-bot
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Failed to install Discord bot dependencies" -ForegroundColor Red
        exit 1
    }
}

if ($WithDiscord -and (Ask-YesNo -Prompt "Run interactive Discord bot setup now?" -DefaultYes $true)) {
    npm run setup --prefix discord-bot
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Discord setup wizard failed" -ForegroundColor Red
        exit 1
    }
}

Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host ""

if ($dockerVersion) {
    Write-Host "1. Start services (recommended):" -ForegroundColor White
    Write-Host "   docker compose up -d qdrant" -ForegroundColor Gray
} else {
    Write-Host "1. Start Qdrant (in a separate terminal):" -ForegroundColor White
    Write-Host "   docker run -p 6333:6333 qdrant/qdrant" -ForegroundColor Gray
}

Write-Host ""
Write-Host "2. Start Ragussy:" -ForegroundColor White
Write-Host "   npm run dev:all" -ForegroundColor Gray
Write-Host ""
Write-Host "3. Open your browser:" -ForegroundColor White
Write-Host "   http://localhost:5173" -ForegroundColor Cyan
Write-Host ""

if ($WithDiscord) {
    Write-Host "4. Register Discord commands (optional):" -ForegroundColor White
    Write-Host "   npm run register --prefix discord-bot" -ForegroundColor Gray
    Write-Host ""
}
Write-Host ""
