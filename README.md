# LobeChat Self-Hosted (Docker + Ollama)


LobeChat là **nền tảng chat AI mã nguồn mở** (giống ChatGPT nhưng tự host), cho phép:

* **Chat với AI** — dùng bất kỳ model nào (Ollama local, OpenAI, Claude, Gemini...) qua giao diện web đẹp
* **Knowledge Base (RAG)** — upload PDF/Word/TXT, AI đọc hiểu nội dung và trả lời dựa trên tài liệu của bạn
* **Multi-model** — dùng nhiều model cùng lúc, so sánh kết quả, chọn model phù hợp cho từng task
* **Plugin system** — mở rộng khả năng AI (tìm kiếm web, vẽ ảnh, chạy code, gọi API...)
* **Đa người dùng** — mỗi người có tài khoản riêng, dữ liệu riêng, lịch sử chat riêng
* **Tạo Assistant tùy chỉnh** — thiết kế chatbot với system prompt riêng, gắn tool/plugin riêng, gắn Knowledge Base riêng

 **Tóm lại** : LobeChat hẫu trợ UI cho người dùng sử các model AI khác nhau hoặc sử dụng với tài liệu cá nhân

**LobeChat là "chat UI", không phải "agent framework"** . Mỗi assistant trong LobeChat hoạt động  **độc lập** , người dùng phải chủ động chọn và nói chuyện với từng assistant.

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
ollama pull bge-m3
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
→ Đảm bảo model `bge-m3` đã được pull

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

| Model            | Kích thước | RAM tối thiểu | Ghi chú                                              |
| ---------------- | ------------- | --------------- | ----------------------------------------------------- |
| `llama3.1`     | 4.7 GB        | 8 GB            | Model mặc định, cân bằng tốc độ/chất lượng |
| `llama3.1:70b` | 40 GB         | 48 GB           | Chất lượng cao, cần GPU mạnh                     |
| `gemma2`       | 5.4 GB        | 8 GB            | Google, tốt cho tiếng Anh                           |
| `mistral`      | 4.1 GB        | 8 GB            | Nhanh, nhẹ                                           |
| `phi3`         | 2.2 GB        | 4 GB            | Microsoft, rất nhẹ                                  |
| `qwen2`        | 4.4 GB        | 8 GB            | Alibaba, hỗ trợ tiếng Trung tốt                   |
| `deepseek-r1`  | 4.7 GB        | 8 GB            | Tốt cho reasoning/lập trình                        |
| `codellama`    | 3.8 GB        | 8 GB            | Chuyên cho code                                      |

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
# Ollama - Embedding (format: embedding_model=provider/model)
DEFAULT_FILES_CONFIG: "embedding_model=ollama/mxbai-embed-large"    # ← đổi model ở đây
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

| Model                      | Vector Dimension | Kích thước | Ghi chú                                                    |
| -------------------------- | :--------------: | ------------- | ----------------------------------------------------------- |
| `nomic-embed-text`       |  **768**  | 274 MB        | Cân bằng tốt                                             |
| `mxbai-embed-large`      |  **1024**  | 670 MB        | Chất lượng cao hơn                                      |
| `snowflake-arctic-embed` |  **1024**  | 670 MB        | Tốt cho search                                             |
| `all-minilm`             |  **384**  | 45 MB         | Rất nhẹ, phù hợp máy yếu                              |
| `bge-m3`                 |  **1024**  | 1.2 GB        | ✅ Model mặc định, đa ngôn ngữ, tốt cho tiếng Việt |
| `bge-large`              |  **1024**  | 670 MB        | BAAI, chất lượng cao                                     |

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
# Dùng OpenAI embedding thay Ollama
DEFAULT_FILES_CONFIG: "embedding_model=openai/text-embedding-3-small"
OPENAI_API_KEY: "sk-xxxxxxxxxxxxxxxxxxxxxxxx"
OPENAI_PROXY_URL: "https://api.openai.com/v1"
```

Dimension phổ biến cho OpenAI embedding:

| Model                      | Vector Dimension |
| -------------------------- | :--------------: |
| `text-embedding-3-small` |  **1536**  |
| `text-embedding-3-large` |  **3072**  |
| `text-embedding-ada-002` |  **1536**  |

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

### 🌐 Hướng dẫn cấu hình Ollama: Local vs Mạng LAN

Dự án hỗ trợ 2 chế độ kết nối Ollama:

| Chế độ               | Mô tả                                            | OLLAMA_PROXY_URL                      |
| ----------------------- | -------------------------------------------------- | ------------------------------------- |
| **Local**         | Ollama chạy trên cùng máy với Docker          | `http://host.docker.internal:11434` |
| **Network (LAN)** | Ollama chạy trên máy khác trong mạng nội bộ | `http://<IP_MÁY_OLLAMA>:11434`     |

