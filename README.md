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

### Đổi model LLM

Trong LobeChat UI: Settings > Model Provider > chọn model Ollama khác.

### Đổi model Embedding

Sửa `DEFAULT_EMBEDDING_MODEL` trong `docker-compose.yml`.
**Lưu ý**: Nếu đổi model embedding, cần xóa embeddings cũ và re-vectorize:

```sql
docker exec lobe-postgres psql -U postgres -d lobechat -c "DELETE FROM embeddings;"
```

Và cập nhật vector dimension cho phù hợp.

### Sử dụng trên mạng LAN

Thay `localhost` trong các biến `APP_URL`, `NEXTAUTH_URL`, redirect URIs bằng IP máy chủ.
Cập nhật hosts file trên các máy client.
