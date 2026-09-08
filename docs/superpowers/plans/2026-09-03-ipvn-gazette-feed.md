# IPVN Gazette Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm feed cảnh báo "Công báo Sở hữu công nghiệp" (ipvietnam.gov.vn) vào repo pvtm-news, cách ly hoàn toàn với feed pvtm, gửi vào nhóm Telegram riêng của đội IP.

**Architecture:** Feed độc lập dùng chung đường ống. Scraper riêng (`ipvn.mjs`, bỏ verify SSL riêng host), message builder riêng (`messages-ipvn.mjs`, măng-sét 📕), monitor riêng (`monitor-ipvn.mjs`, state `seen-ipvn.json`). `notify.mjs` chỉ **thêm** một hàm gửi Telegram theo route chỉ định (pvtm không đổi hành vi). Chạy như 1 step `continue-on-error` trong `monitor.yml`.

**Tech Stack:** Node ≥20.6 ESM, `got`, `cheerio`, `node --test`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-03-ipvn-gazette-feed-design.md` (đã chốt: ① guard→nhóm IP · ② chỉ Telegram · ③ link trang chi tiết; secret `TELEGRAM_CHAT_ID_IPVN` đã đặt).

---

## File Structure

- Create `ipvn.mjs` — scraper thuần + fetch (SSL bypass). Trách nhiệm: HTML → items.
- Create `messages-ipvn.mjs` — dựng tin Telegram 📕 + tin cảnh báo degraded. Thuần.
- Create `monitor-ipvn.mjs` — seen-diff + guard #1/#2 + định tuyến. Entry `--once`.
- Modify `notify.mjs` — thêm export `notifyTelegramTo` + tách helper (giữ nguyên hành vi pvtm).
- Modify `messages.mjs` — export `escapeHtml`/`escapeAttr` (additive, để tái dùng).
- Modify `.github/workflows/monitor.yml` — thêm cache `seen-ipvn.json` + step chạy feed IP.
- Modify `README.md` — mục feed IP.
- Test: `test/ipvn.test.mjs`, `test/messages-ipvn.test.mjs`, `test/notify.test.mjs`.

---

## Task 1: notify.mjs — thêm route Telegram đơn, giữ nguyên pvtm

**Files:**
- Modify: `notify.mjs`
- Test: `test/notify.test.mjs` (Create)

- [ ] **Step 1: Viết test thất bại**

```js
// test/notify.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notifyTelegramTo } from '../notify.mjs';

test('notifyTelegramTo skips (no send) when its chatEnv is unset — no fallback', async () => {
  delete process.env.TELEGRAM_CHAT_ID_IPVN;
  process.env.TELEGRAM_BOT_TOKEN = 'x';
  const r = await notifyTelegramTo({ text: 'hi' }, { chatEnv: 'TELEGRAM_CHAT_ID_IPVN' });
  assert.equal(r.channel, 'telegram');
  assert.match(r.skipped, /TELEGRAM_CHAT_ID_IPVN/);
  assert.equal(r.sent, undefined);
  assert.equal(r.error, undefined);
});

test('notifyTelegramTo skips when token env is unset', async () => {
  process.env.TELEGRAM_CHAT_ID_IPVN = '-100123';
  delete process.env.TELEGRAM_BOT_TOKEN;
  const r = await notifyTelegramTo({ text: 'hi' }, { chatEnv: 'TELEGRAM_CHAT_ID_IPVN' });
  assert.ok(r.skipped);
});
```

- [ ] **Step 2: Chạy test — phải FAIL**

Run: `node --test test/notify.test.mjs`
Expected: FAIL — `notifyTelegramTo is not a function` (export chưa có).

- [ ] **Step 3: Refactor + thêm export (giữ nguyên hành vi sendTelegram)**

Trong `notify.mjs`, tách phần gửi + log ra helper và thêm hàm mới. Thay thân `sendTelegram` để dùng helper (kết quả y hệt cũ):

```js
// Post one pre-built payload to one chat. Isolated so both the multi-bot pvtm
// sender and the single-route feed sender share identical transport + timeout.
function postTelegram (token, chatId, payload) {
  return got.post(`https://api.telegram.org/bot${token}/sendMessage`, {
    json: { chat_id: chatId, text: payload.text, parse_mode: 'HTML',
      disable_web_page_preview: true, reply_markup: payload.reply_markup },
    timeout: { request: 15000 }
  });
}

