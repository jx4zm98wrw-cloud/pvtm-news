# pvtm-news

Theo dõi tin từ **[pvtm.gov.vn](https://pvtm.gov.vn)** (Cục Phòng vệ Thương mại) và
gửi cảnh báo qua **Telegram + Email**, gom theo nhóm ưu tiên và chỉ báo tin mới.

## Kiến trúc (tách lớp)

| File | Vai trò |
|------|---------|
| `scraper.mjs` | Lấy dữ liệu: đa nguồn theo danh mục, gắn nhóm, sắp xếp, cửa sổ thời gian |
| `messages.mjs` | Dựng tin nhắn (thuần): Telegram (số + link tiêu đề) + email newsletter; subject thương hiệu (`buildSubject`) |
| `notify.mjs` | Gửi: Telegram (đa đích) + Email (SMTP), kích hoạt theo env |
| `monitor.mjs` | Cảnh báo định kỳ: diff theo `seen.json`, chỉ báo tin mới |
| `api/telegram.mjs` | Webhook Vercel: bot vào nhóm → gửi tin 30 ngày qua; lệnh `/id` trả chat_id |

## Nhóm & ưu tiên (A → B → C → D)

| Nhóm | Nhãn | Nguồn | Trạng thái |
|------|------|-------|------------|
| A | ⚖️ Tin điều tra | `page=news&do=browse` (thẻ) | ✅ |
| B | 📌 Tin chung | `page=news&do=browse` (thẻ) | ✅ |
| C | 📰 Ấn phẩm | `page=newsletter` (bảng riêng) | ✅ định danh = `file guid`, link tải trực tiếp (25 bản gần nhất/danh mục) |
| D | 📄 Văn bản | `page=legal` (bảng, `a.doc-table__title`) | ✅ định danh = `Số ký hiệu` |

- **Ưu tiên chỉ ảnh hưởng thứ tự hiển thị** (gom A→B→C→D). *Chọn* tin theo **ngày mới nhất** (lọc-trước-chọn-sau, không lỗ hổng).
- Nhóm D dùng `Số ký hiệu` làm định danh; văn bản không ngày (WTO) xếp cuối. Link D trỏ về trang danh mục (nút "Tải về" trên site là JS, không có URL tĩnh).

## Cài đặt & chạy

```bash
npm install
node index.mjs            # liệt kê theo nhóm, ghi news.json
node monitor.mjs --once   # 1 lần (cron/GitHub Actions)
node monitor.mjs --every 30
```

## Hai loại tin nhắn

- **Cảnh báo định kỳ** (`monitor.mjs`): seen-diff theo `key` → mỗi tin gửi **đúng 1 lần**; nếu site **đổi tiêu đề** của cùng `key` thì gửi lại bản **🔄 cập nhật**. Gom theo nhóm.
- **Lời chào** (`api/telegram.mjs`, khi bot vào nhóm): tin trong **30 ngày gần nhất, tối đa 8** (chỉnh qua env `WELCOME_DAYS`/`WELCOME_CAP`); nếu trống → tin gần nhất + ghi chú. Không dùng "số cố định" nên tin cũ không bị kéo vào.
- **Telegram:** header `📡 PVTM Radar · …`; mỗi tin **đánh số + tiêu đề là link** (chạm thẳng tiêu đề để mở — không có nút số phải đếm); một nút `Tất cả tin ↗`; văn bản D có `⬇`.
- **Email:** subject `PVTM Radar · <tin nổi bật>… (+N tin)` (thương hiệu dẫn đầu + cắt theo ranh giới từ, hàm `buildSubject`); thân email newsletter navy/vàng đồng, gom theo nhóm, tóm tắt cho A/B, nút "Tải văn bản" cho D.
- **Nhận diện:** cả hai kênh mở đầu bằng thương hiệu **PVTM Radar** (📡 ở Telegram, măng-sét ở email).
- **Ngày trên tiêu đề** (`todayVN`) luôn tính theo **giờ Việt Nam** (`Asia/Ho_Chi_Minh`), không theo giờ runner (GitHub Actions chạy UTC). Chỉ để **hiển thị** — không dùng để lọc hay so khớp `seen`.

## Cấu hình (env — xem `.env.example`)

| Kênh | Biến |
|------|------|
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (phẩy = nhiều chat; `_2`/`_3` = thêm bot) |
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_TO`, `MAIL_FROM`, `MAIL_BCC` (danh sách ẩn, phẩy) |
| Webhook | `WEBHOOK_SECRET` (khớp giữa Vercel ↔ setWebhook) |

## Trạng thái (`seen.json`)

```json
{ "version": 4, "seen": { "<id hoặc Số ký hiệu>": "<tiêu đề đã thấy>" }, "updatedAt": "…" }
```

`version` (hiện `4`) đổi khi schema đổi → state cũ (khác version) được **seed lại im lặng**, tránh dội toàn bộ catalogue như "tin mới". Từ **v4** lưu **tiêu đề theo từng key**: nếu site **đổi tiêu đề** của một tin đã thấy (vd bài clone-rồi-đổi-tên, ban đầu hiện dưới tiêu đề tạm), monitor gửi lại một cảnh báo **🔄 cập nhật** với tiêu đề mới.

## Deploy

- **Cảnh báo định kỳ:** GitHub Actions (`.github/workflows/monitor.yml`), `seen.json` trong Actions cache.
  - **Repo để public** → Actions **miễn phí, không giới hạn phút**. (Private repo tính phút và có
    thể bị chặn nếu thanh toán lỗi / chạm spending limit — đó là lý do chuyển sang public.) Secrets
    vẫn **riêng tư** kể cả khi repo public; workflow chỉ `workflow_dispatch` nên PR từ fork không
    lấy được secret. Muốn về private: sửa Billing trên GitHub rồi `gh repo edit --visibility private`.
  - **Kích hoạt:** **chỉ** bằng **cron ngoài** (cron-job.org) gọi `workflow_dispatch` mỗi 30 phút.
    Lịch `schedule` trong workflow đã **gỡ bỏ** — GitHub chạy `schedule` best-effort, bỏ phần
    lớn nhịp khi tải cao (quan sát khoảng trống tới ~3h). Vì `monitor` dùng seen-diff nên nhịp
    rơi chỉ làm **trễ**, không **mất** tin.
    ⚠️ **Không còn dự phòng:** nếu cron ngoài ngừng, không gì tự kích workflow. Muốn khôi phục
    lưới an toàn → thêm lại khối `schedule:` vào `on:` trong `monitor.yml`.
  - **Thiết lập cron ngoài** (một lần):
    1. Tạo **fine-grained PAT** (github.com → Settings → Developer settings → Fine-grained
       tokens): chỉ repo `pvtm-news`, quyền **Actions: Read and write**, hạn dài (vd 1 năm).
    2. cron-job.org → tạo job:
       - URL: `https://api.github.com/repos/jx4zm98wrw-cloud/pvtm-news/actions/workflows/monitor.yml/dispatches`
       - Method `POST`; Schedule `*/30 * * * *`
       - Headers: `Authorization: Bearer <PAT>`, `Accept: application/vnd.github+json`,
         `Content-Type: application/json`, `User-Agent: pvtm-cron`
       - Body: `{"ref":"main"}`
    3. Kỳ vọng HTTP **204 No Content** = đã kích. Xác minh: `gh run list` thấy các run
       `event=workflow_dispatch` cách nhau đều ~30 phút.
    - PAT chỉ nằm ở cron-job.org, **không** commit vào repo.
- **Webhook lời chào:** Vercel (`api/telegram.mjs`), stateless. Đăng ký: `node set-webhook.mjs https://<app>.vercel.app/api/telegram`.
- **Nhóm nhận cảnh báo định kỳ:** lời chào tự vào nhóm, nhưng cảnh báo tin mới (monitor)
  chỉ gửi tới `TELEGRAM_CHAT_ID`. Để nhóm cũng nhận: gõ **`/id`** trong nhóm → bot trả
  chat_id → thêm vào `TELEGRAM_CHAT_ID` (phẩy, cả GitHub secret lẫn `.env`). *(Tự động
  hoá cho mọi nhóm cần kho chat_id chung — xem "phương án B", chưa triển khai.)*

## Việc còn lại / hạn chế

- Nhóm C giới hạn **25 bản tin gần nhất/danh mục** (kho lưu trữ nhiều năm; chỉ tin gần đây mới có ý nghĩa cảnh báo).
- **Đổi tiêu đề & cảnh báo trông như trùng:** khử trùng lặp theo **`key` = article-id**, *cố ý* không theo tiêu đề.
  - **Cùng `key`, đổi tiêu đề** (bài clone-rồi-đổi-tên, ban đầu mang tiêu đề tạm) → gửi lại bản **🔄 cập nhật** với tiêu đề đúng (từ v4). *Ca đã gặp 31/07/2026: một bài AD24 xuất hiện dưới tiêu đề AD16 rồi được site đổi tên.*
  - **Hai `key` khác nhau, trùng tiêu đề** (đăng lại dưới id mới, hoặc đăng chéo nhiều danh mục) → vẫn gửi 2 lần: tiêu đề giống, **URL/nội dung khác**. False-positive hiếm và **an toàn hơn** khử theo tiêu đề (vốn có thể **bỏ sót** hai tin khác nhau tình cờ trùng tiêu đề).
  - Log của monitor in kèm `key` + `url` để soi lại từ Actions logs.
- **Nợ kỹ thuật (không khẩn):** `actions/checkout@v4`, `setup-node@v4`, `cache@v4` chạy trên Node 20 (đã deprecated, bị ép sang Node 24). Nâng lên `@v5` khi tiện.
- Selector gắn với HTML hiện tại của site; nếu site đổi giao diện, cập nhật parser trong `scraper.mjs`.
