@echo off
REM ============================================================
REM  LobeChat Self-Hosted - Setup Script for Windows
REM  Run this script as Administrator on a NEW machine
REM ============================================================

echo.
echo ============================================
echo  LobeChat Self-Hosted Setup
echo ============================================
echo.

REM --- Step 1: Check Docker ---
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker is not installed. Please install Docker Desktop first.
    echo Download: https://www.docker.com/products/docker-desktop
    pause
    exit /b 1
)
echo [OK] Docker found

REM --- Step 2: Check Ollama ---
ollama --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARNING] Ollama is not installed. Please install Ollama first.
    echo Download: https://ollama.com/download
    echo After installing, run this script again.
    pause
    exit /b 1
)
echo [OK] Ollama found

REM --- Step 3: Pull Ollama models ---
echo.
echo [STEP] Pulling Ollama models...
ollama pull nomic-embed-text
ollama pull llama3.1

REM --- Step 4: Create text-embedding-3-small alias ---
echo.
echo [STEP] Creating text-embedding-3-small alias...
if not exist Modelfile-embedding (
    echo FROM nomic-embed-text > Modelfile-embedding
)
ollama create text-embedding-3-small -f Modelfile-embedding

REM --- Step 5: Add hosts entries ---
echo.
echo [STEP] Adding hosts entries (requires Administrator)...
findstr /C:"logto" C:\Windows\System32\drivers\etc\hosts >nul 2>&1
if %errorlevel% neq 0 (
    echo 127.0.0.1 logto >> C:\Windows\System32\drivers\etc\hosts
    echo [OK] Added: 127.0.0.1 logto
) else (
    echo [SKIP] logto already in hosts
)

findstr /C:"minio" C:\Windows\System32\drivers\etc\hosts >nul 2>&1
if %errorlevel% neq 0 (
    echo 127.0.0.1 minio >> C:\Windows\System32\drivers\etc\hosts
    echo [OK] Added: 127.0.0.1 minio
) else (
    echo [SKIP] minio already in hosts
)

REM --- Step 6: Start Docker services ---
echo.
echo [STEP] Starting Docker services...
docker compose up -d

REM --- Step 7: Wait for services to be healthy ---
echo.
echo [STEP] Waiting for PostgreSQL to be ready...
:wait_pg
docker exec lobe-postgres pg_isready -U postgres -d lobechat >nul 2>&1
if %errorlevel% neq 0 (
    timeout /t 3 /nobreak >nul
    goto wait_pg
)
echo [OK] PostgreSQL is ready

REM --- Step 8: Run DB init script ---
echo.
echo [STEP] Running database initialization...
docker cp init-db.sh lobe-postgres:/tmp/init-db.sh
docker exec lobe-postgres chmod +x /tmp/init-db.sh
docker exec lobe-postgres bash /tmp/init-db.sh

REM --- Step 9: Restart LobeChat to pick up DB changes ---
echo.
echo [STEP] Restarting LobeChat...
docker compose restart lobechat

echo.
echo ============================================
echo  Setup Complete!
echo ============================================
echo.
echo  LobeChat:       http://localhost:3210
echo  MinIO Console:  http://localhost:9001
echo  Logto Admin:    http://localhost:3001
echo.
echo  First time: Register a new account at LobeChat login page.
echo.
echo  NOTE: If Knowledge Base vectorization fails on first try,
echo        wait 30 seconds and run:
echo        docker compose restart lobechat
echo.
pause
