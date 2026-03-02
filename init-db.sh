#!/bin/bash
# This script runs inside the PostgreSQL container after startup
# It creates the logto database and applies schema fixes

set -e

echo "=== Creating logto database if not exists ==="
psql -U postgres -tc "SELECT 1 FROM pg_database WHERE datname = 'logto'" | grep -q 1 || \
  psql -U postgres -c "CREATE DATABASE logto;"

echo "=== Waiting for Logto to seed its schema (will retry for 60s) ==="
for i in $(seq 1 30); do
  if psql -U postgres -d logto -tc "SELECT 1 FROM information_schema.tables WHERE table_name = 'applications'" 2>/dev/null | grep -q 1; then
    echo "Logto schema ready!"
    break
  fi
  echo "  Waiting... ($i/30)"
  sleep 2
done

echo "=== Inserting LobeChat app into Logto ==="
psql -U postgres -d logto -c "
INSERT INTO applications (tenant_id, id, name, secret, description, type, oidc_client_metadata, custom_client_metadata, custom_data, is_third_party, created_at)
VALUES (
  'default',
  'lobechat-app',
  'LobeChat',
  'kLPFa3mSfYhBQ4AgwdvuXTDGzb9cVp0K',
  'LobeChat Web App',
  'Traditional',
  '{\"redirectUris\":[\"http://localhost:3210/api/auth/callback/logto\"],\"postLogoutRedirectUris\":[\"http://localhost:3210/\"]}',
  '{}',
  '{}',
  false,
  now()
) ON CONFLICT (id) DO NOTHING;
"

echo "=== Waiting for LobeChat to create embeddings table (will retry for 120s) ==="
for i in $(seq 1 60); do
  if psql -U postgres -d lobechat -tc "SELECT 1 FROM information_schema.tables WHERE table_name = 'embeddings'" 2>/dev/null | grep -q 1; then
    echo "Embeddings table ready!"
    break
  fi
  echo "  Waiting for embeddings table... ($i/60)"
  sleep 2
done

echo "=== Fixing vector dimension (1024 -> 768 for nomic-embed-text) ==="
psql -U postgres -d lobechat -c "
DO \$\$
BEGIN
  -- Fix embeddings column: change vector(1024) to vector(768) if needed
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'embeddings' AND column_name = 'embeddings'
    AND udt_name = 'vector'
  ) THEN
    -- Delete any existing embeddings with wrong dimensions
    DELETE FROM embeddings WHERE vector_dims(embeddings) != 768 OR embeddings IS NULL;
    ALTER TABLE embeddings ALTER COLUMN embeddings TYPE vector(768);
    RAISE NOTICE 'Embeddings column set to vector(768)';
  END IF;
END \$\$;
"

echo "=== Fixing similarity column type (numeric -> double precision) ==="
psql -U postgres -d lobechat -c "
DO \$\$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'message_query_chunks' AND column_name = 'similarity'
    AND data_type = 'numeric'
  ) THEN
    ALTER TABLE message_query_chunks ALTER COLUMN similarity TYPE double precision;
    RAISE NOTICE 'Similarity column changed to double precision';
  END IF;
END \$\$;
"

echo "=== Database initialization complete ==="
