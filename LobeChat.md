Update bản 13/3/2026 LobeChat hướng dẫn contact với các bên thứ 3 như Gitlab, Jira, Confluence

* **LobeChat có thể sử dụng model AI gọi hàm đến các bên thứ 3 và giúp tìm kiếm, đọc, giải thích các tài liệu có thể truy cập**
* **Truy cập qua plugin (Manifest) URL liên kết chéo, hướng dẫn file readme.md**

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
