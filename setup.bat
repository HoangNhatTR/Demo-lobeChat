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

REM --- Step 4: Add hosts entries ---
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

REM --- Step 5: Start Docker services ---
echo.
echo [STEP] Starting Docker services...
docker compose up -d

REM --- Step 6: Wait for services to initialize ---
echo.
echo [STEP] Waiting for all services to initialize...
echo   Database dimension fix will run automatically (lobe-db-init container).
timeout /t 30 /nobreak >nul

REM Check if db-init completed
docker logs lobe-db-init 2>&1 | findstr /C:"Database fix complete" >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Database initialization complete!
) else (
    echo [INFO] Database init may still be running. Check with: docker logs lobe-db-init
)

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
pause
