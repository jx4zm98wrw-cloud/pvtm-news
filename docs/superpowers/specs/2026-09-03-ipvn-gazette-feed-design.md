# Thiết kế: Feed "Công báo Sở hữu công nghiệp" (ipvietnam.gov.vn)

- **Ngày:** 2026-09-03
- **Trạng thái:** Đã duyệt + **chốt 3 lựa chọn (theo khuyến nghị)**. chat_id nhóm IP đã cắm secret `TELEGRAM_CHAT_ID_IPVN`. Sẵn sàng lập kế hoạch triển khai
- **Lựa chọn đã chốt:** ① cảnh báo guard #1 gửi **vào chính nhóm IP** · ② **Telegram + Email** (email BẬT — 2026-09-08, "Hợp lý, chốt phương án này" — chốt mẫu email, triển khai email cho feed IP; bật qua `MAIL_TO_IPVN`, dùng lại SMTP pvtm, không fallback về `MAIL_TO`; guard #1 vẫn Telegram-only) · ③ link trỏ **trang chi tiết**
- **Repo:** pvtm-news (thêm feed mới, cách ly với đường pvtm hiện có)
- **Nguồn:** https://www.ipvietnam.gov.vn/cong-bao-so-huu-cong-nghiep1

## 1. Mục tiêu

Cảnh báo khi Cục Sở hữu trí tuệ đăng **công báo SHCN mới** (bảng "Số / Ngày xuất bản",
~2 số/tháng). Gửi cho **nhóm người nhận riêng** (đội IP), tách khỏi feed phòng vệ
thương mại (pvtm) đang chạy.

## 2. Quyết định thiết kế (chốt từ brainstorming)

| # | Quyết định |
|---|---|
| Kiến trúc | **Chung repo, feed độc lập.** KHÔNG sửa hành vi `scraper.mjs`/`messages.mjs`/`monitor.mjs` của pvtm |
| Người nhận | **Riêng** — không dùng chung người nhận pvtm |
| Kênh | Telegram (bot hiện tại, **chat riêng**) + Email **tùy chọn** (SMTP Resend hiện tại, list riêng) |
| Định danh | **Số công báo** (`Số 465` → `"465"`) — ổn định tuyệt đối |
| SSL | **Tắt verify chỉ cho host `ipvietnam.gov.vn`** qua `https.Agent` phạm vi hẹp (site thiếu cert trung gian) |

## 3. Kiến trúc

### File mới (không đụng file pvtm)
- **`ipvn.mjs`** — scraper: tải bảng công báo qua `https.Agent` (bỏ verify riêng host),
  parse mỗi dòng → `{ key, title, dateISO, url }`. Xuất hàm thuần để test.
- **`monitor-ipvn.mjs`** — vòng seen-diff riêng cho feed IP; **import lại `notify.mjs`**;
  state riêng `seen-ipvn.json`; hỗ trợ `--once` như monitor pvtm.

### File dùng lại (chỉ mở rộng an toàn)
- **`messages-ipvn.mjs`** — thêm 3 hàm thuần cho email: `buildGazetteSubject`,
  `buildGazettePlainText`, `buildGazetteEmail` (bảng + inline style, măng-sét
  📕 riêng — nền `#EEE8E0`, gold `#C6A56E`, CTA `#7E5058`, cố ý khác navy/gold
  PVTM Radar dù chung SMTP).
- **`notify.mjs`** — thêm **hàm mới** `notifyEmailTo(items, opts, { mailToEnv })`
  (định tuyến email theo route chỉ định, đọc **chỉ** `mailToEnv`, không
  fallback về `MAIL_TO`); default = hành vi hiện tại → đường pvtm **không đổi
  một byte** (test pvtm vẫn xanh).

### Item schema (từ scraper)
```
{ key: "465",                       // số công báo (chuỗi)
  title: "Số 465 ngày 17 tháng 08 năm 2026",
  dateISO: "2026-08-17",            // từ CỘT "Ngày xuất bản" (DD/MM/YYYY → YYYY-MM-DD)
  url: "https://www.ipvietnam.gov.vn/.../so-465-..." }
```

