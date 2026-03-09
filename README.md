# LobeChat Self-Hosted (Docker + Ollama)

## LobeChat là gì?

**LobeChat** là một nền tảng chatbot AI mã nguồn mở, cung cấp giao diện web hiện đại để trò chuyện với các mô hình AI (GPT, LLaMA, Gemini,...). Phiên bản **self-hosted** này cho phép bạn:

- 🤖 **Chat với AI hoàn toàn offline** — sử dụng Ollama chạy LLM trên máy local, không cần API key hay kết nối internet
- 📄 **Knowledge Base (RAG)** — upload tài liệu PDF/Word, AI sẽ đọc hiểu và trả lời câu hỏi dựa trên nội dung file
- 🔍 **Vector Search** — tìm kiếm ngữ nghĩa trong tài liệu nhờ PostgreSQL + pgvector
- 👥 **Đa người dùng** — hỗ trợ đăng ký/đăng nhập qua Logto (SSO), mỗi người có dữ liệu riêng
- 📎 **Upload & lưu trữ file** — lưu file đính kèm qua MinIO (S3-compatible)
- 🧩 **Hỗ trợ plugin** — mở rộng khả năng AI với các plugin (tìm kiếm web, vẽ ảnh, v.v.)

Bộ cài đặt LobeChat Database edition chạy trên máy local với:

- **LobeChat** — giao diện chat AI
- **PostgreSQL + pgvector** — database + vector search
- **MinIO** — lưu trữ file (S3-compatible)
- **Logto** — đăng nhập/xác thực SSO
- **Ollama** — LLM & Embedding chạy local (không cần API key)

## Yêu cầu hệ thống

