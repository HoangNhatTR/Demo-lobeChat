#!/bin/bash
# ============================================================
#  LobeChat Self-Hosted - Setup Script for Linux/macOS
#  Run with: sudo ./setup.sh
# ============================================================

set -e

echo ""
echo "============================================"
echo " LobeChat Self-Hosted Setup"
echo "============================================"
echo ""

# --- Step 1: Check Docker ---
if ! command -v docker &> /dev/null; then
    echo "[ERROR] Docker is not installed."
    echo "Install: https://docs.docker.com/engine/install/"
    exit 1
fi
echo "[OK] Docker found"

# --- Step 2: Check Ollama ---
if ! command -v ollama &> /dev/null; then
    echo "[WARNING] Ollama is not installed."
    echo "Install: curl -fsSL https://ollama.com/install.sh | sh"
    exit 1
fi
echo "[OK] Ollama found"

# --- Step 3: Pull Ollama models ---
echo ""
echo "[STEP] Pulling Ollama models..."
ollama pull nomic-embed-text
ollama pull llama3.1

# --- Step 4: Create text-embedding-3-small alias ---
echo ""
echo "[STEP] Creating text-embedding-3-small alias..."
if [ ! -f Modelfile-embedding ]; then
    echo "FROM nomic-embed-text" > Modelfile-embedding
fi
ollama create text-embedding-3-small -f Modelfile-embedding

# --- Step 5: Add hosts entries ---
echo ""
echo "[STEP] Adding hosts entries..."
if ! grep -q "logto" /etc/hosts; then
    echo "127.0.0.1 logto" >> /etc/hosts
    echo "[OK] Added: 127.0.0.1 logto"
else
    echo "[SKIP] logto already in hosts"
fi

if ! grep -q "minio" /etc/hosts; then
    echo "127.0.0.1 minio" >> /etc/hosts
    echo "[OK] Added: 127.0.0.1 minio"
else
    echo "[SKIP] minio already in hosts"
fi

# --- Step 6: Start Docker services ---
echo ""
echo "[STEP] Starting Docker services..."
docker compose up -d

# --- Step 7: Wait for PostgreSQL ---
echo ""
echo "[STEP] Waiting for PostgreSQL to be ready..."
until docker exec lobe-postgres pg_isready -U postgres -d lobechat > /dev/null 2>&1; do
    sleep 3
done
echo "[OK] PostgreSQL is ready"

# --- Step 8: Run DB init script ---
echo ""
echo "[STEP] Running database initialization..."
docker cp init-db.sh lobe-postgres:/tmp/init-db.sh
docker exec lobe-postgres chmod +x /tmp/init-db.sh
docker exec lobe-postgres bash /tmp/init-db.sh

# --- Step 9: Restart LobeChat ---
echo ""
echo "[STEP] Restarting LobeChat..."
docker compose restart lobechat

echo ""
echo "============================================"
echo " Setup Complete!"
echo "============================================"
echo ""
echo " LobeChat:       http://localhost:3210"
echo " MinIO Console:  http://localhost:9001"
echo " Logto Admin:    http://localhost:3001"
echo ""
echo " First time: Register a new account at LobeChat login page."
echo ""