### State `seen-ipvn.json`
```json
{
  "version": 1,
  "seen": {
    "465": { "title": "Số 465 ngày 17 tháng 08 năm 2026",
             "dateISO": "2026-08-17",
             "firstSeenAt": "2026-09-03T04:00:00.000Z" }
  },
  "degraded": false,
  "updatedAt": "…"
}
```
- `version` đổi → seed lại **im lặng** (không dội số cũ).
- `firstSeenAt`: mốc bot phát hiện (null cho item có sẵn lúc seed).
- `degraded`: cờ trạng thái "feed nghi hỏng" phục vụ hardening #1 (chống spam cảnh báo).

### Nội dung tin
Măng-sét **`📕 Công báo Sở hữu công nghiệp`** (khác `📡 PVTM Radar` để nhận diện dù chung bot).
Mỗi số: `Số 465 · 17/08/2026`, tiêu đề là **link trang danh mục** (xem §8: href chi tiết của site lệch số nên không dùng được).

## 4. Hardening (bắt buộc — đã duyệt)

### #1 — Guard cấu trúc + tự cảnh báo (chống lỗi im lặng)
Sau mỗi lần quét, kiểm tra: (a) parse được **≥ 1 dòng**, (b) có **≥ 1 số công báo** hợp lệ,
(c) số mới nhất **≥** số lớn nhất đã lưu (không "tụt lùi" bất thường).
- Nếu FAIL: **không** ghi state; **log lỗi rõ**; và nếu `degraded` đang `false` → **gửi 1 cảnh báo**
  "⚠️ Feed công báo SHCN có thể đã hỏng (quét ra 0 dòng / không đọc được cấu trúc)" tới người
  nhận IP, rồi đặt `degraded=true`. Khi quét lại bình thường → gửi "✅ feed khôi phục", đặt lại `false`.
- Chống spam: chỉ cảnh báo **khi chuyển trạng thái** (healthy↔broken), không lặp mỗi 30 phút.
- Lý do: dead-man's-switch KHÔNG bắt được ca này (job vẫn success với 0 tin).

### #2 — Parse số & ngày tách biệt, không im lặng bỏ dòng
- Số: regex khoan dung `S[oố]\s*(\d+)`; Ngày: lấy từ **cột "Ngày xuất bản"** (DD/MM/YYYY chuẩn),
  KHÔNG parse ngày từ tiêu đề (tiêu đề không nhất quán: "Số 465 ngày 17 tháng 08" vs "Số 457 tháng 04").