| Thành phần | Yêu cầu                                                 |
| ------------ | --------------------------------------------------------- |
| OS           | Windows 10 hoặc 11/Linux/macOS                           |
| RAM          | >= 16 GB (khuyến nghị)                                  |
| Docker       | Đã cài và đang chạy                                 |
| Ollama       | Đã cài và đang chạy ([ollama.com](https://ollama.com)) |

## Cấu trúc file

```
lobechat/
├── docker-compose.yml      # Cấu hình Docker services
├── init-db.sh              # Script khởi tạo database (chạy trong container)
├── setup.bat               # Script cài đặt tự động (Windows)
├── setup.sh                # Script cài đặt tự động (Linux/macOS)
├── Modelfile-embedding     # Alias model embedding cho Ollama
└── README.md               # File này
```

## Cài đặt nhanh (Windows)

### Cách 1: Chạy script tự động

1. Mở **PowerShell as Administrator**
2. `cd` vào thư mục `lobechat`
3. Chạy:
   ```
   .\setup.bat
   ```

### Cách 2: Cài đặt thủ công

#### Bước 1 — Cài Ollama models

```bash
ollama pull nomic-embed-text
ollama pull llama3.1
ollama create text-embedding-3-small -f Modelfile-embedding
```

#### Bước 2 — Thêm hosts (chạy as Administrator)

Mở `C:\Windows\System32\drivers\etc\hosts` và thêm:

```
127.0.0.1 logto
127.0.0.1 minio
```

#### Bước 3 — Khởi động Docker

```bash
docker compose up -d
```

#### Bước 4 — Khởi tạo database

Đợi ~30 giây cho services khởi động, sau đó:

```bash
docker cp init-db.sh lobe-postgres:/tmp/init-db.sh
docker exec lobe-postgres chmod +x /tmp/init-db.sh
docker exec lobe-postgres bash /tmp/init-db.sh
```

#### Bước 5 — Restart LobeChat

```bash
docker compose restart lobechat
```

## Cài đặt nhanh (Linux/macOS)

```bash
chmod +x setup.sh
sudo ./setup.sh
```

## Truy cập

| Dịch vụ          | URL                                                |
| ------------------ | -------------------------------------------------- |
| **LobeChat** | http://localhost:3210                              |
| MinIO Console      | http://localhost:9001 (minioadmin / minioadmin123) |
| Logto Admin        | http://localhost:3001                              |

Lần đầu truy cập LobeChat, bạn sẽ được chuyển đến trang đăng ký Logto — tạo tài khoản mới.

## Sử dụng Knowledge Base (RAG)

### Tải lên file PDF

1. Truy cập **LobeChat**.
2. Chuyển đến tab **Knowledge Base** (biểu tượng hình thư mục).
3. Tải lên file PDF mong muốn.
4. Chờ quá trình vector hóa hoàn tất (biểu tượng cạnh tên file chuyển sang màu tím).

### Chat với Knowledge Base

1. Nhấn vào biểu tượng **Related Files/Knowledge Bases** bên dưới ô chat để hiển thị danh sách các file đã tải lên.
2. Chọn các file cần sử dụng để chatbot lấy thông tin trả lời câu hỏi.
3. Bắt đầu trò chuyện.

## Khắc phục lỗi thường gặp

### Lỗi "provider is not supported"

→ Chạy lại `init-db.sh` để tạo Logto app

### Lỗi vectorization / embedding

→ Kiểm tra Ollama đang chạy: `ollama list`
→ Đảm bảo model `nomic-embed-text` đã được pull

### Lỗi "similarity: null"

→ Chạy lại `init-db.sh` (sẽ tự fix column type)

### Lỗi upload file

→ Kiểm tra hosts file có `127.0.0.1 minio`

### Xem logs

```bash
docker logs lobe-chat --tail 50
docker logs lobe-postgres --tail 50
docker logs lobe-logto --tail 50
```

## Cấu hình nâng cao

---

### 🤖 Đổi Model LLM (Chat)

#### Cách 1: Đổi trong giao diện LobeChat (khuyến nghị)

1. Truy cập **LobeChat** tại `http://localhost:3210`
2. Vào **Settings** (biểu tượng bánh răng) → **Language Model** → **Ollama**
3. Chọn model mong muốn từ danh sách (LobeChat tự detect các model đã pull trong Ollama)
4. Nhấn **Save**

> Cách này **không cần restart** bất kỳ service nào.

#### Cách 2: Pull model mới từ Ollama rồi dùng trong UI

```bash
# Xem danh sách model đang có
ollama list

# Pull model mới (ví dụ)
ollama pull gemma2
ollama pull mistral
ollama pull phi3
ollama pull qwen2
ollama pull deepseek-r1
```

Sau khi pull xong, vào LobeChat UI → Settings → Language Model → Ollama, model mới sẽ tự xuất hiện.

#### Một số model LLM phổ biến trên Ollama

| Model | Kích thước | RAM tối thiểu | Ghi chú |
|-------|-----------|---------------|---------|
| `llama3.1` | 4.7 GB | 8 GB | Model mặc định, cân bằng tốc độ/chất lượng |
| `llama3.1:70b` | 40 GB | 48 GB | Chất lượng cao, cần GPU mạnh |
| `gemma2` | 5.4 GB | 8 GB | Google, tốt cho tiếng Anh |
| `mistral` | 4.1 GB | 8 GB | Nhanh, nhẹ |
| `phi3` | 2.2 GB | 4 GB | Microsoft, rất nhẹ |
| `qwen2` | 4.4 GB | 8 GB | Alibaba, hỗ trợ tiếng Trung tốt |
| `deepseek-r1` | 4.7 GB | 8 GB | Tốt cho reasoning/lập trình |
| `codellama` | 3.8 GB | 8 GB | Chuyên cho code |

> 💡 Xem thêm model tại: https://ollama.com/library

---

### 🔍 Đổi Model Embedding (cho Knowledge Base / RAG)

Khi đổi model embedding, cần thực hiện **4 bước** theo thứ tự:

#### Bước 1 — Pull model embedding mới

```bash
# Ví dụ đổi sang mxbai-embed-large
ollama pull mxbai-embed-large
```

#### Bước 2 — Sửa `docker-compose.yml`

Mở file `docker-compose.yml`, tìm phần `lobechat` → `environment`, sửa:

```yaml
# Ollama - Embedding
EMBEDDING_MODEL_PROVIDER: "ollama"
DEFAULT_EMBEDDING_MODEL: "mxbai-embed-large"    # ← đổi tên model ở đây
```

Tiếp theo, tìm phần `db-init` → `entrypoint`, sửa **vector dimension** cho phù hợp với model mới:

```sql
DELETE FROM embeddings WHERE vector_dims(embeddings) != 1024 OR embeddings IS NULL;
ALTER TABLE embeddings ALTER COLUMN embeddings TYPE vector(1024);
```

(Thay `1024` bằng dimension tương ứng của model, xem bảng bên dưới)

#### Bước 3 — Xóa embeddings cũ và cập nhật vector dimension

```bash
# Xóa toàn bộ embeddings cũ (bắt buộc vì dimension khác nhau)
docker exec lobe-postgres psql -U postgres -d lobechat -c "DELETE FROM embeddings;"

# Cập nhật vector dimension (thay 1024 bằng dimension của model mới)
docker exec lobe-postgres psql -U postgres -d lobechat -c "ALTER TABLE embeddings ALTER COLUMN embeddings TYPE vector(1024);"
```

#### Bước 4 — Restart services

```bash
docker compose down
docker compose up -d
```

Sau đó vào LobeChat → Knowledge Base → upload lại file hoặc nhấn **Re-vectorize** để tạo embeddings mới.

#### Bảng model Embedding phổ biến trên Ollama

| Model | Vector Dimension | Kích thước | Ghi chú |
|-------|:----------------:|-----------|---------|
| `nomic-embed-text` | **768** | 274 MB | ✅ Model mặc định, cân bằng tốt |
| `mxbai-embed-large` | **1024** | 670 MB | Chất lượng cao hơn |
| `snowflake-arctic-embed` | **1024** | 670 MB | Tốt cho search |
| `all-minilm` | **384** | 45 MB | Rất nhẹ, phù hợp máy yếu |
| `bge-m3` | **1024** | 1.2 GB | Đa ngôn ngữ, tốt cho tiếng Việt |
| `bge-large` | **1024** | 670 MB | BAAI, chất lượng cao |

> ⚠️ **Quan trọng**: Mỗi model embedding có vector dimension khác nhau. Khi đổi model, **bắt buộc** phải cập nhật dimension trong database và xóa embeddings cũ, nếu không sẽ gặp lỗi.

---

### ☁️ Sử dụng Model AI từ Cloud (OpenAI, Google, v.v.)

Ngoài Ollama (chạy local), bạn có thể dùng các API cloud:

#### OpenAI (GPT-4, GPT-4o, ...)

1. Lấy API key tại https://platform.openai.com/api-keys
2. Sửa `docker-compose.yml`, phần `lobechat` → `environment`:

```yaml
OPENAI_API_KEY: "sk-xxxxxxxxxxxxxxxxxxxxxxxx"    # ← API key thật
OPENAI_PROXY_URL: "https://api.openai.com/v1"    # ← URL chính thức của OpenAI
```

3. Restart:

```bash
docker compose down
docker compose up -d
```

4. Trong LobeChat UI → Settings → Language Model → **OpenAI** → chọn model (gpt-4o, gpt-4o-mini, ...)

#### OpenAI Embedding (thay thế Ollama embedding)

Sửa `docker-compose.yml`:

```yaml
EMBEDDING_MODEL_PROVIDER: "openai"
DEFAULT_EMBEDDING_MODEL: "text-embedding-3-small"
OPENAI_API_KEY: "sk-xxxxxxxxxxxxxxxxxxxxxxxx"
OPENAI_PROXY_URL: "https://api.openai.com/v1"
```

Dimension phổ biến cho OpenAI embedding:

| Model | Vector Dimension |
|-------|:----------------:|
| `text-embedding-3-small` | **1536** |
| `text-embedding-3-large` | **3072** |
| `text-embedding-ada-002` | **1536** |

Sau đó cập nhật dimension trong database và restart (tương tự Bước 3 & 4 ở trên).

#### Google Gemini

1. Lấy API key tại https://aistudio.google.com/apikey
2. Trong LobeChat UI → Settings → Language Model → **Google** → nhập API key
3. Chọn model (gemini-pro, gemini-1.5-pro, ...)

#### Các provider khác

LobeChat hỗ trợ nhiều provider khác có thể cấu hình trực tiếp trong UI:
- **Anthropic** (Claude)
- **Azure OpenAI**
- **Groq**
- **Perplexity**
- **Mistral AI**
- **Together AI**
- **OpenRouter** (truy cập nhiều model qua 1 API)

Vào Settings → Language Model → chọn provider → nhập API key tương ứng.

---

### 🌐 Sử dụng trên mạng LAN

Thay `localhost` trong các biến `APP_URL`, `NEXTAUTH_URL`, redirect URIs bằng IP máy chủ.
Cập nhật hosts file trên các máy client.