---

#### Chế độ 1: Ollama chạy LOCAL (cùng máy với Docker)

> Dùng khi bạn cài Docker Desktop + Ollama **trên cùng một máy tính**.

##### Bước 1 — Cài đặt Ollama trên máy local

1. Tải và cài Ollama: https://ollama.com/download
2. Pull model cần thiết:

```bash
ollama pull bge-m3
ollama pull llama3.1
ollama create text-embedding-3-small -f Modelfile-embedding
```

3. Kiểm tra Ollama đang chạy:

```bash
ollama list
# Hoặc thử gọi API
curl http://localhost:11434/api/tags
```

##### Bước 2 — Cấu hình `docker-compose.yml`

Mở `docker-compose.yml`, tìm phần `lobechat` → `environment`, sửa thành:

```yaml
      # Ollama - LLM
      ENABLED_OLLAMA: "1"
      OLLAMA_PROXY_URL: "http://host.docker.internal:11434"

      # Ollama - Embedding
      DEFAULT_FILES_CONFIG: "embedding_model=ollama/bge-m3"

      # OpenAI proxy -> Ollama
      OPENAI_API_KEY: "ollama"
      OPENAI_PROXY_URL: "http://host.docker.internal:11434/v1"
```

> 💡 `host.docker.internal` là DNS đặc biệt của Docker Desktop, cho phép container truy cập vào services trên máy host (Windows/macOS). Trên Linux, xem ghi chú bên dưới.

##### Bước 3 — Thêm hosts & Khởi động

```bash
# Thêm hosts (chạy as Administrator trên Windows)
# Mở C:\Windows\System32\drivers\etc\hosts, thêm:
# 127.0.0.1 logto
# 127.0.0.1 minio

# Khởi động
docker compose up -d
```

##### Ghi chú cho Linux

Trên Linux, `host.docker.internal` có thể không hoạt động mặc định. Thêm `extra_hosts` vào service `lobechat` trong `docker-compose.yml`:

```yaml
  lobechat:
    image: lobehub/lobe-chat-database:latest
    extra_hosts:
      - "host.docker.internal:host-gateway"
    # ... (giữ nguyên phần còn lại)
```

Hoặc đơn giản hơn, sử dụng `--network host` hoặc dùng IP máy (xem Chế độ 2).

---

#### Chế độ 2: Ollama chạy trên MÁY KHÁC trong mạng LAN

> Dùng khi Ollama chạy trên một máy riêng , còn Docker LobeChat chạy trên máy khác.

##### Bước 1 — Cấu hình `docker-compose.yml` trên MÁY A

Mở `docker-compose.yml`, tìm phần `lobechat` → `environment`, sửa thành:

```yaml
      # Ollama - LLM (thay IP bằng IP thực của máy chạy Ollama)
      ENABLED_OLLAMA: "1"
      OLLAMA_PROXY_URL: "http://192.168.x.20:11434"

      # Ollama - Embedding
      DEFAULT_FILES_CONFIG: "embedding_model=ollama/bge-m3"

      # OpenAI proxy -> Ollama
      OPENAI_API_KEY: "ollama"
      OPENAI_PROXY_URL: "http://192.168.x.20:11434/v1"
```

> ⚠️ Thay `192.168.x.20` bằng **IP thực** của máy chạy Ollama. Tìm IP bằng lệnh `ipconfig` (Windows) hoặc `ip addr` (Linux).

##### Bước 2 — Thêm hosts & Khởi động trên MÁY A