- Dòng không parse được số → **log cảnh báo từng dòng** (không nuốt lặng). Nếu **mọi** dòng đều hỏng
  → tính là FAIL cấu trúc (#1).

### #3 — Trích link theo từng dòng + đối chiếu số
- Lấy `href` từ **chính thẻ `<a>` của dòng đó**, không theo vị trí lân cận.
- Đối chiếu số trong nhãn vs số trong slug URL; **lệch → log cảnh báo** (vẫn gửi nhưng ghi dấu),
  vì đã quan sát ca nhãn "465" trỏ slug "464".

### #4 — Cách ly workflow (không kéo pvtm chết theo)
- Thêm step IP vào `monitor.yml` với **`continue-on-error: true`** — step IP fail KHÔNG làm job đỏ,
  nên step "liveness ping" (`if: success()`) vẫn chạy → **không có dead-man's giả**.
- **Cache tách namespace:** key `ipvn-seen-…` (không dùng prefix `pvtm-seen-`) để không restore nhầm
  state của nhau. Hai step cache độc lập trong cùng workflow.

### #5 — Định tuyến không fallback
- Feed IP đọc **chỉ** `TELEGRAM_CHAT_ID_IPVN` / `MAIL_TO_IPVN`. Thiếu → **skip có log**
  ("IPVN feed: no recipients — skipping"), **TUYỆT ĐỐI không** mượn chat/email của pvtm.
- `notify.mjs` chỉ thêm tham số tùy chọn (default an toàn) → pvtm không đổi hành vi. Test pvtm phải vẫn xanh.

## 5. Triển khai

- **`monitor.yml`:** thêm 1 step `node monitor-ipvn.mjs --once` (sau step pvtm, `continue-on-error: true`)
  + 1 cặp cache restore/save cho `seen-ipvn.json` (key `ipvn-seen-…`). Step nhận thêm
  `SMTP_HOST/PORT/SECURE/USER/PASS`, `MAIL_FROM`, `MAIL_TO_IPVN` (cùng bộ secret SMTP pvtm
  đã dùng, cộng secret nhận email riêng cho IP). Dùng chung trigger cron-job.org mỗi 30' —
  **không cần cron/PAT/secret trigger mới**. Dead-man's-switch hiện có bao trùm.
- **Secret mới (người dùng tự đặt):** `TELEGRAM_CHAT_ID_IPVN` (bắt buộc để bật Telegram),
  `MAIL_TO_IPVN` (bắt buộc để bật email — **đã bật** 2026-09-08). Bot token + SMTP dùng lại của pvtm.

## 6. Việc người dùng phải tự làm
1. ✅ Tạo nhóm Telegram cho đội IP + thêm bot, lấy chat_id `-1004421463435` (supergroup). **(xong)**
2. ✅ Secret `TELEGRAM_CHAT_ID_IPVN` đã đặt (2026-09-04, qua stdin — không lộ giá trị).
   `MAIL_TO_IPVN`: cần đặt secret này (giá trị = danh sách email đội IP, phẩy) để bật email —
   **email đã triển khai code (2026-09-08)**, chỉ chờ secret để kích hoạt trên production.
   *(Claude không tự tạo nhóm; secret set qua stdin, không in giá trị.)*

## 7. Test (`test/ipvn.test.mjs`)
- Parse số + ngày: cả 2 định dạng tiêu đề; ngày lấy từ cột.
- Trích link theo dòng; ca lệch số nhãn↔slug.
- Guard cấu trúc: 0 dòng → FAIL; toàn bộ dòng hỏng → FAIL.
- Chuyển trạng thái `degraded` (healthy→broken→healthy) chỉ cảnh báo khi đổi.
- Seed im lặng lần đầu (không gửi).
- notify.mjs: xác nhận đường pvtm không đổi hành vi.

## 8. Rủi ro chấp nhận (mức thấp)
- **MITM tạo tin giả** (do tắt verify SSL host này): chỉ đọc dữ liệu công khai, không lộ bí mật;
  guard #1 đỡ phần cấu trúc.
- **Site fix cert / đổi domain / chặn bot / trả trang challenge:** rơi về FAIL cấu trúc → guard #1 cảnh báo.
- **Cache GitHub bị evict:** mất `firstSeenAt`, nhưng seed im lặng → không spam.
- **Link Liferay mục nát theo thời gian:** chỉ ảnh hưởng link cũ, không ảnh hưởng tin mới.
- **Href chi tiết lệch số (phát hiện lúc kích hoạt 2026-09-08):** anchor mỗi dòng trên site ghi "Số N" nhưng href trỏ trang `so-(N-1)` — lệch một số trên **mọi** dòng (guard #3 bắt được). Do đó `parseGazette` **không** dùng href từng dòng; `url = SOURCE_URL` (trang danh mục). Số + ngày trong tiêu đề là định danh tin cậy. Trường `numberMismatch` đã bỏ (không còn cần vì không tin href).

## 9. Ngoài phạm vi (YAGNI)
- Tải/đính kèm PDF trực tiếp (trang liệt kê chỉ trỏ trang chi tiết — gửi link là đủ).
- Webhook welcome/`/id` riêng cho feed IP (dùng lại cơ chế `/id` của bot hiện tại).
- Bảng `--stats` độ trễ cho feed IP (có `firstSeenAt` để làm sau nếu cần).
- Backport guard #1 sang pvtm — đề xuất riêng sau khi feed IP chạy ổn.
