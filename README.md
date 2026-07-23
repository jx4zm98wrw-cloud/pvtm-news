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
| `api/telegram.mjs` | Webhook Vercel: bot vào nhóm → gửi tin 7 ngày qua |

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

- **Cảnh báo định kỳ** (`monitor.mjs`): seen-diff theo `key` → mỗi tin gửi **đúng 1 lần**, gom theo nhóm.
- **Lời chào** (`api/telegram.mjs`, khi bot vào nhóm): tin trong **30 ngày gần nhất, tối đa 8** (chỉnh qua env `WELCOME_DAYS`/`WELCOME_CAP`); nếu trống → tin gần nhất + ghi chú. Không dùng "số cố định" nên tin cũ không bị kéo vào.
- **Telegram:** header `📡 PVTM Radar · …`; mỗi tin **đánh số + tiêu đề là link** (chạm thẳng tiêu đề để mở — không có nút số phải đếm); một nút `Tất cả tin ↗`; văn bản D có `⬇`.
- **Email:** subject `PVTM Radar · <tin nổi bật>… (+N tin)` (thương hiệu dẫn đầu + cắt theo ranh giới từ, hàm `buildSubject`); thân email newsletter navy/vàng đồng, gom theo nhóm, tóm tắt cho A/B, nút "Tải văn bản" cho D.
- **Nhận diện:** cả hai kênh mở đầu bằng thương hiệu **PVTM Radar** (📡 ở Telegram, măng-sét ở email).

## Cấu hình (env — xem `.env.example`)

| Kênh | Biến |
|------|------|
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (phẩy = nhiều chat; `_2`/`_3` = thêm bot) |
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_TO`, `MAIL_FROM` |
| Webhook | `WEBHOOK_SECRET` (khớp giữa Vercel ↔ setWebhook) |

## Trạng thái (`seen.json`)

```json
{ "version": 2, "seenKeys": ["<id hoặc Số ký hiệu>"], "updatedAt": "…" }
```

`version` đổi khi schema nguồn đổi → state cũ (v1) được **seed lại im lặng**, tránh dội toàn bộ catalogue như "tin mới".

## Deploy

- **Cảnh báo định kỳ:** GitHub Actions (`.github/workflows/monitor.yml`), `seen.json` trong Actions cache.
- **Webhook lời chào:** Vercel (`api/telegram.mjs`), stateless. Đăng ký: `node set-webhook.mjs https://<app>.vercel.app/api/telegram`.

## Việc còn lại / hạn chế

- Nhóm C giới hạn **25 bản tin gần nhất/danh mục** (kho lưu trữ nhiều năm; chỉ tin gần đây mới có ý nghĩa cảnh báo).
- Selector gắn với HTML hiện tại của site; nếu site đổi giao diện, cập nhật parser trong `scraper.mjs`.
