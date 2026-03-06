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

# --- Step 4: Add hosts entries ---
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

# --- Step 5: Start Docker services ---
echo ""
echo "[STEP] Starting Docker services..."
docker compose up -d

# --- Step 6: Wait for services to initialize ---
echo ""
echo "[STEP] Waiting for all services to initialize..."
echo "  Database dimension fix will run automatically (lobe-db-init container)."
for i in $(seq 1 30); do
    if docker logs lobe-db-init 2>&1 | grep -q "Database fix complete"; then
        echo "[OK] Database initialization complete!"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "[INFO] Database init may still be running. Check with: docker logs lobe-db-init"
    fi
    sleep 2
done

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