```bash
# Thêm hosts (chạy as Administrator trên Windows)
# Mở C:\Windows\System32\drivers\etc\hosts, thêm:
# 127.0.0.1 logto
# 127.0.0.1 minio

# Khởi động
docker compose up -d
```

##### Bước 3 — Kiểm tra kết nối

```bash
# Xem logs LobeChat
docker logs lobe-chat --tail 30

# Test gọi Ollama từ trong container
docker exec lobe-chat curl -s http://192.168.x.20:11434/api/tags
```

---

#### So sánh 2 chế độ

|                              | Local (`host.docker.internal`)                    | Network (IP LAN)                                      |
| ---------------------------- | --------------------------------------------------- | ----------------------------------------------------- |
| **Ưu điểm**         | Đơn giản, chỉ cần 1 máy                       | Tận dụng GPU máy mạnh, nhiều người dùng chung |
| **Nhược điểm**     | Máy cần đủ mạnh để chạy cả Docker + Ollama | Cần cấu hình mạng, firewall                       |
| **Phù hợp**          | Cá nhân, demo, dev                                | Team, production, máy GPU riêng                     |
| **Cần firewall rule** | Không                                              | Có (mở port 11434 trên máy Ollama)                |

---

#### Khắc phục lỗi kết nối Ollama

| Triệu chứng                  | Nguyên nhân                    | Cách sửa                                           |
| ------------------------------ | -------------------------------- | ---------------------------------------------------- |
| `connection refused` (local) | Ollama chưa chạy               | Mở app Ollama hoặc chạy `ollama serve`          |
| `connection refused` (LAN)   | Ollama chỉ listen localhost     | Đặt `OLLAMA_HOST=0.0.0.0` rồi restart Ollama    |
| `connection refused` (LAN)   | Firewall chặn port              | Mở port 11434 trên firewall máy Ollama            |
| `timeout` (LAN)              | Sai IP hoặc không cùng subnet | Kiểm tra `ping <IP_OLLAMA>` từ máy Docker       |
| `model not found`            | Chưa pull model                 | Chạy `ollama pull <tên_model>` trên máy Ollama |
| Embedding lỗi dimension       | Model embedding khác dimension  | Xem mục "Đổi Model Embedding" ở trên            |

**Kiểm tra nhanh kết nối:**

```bash
# Từ máy Docker host
curl http://<IP_OLLAMA>:11434/api/tags

# Từ bên trong container LobeChat
docker exec lobe-chat curl -s http://<IP_OLLAMA>:11434/api/tags
```

---

### 🌐 Cho phép truy cập LobeChat từ mạng LAN

Mặc định LobeChat chỉ truy cập được từ `http://localhost:3210`. Để các máy khác trong LAN cũng truy cập được:

##### Bước 1 — Sửa `docker-compose.yml`

Thay `localhost` bằng **IP máy chạy Docker**:

```yaml
      APP_URL: "http://192.168.x.10:3210"
      NEXTAUTH_URL: "http://192.168.x.10:3210/api/auth"
```

##### Bước 2 — Sửa `init-logto.sql`

Cập nhật redirect URI:

```sql
'{"redirectUris":["http://192.168.x.10:3210/api/auth/callback/logto"],"postLogoutRedirectUris":["http://192.168.x.10:3210/"]}'
```

##### Bước 3 — Cập nhật Logto endpoint

Trong `docker-compose.yml`, phần `logto` → `environment`:

```yaml
      ENDPOINT: "http://192.168.x.10:3002"
      ADMIN_ENDPOINT: "http://192.168.x.10:3001"
```

Và phần `lobechat` → `environment`:

```yaml
      AUTH_LOGTO_ISSUER: "http://192.168.x.10:3002/oidc"
```

##### Bước 4 — Cập nhật hosts trên MÁY CLIENT

Trên mỗi máy muốn truy cập, thêm vào hosts file:

```
192.168.x.10 logto
192.168.x.10 minio
```

##### Bước 5 — Restart

```bash
docker compose down
docker compose up -d
# Chạy lại init-logto nếu đã đổi redirect URI
docker compose up -d logto-init
```

Sau đó truy cập `http://192.168.x.10:3210` từ các máy trong LAN.