// Public-log-safe per-target failure logging (no token/chat-id; position #1/#2…).
function logRejected (results) {
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      const e = r.reason;
      const detail = e?.response?.body || e?.code || e?.name || 'send failed';
      console.error(`telegram: target #${i + 1} failed:`, typeof detail === 'string' ? detail.slice(0, 200) : detail);
    }
  });
}
```

Sửa `sendTelegram` để dùng chúng (thay khối `got.post(...)` map + khối `results.forEach` cũ):

```js
const { text, reply_markup } = buildTelegram(items, opts);
const results = await Promise.allSettled(targets.map((t) => postTelegram(t.token, t.chatId, { text, reply_markup })));
logRejected(results);
```

Thêm export mới (đặt trước `notifyItems`):

```js
// Send a pre-built Telegram payload to a SINGLE route named by env vars.
// Reads ONLY tokenEnv/chatEnv — never falls back to the pvtm default chat.
// Used by isolated feeds (e.g. the IP gazette feed) for their own recipients.
export async function notifyTelegramTo (payload, { tokenEnv = 'TELEGRAM_BOT_TOKEN', chatEnv } = {}) {
  const token = process.env[tokenEnv];
  const chatIds = (process.env[chatEnv] || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!token || chatIds.length === 0) return { channel: 'telegram', skipped: `missing ${chatEnv || 'chatEnv'}` };
  const results = await Promise.allSettled(chatIds.map((id) => postTelegram(token, id, payload)));
  logRejected(results);
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  if (ok < chatIds.length) return { channel: 'telegram', error: `delivered to ${ok}/${chatIds.length} chat(s)` };
  return { channel: 'telegram', sent: `→ ${chatIds.length} chat(s)` };
}
```

- [ ] **Step 4: Chạy toàn bộ test — phải PASS**

Run: `npm test`
Expected: PASS — bộ test cũ (pvtm) vẫn xanh (chứng minh hành vi pvtm không đổi) + 2 test mới xanh.

- [ ] **Step 5: Commit**

```bash
git add notify.mjs test/notify.test.mjs
git commit -m "feat(notify): add single-route notifyTelegramTo for isolated feeds"
```

---

## Task 2: messages.mjs — export helper escaping (additive)

**Files:**
- Modify: `messages.mjs:7-17`

- [ ] **Step 1: Thêm `export`**

Đổi 2 khai báo hàm (chỉ thêm từ khoá `export`, thân giữ nguyên):

```js
export function escapeHtml (s = '') {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
export function escapeAttr (s = '') {
  return escapeHtml(s).replace(/"/g, '&quot;');
}
```

- [ ] **Step 2: Chạy test — phải PASS (không vỡ gì)**

Run: `npm test`
Expected: PASS (thay đổi thuần additive).

- [ ] **Step 3: Commit**

```bash
git add messages.mjs
git commit -m "refactor(messages): export escapeHtml/escapeAttr for reuse"
```

---

## Task 3: messages-ipvn.mjs — tin Telegram 📕 + cảnh báo degraded

**Files:**
- Create: `messages-ipvn.mjs`
- Test: `test/messages-ipvn.test.mjs`

- [ ] **Step 1: Viết test thất bại**

```js
// test/messages-ipvn.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGazetteTelegram, buildDegradedAlert } from '../messages-ipvn.mjs';

const item = (o = {}) => ({ key: '465', title: 'Số 465 ngày 17 tháng 08 năm 2026',
  url: 'https://www.ipvietnam.gov.vn/x?a=1&b=2', date: '17/08/2026', dateISO: '2026-08-17', ...o });

test('buildGazetteTelegram: masthead 📕 + numbered link + date', () => {
  const { text, reply_markup } = buildGazetteTelegram([item()], { title: '1 công báo mới' });
  assert.match(text, /📕 <b>Công báo Sở hữu công nghiệp<\/b>/);
  assert.match(text, /<b>1\.<\/b> <a href="https:\/\/www\.ipvietnam\.gov\.vn\/x\?a=1&amp;b=2">Số 465/);
  assert.match(text, /17\/08\/2026/);
  assert.equal(reply_markup.inline_keyboard[0][0].url, 'https://www.ipvietnam.gov.vn/cong-bao-so-huu-cong-nghiep1');
});

test('buildGazetteTelegram escapes a hostile title', () => {
  const { text } = buildGazetteTelegram([item({ title: 'Số 1 <script>&"x"' })]);
  assert.doesNotMatch(text, /<script>/);
  assert.match(text, /&lt;script&gt;/);
});

test('buildDegradedAlert down/up', () => {
  assert.match(buildDegradedAlert('down').text, /⚠️.*không đọc được/);
  assert.match(buildDegradedAlert('up').text, /✅.*trở lại/);
});
```

- [ ] **Step 2: Chạy test — phải FAIL**

Run: `node --test test/messages-ipvn.test.mjs`
Expected: FAIL — module chưa tồn tại.

- [ ] **Step 3: Viết `messages-ipvn.mjs`**

```js
// Presentation layer for the IP-gazette feed. Pure (no network). Separate from
// messages.mjs because the gazette has its own brand (📕) and a flat issue list,
// not the A→D grouped PVTM Radar layout.
import { escapeHtml, escapeAttr } from './messages.mjs';

export const SOURCE_URL = 'https://www.ipvietnam.gov.vn/cong-bao-so-huu-cong-nghiep1';

// items: [{ key, title, url, date, dateISO }] — already newest-first.
export function buildGazetteTelegram (items, { title } = {}) {
  const header = `📕 <b>Công báo Sở hữu công nghiệp</b> · ${escapeHtml(title || `${items.length} số mới`)}`;
  const lines = [header, ''];
  items.forEach((it, i) => {
    const date = it.date ? ` <i>· ${escapeHtml(it.date)}</i>` : '';
    lines.push(`<b>${i + 1}.</b> <a href="${escapeAttr(it.url)}">${escapeHtml(it.title)}</a>${date}`);
  });
  return {
    text: lines.join('\n').trim(),
    reply_markup: { inline_keyboard: [[{ text: 'Xem tất cả công báo ↗', url: SOURCE_URL }]] }
  };
}

// Guard #1 status message. 'down' when the table can't be read; 'up' on recovery.
export function buildDegradedAlert (kind) {
  const text = kind === 'down'
    ? '⚠️ <b>Công báo SHCN</b>: không đọc được danh sách trên ipvietnam.gov.vn (0 dòng / cấu trúc lạ). Có thể site đã đổi giao diện — cần kiểm tra parser.'
    : '✅ <b>Công báo SHCN</b>: feed đã hoạt động trở lại.';
  return { text, reply_markup: undefined };
}
```

- [ ] **Step 4: Chạy test — phải PASS**

Run: `node --test test/messages-ipvn.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add messages-ipvn.mjs test/messages-ipvn.test.mjs
git commit -m "feat(ipvn): gazette Telegram message + degraded alerts"
```

---

## Task 4: ipvn.mjs — scraper (parse thuần + fetch SSL-bypass)

**Files:**
- Create: `ipvn.mjs`
- Test: `test/ipvn.test.mjs`

- [ ] **Step 1: Viết test thất bại** (bao trùm hardening #2 & #3)

```js
// test/ipvn.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGazette, toISODate, isBroken } from '../ipvn.mjs';

const HTML = `<table>
<tr><th>Tiêu đề</th><th>Ngày xuất bản</th></tr>
<tr><td><a href="https://www.ipvietnam.gov.vn/web/guest/x/-/content/so-465-ngay-17-thang-08-nam-2026">Số 465 ngày 17 tháng 08 năm 2026</a></td><td>17/08/2026</td></tr>
<tr><td><a href="/web/guest/x/-/content/so-457">Số 457 tháng 04 năm 2026</a></td><td>27/04/2026</td></tr>
</table>`;

test('parseGazette: number from title, date from column, absolute url', () => {
  const { items, rows, dropped } = parseGazette(HTML);
  assert.equal(rows, 2);
  assert.equal(dropped.length, 0);
  assert.equal(items[0].key, '465');
  assert.equal(items[0].dateISO, '2026-08-17');
  assert.equal(items[0].date, '17/08/2026');
  assert.ok(items[0].url.startsWith('https://www.ipvietnam.gov.vn/'));
  // #2: the "tháng 04" (no day) format still parses its number
  assert.equal(items[1].key, '457');
  assert.equal(items[1].dateISO, '2026-04-27');
});

test('parseGazette: header row is not counted as content or dropped', () => {
  const { rows, dropped } = parseGazette(HTML);
  assert.equal(rows, 2);             // only the 2 anchored rows
  assert.equal(dropped.length, 0);   // "Tiêu đề" header never enters dropped
});

test('parseGazette: #3 flags label↔slug number mismatch', () => {
  const html = `<table><tr><td><a href="/x/so-464-...">Số 465 ...</a></td><td>17/08/2026</td></tr></table>`;
  assert.equal(parseGazette(html).items[0].numberMismatch, true);
});

test('parseGazette: a content row with no issue number goes to dropped, not items', () => {
  const html = `<table><tr><td><a href="/x/thongbao">Thông báo abc</a></td><td>01/01/2026</td></tr></table>`;
  const { items, dropped } = parseGazette(html);
  assert.equal(items.length, 0);
  assert.equal(dropped.length, 1);
});

test('isBroken: 0 rows OR 0 items = structural failure (guard #1)', () => {
  assert.equal(isBroken({ rows: 0, items: [] }), true);
  assert.equal(isBroken({ rows: 3, items: [] }), true);
  assert.equal(isBroken({ rows: 2, items: [{ key: '465' }] }), false);
});

test('toISODate handles DD/MM/YYYY and null', () => {
  assert.equal(toISODate('04/05/2026'), '2026-05-04');
  assert.equal(toISODate(''), null);
});
```

- [ ] **Step 2: Chạy test — phải FAIL**

Run: `node --test test/ipvn.test.mjs`
Expected: FAIL — module chưa tồn tại.

- [ ] **Step 3: Viết `ipvn.mjs`** (mirror import style của `scraper.mjs`: `got`, `cheerio`)

```js
// Data layer for the IP-gazette feed (ipvietnam.gov.vn). Fetch + parse only.
// The site ships an INCOMPLETE TLS chain (missing intermediate), so the fetch
// disables verification FOR THIS REQUEST ONLY (scoped, not global): the feed
// reads public data and sends no secrets, so the residual MITM risk is bounded
// and covered by the structure guard downstream. See spec §4/§8.
import got from 'got';
import * as cheerio from 'cheerio';

export const SOURCE_URL = 'https://www.ipvietnam.gov.vn/cong-bao-so-huu-cong-nghiep1';
const ISSUE_RE = /S[ốo]\s*(\d+)/i;
const UA = {
  headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  timeout: { request: 20000 },
  https: { rejectUnauthorized: false } // scoped SSL bypass — see file header
};

// DD/MM/YYYY -> YYYY-MM-DD (sortable). null if absent.
export function toISODate (raw) {
  const m = (raw || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

// Guard #1: a healthy scan has content rows AND at least one parseable issue.
export function isBroken ({ rows, items }) {
  return rows === 0 || items.length === 0;
}

// Pure: HTML -> { items:[{key,title,url,date,dateISO,numberMismatch}], rows, dropped:[title] }.
// key = issue number (stable identity). Date comes from the 2nd column, NOT the
// title (titles are inconsistent). Rows without an <a> (e.g. the header) are
// skipped entirely; content rows with no issue number go to `dropped` (logged),
// never silently lost (#2). Link is the row's own anchor + slug-number check (#3).
export function parseGazette (html, baseUrl = SOURCE_URL) {
  const $ = cheerio.load(html);
  const items = [];
  const dropped = [];
  let rows = 0;
  $('table tr').each((_, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 2) return;
    const a = $(tds[0]).find('a[href]').first();
    if (!a.length) return; // header / non-content row
    const title = a.text().replace(/\s+/g, ' ').trim();
    if (!title) return;
    rows++;
    const no = title.match(ISSUE_RE);
    if (!no) { dropped.push(title); return; }
    const href = a.attr('href') || '';
    const dateRaw = ($(tds[1]).text().match(/\d{1,2}\/\d{1,2}\/\d{4}/) || [])[0] || null;
    const slugNo = (href.match(/so-(\d+)/i) || [])[1];
    items.push({
      key: no[1],
      title,
      url: href ? new URL(href, baseUrl).href : baseUrl,
      date: dateRaw,
      dateISO: toISODate(dateRaw),
      numberMismatch: slugNo ? slugNo !== no[1] : false
    });
  });
  return { items, rows, dropped };
}

// Network. Throws on transport failure (caller catches → treated as broken).
export async function fetchGazetteHtml () {
  return (await got(SOURCE_URL, UA)).body;
}
```

- [ ] **Step 4: Chạy test — phải PASS**

Run: `node --test test/ipvn.test.mjs`
Expected: PASS (6 test).

- [ ] **Step 5: Commit**

```bash
git add ipvn.mjs test/ipvn.test.mjs
git commit -m "feat(ipvn): gazette scraper — parse + scoped SSL-bypass fetch"
```

---

## Task 5: monitor-ipvn.mjs — seen-diff + guard #1/#2 + định tuyến (#5)

**Files:**
- Create: `monitor-ipvn.mjs`
- Test: các helper thuần đã phủ ở Task 4 (`parseGazette`, `isBroken`); toàn vòng kiểm bằng dispatch thủ công ở Task 6.

- [ ] **Step 1: Viết `monitor-ipvn.mjs`**

```js
#!/usr/bin/env node
// Periodic monitor for the IP gazette. New = issue number not seen before.
// Isolated from monitor.mjs: own state (seen-ipvn.json), own recipients
// (TELEGRAM_CHAT_ID_IPVN — never the pvtm chat, #5), own structure guard (#1).
// State: { version, degraded, seen:{key:{title,dateISO,firstSeenAt}}, updatedAt }.
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { fetchGazetteHtml, parseGazette, isBroken } from './ipvn.mjs';
import { buildGazetteTelegram, buildDegradedAlert } from './messages-ipvn.mjs';
import { notifyTelegramTo } from './notify.mjs';
import { shouldRecordSeen } from './monitor.mjs'; // safe import: monitor's main() is guarded

const STATE_FILE = new URL('./seen-ipvn.json', import.meta.url);
const STATE_VERSION = 1;
const CHAT_ENV = 'TELEGRAM_CHAT_ID_IPVN';

try { process.loadEnvFile(new URL('./.env', import.meta.url)); } catch { /* no .env */ }
const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const log = (...a) => console.log(`[${now()}]`, ...a);

async function loadState () {
  try {
    const raw = JSON.parse(await readFile(STATE_FILE, 'utf8'));
    if (raw.version !== STATE_VERSION) return { seen: new Map(), degraded: false, fresh: true };
    return { seen: new Map(Object.entries(raw.seen || {})), degraded: !!raw.degraded, fresh: false };
  } catch { return { seen: new Map(), degraded: false, fresh: true }; }
}
async function saveState (seen, degraded) {
  await writeFile(STATE_FILE, JSON.stringify({
    version: STATE_VERSION, degraded, seen: Object.fromEntries(seen), updatedAt: new Date().toISOString()
  }, null, 2));
}

export async function checkOnce () {
  const { seen, degraded, fresh } = await loadState();

  let parsed;
  try { parsed = parseGazette(await fetchGazetteHtml()); }
  catch (e) { log('fetch error:', e.message); parsed = { items: [], rows: 0, dropped: [] }; }
  const { items, rows, dropped } = parsed;
  if (dropped.length) log(`⚠ ${dropped.length} row(s) without an issue number:`, dropped.slice(0, 3));

  // Guard #1/#2 — structural failure. Keep `seen` untouched; toggle degraded and
  // alert ONLY on the healthy→broken transition (no spam every 30 min).
  if (isBroken({ rows, items })) {
    log(`⚠ structure check failed (rows=${rows}, items=${items.length}) — not recording`);
    if (!degraded) await notifyTelegramTo(buildDegradedAlert('down'), { chatEnv: CHAT_ENV });
    await saveState(seen, true);
    return;
  }
  if (degraded) { log('feed recovered'); await notifyTelegramTo(buildDegradedAlert('up'), { chatEnv: CHAT_ENV }); }
  items.forEach((it) => { if (it.numberMismatch) log(`⚠ number mismatch (label ${it.key} vs slug): ${it.url}`); });

  // First run / schema change: seed silently (firstSeenAt=null → excluded later).
  if (fresh) {
    items.forEach((it) => seen.set(it.key, { title: it.title, dateISO: it.dateISO ?? null, firstSeenAt: null }));
    await saveState(seen, false);
    log(`seeded ${seen.size} gazette issue(s) (schema v${STATE_VERSION} — no alert)`);
    return;
  }

  const newItems = items.filter((it) => !seen.has(it.key));
  if (newItems.length === 0) { log(`no new gazette (${items.length} scanned, all seen)`); await saveState(seen, false); return; }

  const display = [...newItems].sort((a, b) => Number(b.key) - Number(a.key));
  log(`${newItems.length} new gazette: ${display.map((d) => 'Số ' + d.key).join(', ')}`);
  const res = await notifyTelegramTo(
    buildGazetteTelegram(display, { title: `${newItems.length} công báo mới` }),
    { chatEnv: CHAT_ENV }
  );
  log('notify:', res.sent || res.skipped || res.error);

  // Only advance state if delivery happened (reuse pvtm's durability rule).
  if (!shouldRecordSeen([res])) { log('⚠ not delivered — leaving unseen; retry next cycle'); await saveState(seen, false); return; }
  const nowISO = new Date().toISOString();
  newItems.forEach((it) => seen.set(it.key, { title: it.title, dateISO: it.dateISO ?? null, firstSeenAt: nowISO }));
  await saveState(seen, false);
}

async function main () { await checkOnce(); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { main(); }
```

- [ ] **Step 2: Kiểm tra import an toàn (không tự chạy monitor)**

Run: `node -e "import('./monitor-ipvn.mjs').then(m=>console.log(typeof m.checkOnce))"`
Expected: in ra `function` và KHÔNG có log "monitoring …" của monitor pvtm (chứng minh import không kích hoạt vòng chạy nào).

- [ ] **Step 3: Chạy toàn bộ test — phải PASS**

Run: `npm test`
Expected: PASS toàn bộ (pvtm + ipvn + messages-ipvn + notify).

- [ ] **Step 4: Commit**

```bash
git add monitor-ipvn.mjs
git commit -m "feat(ipvn): monitor with structure guard + isolated routing"
```

---

## Task 6: monitor.yml — thêm cache + step feed IP (#4)

**Files:**
- Modify: `.github/workflows/monitor.yml`

- [ ] **Step 1: Thêm cache cho `seen-ipvn.json`** (ngay sau khối `actions/cache@v6` của pvtm, dòng ~40)

```yaml
      # Isolated cache for the IP-gazette state — namespace 'ipvn-seen-' must NOT
      # collide with 'pvtm-seen-' or the two feeds would restore each other's state.
      - uses: actions/cache@v6
        with:
          path: seen-ipvn.json
          key: ipvn-seen-${{ github.run_id }}
          restore-keys: |
            ipvn-seen-
```

- [ ] **Step 2: Thêm step chạy feed IP** (ngay SAU step "Run monitor" của pvtm, TRƯỚC "Liveness ping")

```yaml
      # IP-gazette feed — continue-on-error so a failure here NEVER turns the job
      # red (which would suppress the liveness ping and fire a FALSE dead-man's
      # alert). Its own structure guard handles genuine IP-feed breakage (#1/#4).
      - name: Run IP gazette monitor
        continue-on-error: true
        run: node monitor-ipvn.mjs --once
        env:
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID_IPVN: ${{ secrets.TELEGRAM_CHAT_ID_IPVN }}
```

- [ ] **Step 3: Kiểm YAML có đủ phần mới**

Run: `node -e "const y=require('fs').readFileSync('.github/workflows/monitor.yml','utf8'); if(!/monitor-ipvn\.mjs/.test(y)||!/ipvn-seen-/.test(y)) throw new Error('missing bits'); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 4: Commit + push (feed sẽ chạy ở lần dispatch kế tiếp)**

```bash
git add .github/workflows/monitor.yml
git commit -m "ci(ipvn): run gazette feed as continue-on-error step with isolated cache"
```

- [ ] **Step 5: Xác minh chạy thật (dispatch thủ công, một lần)**

Run: `gh workflow run monitor.yml && sleep 60 && gh run view $(gh run list --workflow=monitor.yml --limit 1 --json databaseId -q '.[0].databaseId') --log | grep -iE "gazette|seeded"`
Expected: lần đầu → `seeded N gazette issue(s) (schema v1 — no alert)` (KHÔNG dội tin cũ). Lần sau khi có số mới → gửi vào nhóm IP.

---

## Task 7: README + docs-sync

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Thêm mục feed IP** vào README (bảng kiến trúc + biến env + state)

Ghi rõ: nguồn ipvietnam.gov.vn (bảng Số/Ngày), `ipvn.mjs`/`monitor-ipvn.mjs`/`messages-ipvn.mjs`, state `seen-ipvn.json` (v1, có `degraded`), biến `TELEGRAM_CHAT_ID_IPVN` (email tắt ở v1), SSL bypass scoped, guard #1 tự cảnh báo, step `continue-on-error` trong workflow.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document the IP gazette feed"
```

---

## Self-Review

- **Spec coverage:** §3 kiến trúc → Task 3/4/5; §4 #1 guard → Task 5 (`isBroken`+degraded) & test Task 4; #2 → `parseGazette` dropped/date-from-column (Task 4 test); #3 → `numberMismatch` (Task 4 test); #4 → Task 6 (`continue-on-error` + cache namespace); #5 → Task 1 (`notifyTelegramTo` no-fallback) + Task 5 routing. §5 triển khai → Task 6. §7 test → Task 1/3/4. §6 secret đã đặt (ngoài phạm vi code).
- **Placeholder scan:** không có TODO/TBD; mọi step có code/lệnh thật.
- **Type consistency:** item shape `{key,title,url,date,dateISO,numberMismatch}` nhất quán giữa `parseGazette` (Task 4), `buildGazetteTelegram` (Task 3, dùng `it.url/title/date`), `monitor-ipvn` (Task 5, dùng `it.key/title/dateISO`). `notifyTelegramTo(payload,{chatEnv})` khớp giữa Task 1 và các lời gọi ở Task 5. `isBroken({rows,items})` khớp Task 4↔5. `shouldRecordSeen([res])` khớp chữ ký đã export ở monitor.mjs.

## Ghi chú phạm vi test
Vòng `checkOnce` phụ thuộc mạng (fetch) nên KHÔNG mock trong unit test; rủi ro chi phối (#1/#2/#3) đã được phủ bằng test thuần cho `parseGazette` + `isBroken`. Toàn vòng được xác minh end-to-end bằng dispatch thủ công (Task 6 Step 5) — seed im lặng lần đầu, rồi gửi khi có số mới.
