# pvtm-news

Fetch the newest news from **[pvtm.gov.vn](https://pvtm.gov.vn)** — the Vietnam
Trade Remedies Authority (Cục Phòng vệ Thương mại) — as structured data, and
**monitor** it to get **Telegram + Email** alerts about news that is new since
the last run.

## Why not `node-website-scraper`?

`node-website-scraper` **mirrors** a whole site (HTML + every image/CSS/JS asset)
for offline browsing — it produces files on disk, not data. To *extract news*
(titles, dates, links) the right tool is a targeted **fetch + parse**: one HTTP
GET with [`got`](https://github.com/sindresorhus/got), parsed with
[`cheerio`](https://cheerio.js.org/).

## Install

```bash
npm install
```

## A) One-off list — `index.mjs`

```bash
node index.mjs            # print newest 10, also write news.json
node index.mjs 20         # print newest 20
node index.mjs 20 --json  # raw JSON only (pipe-friendly)
```

## B) New-news monitor + alerts — `monitor.mjs`

```bash
cp .env.example .env      # then fill in Telegram and/or Email vars
node monitor.mjs          # loop, checking every 30 min
node monitor.mjs --every 10   # every 10 minutes
node monitor.mjs --once   # single check then exit (good for cron/launchd)
```

- **State:** seen article IDs persist to `seen.json`. `"new"` = current IDs − seen IDs.
- **First run catches you up:** it notifies the newest `CATCHUP_COUNT` items
  (default 5; set `CATCHUP_COUNT=0` to seed silently instead), then marks
  everything on the homepage seen so only genuinely new items alert afterward.
- **Each item shows category, date, and title (link)** — the email adds a summary
  snippet and colour-codes the category (investigation notices in accent blue).
  All new items in a cycle are batched into one Telegram message and one email.
- **Channels are independent:** each activates only if its env vars are set, so
  you can run with just one. A missing/failing channel is logged, not fatal.

### Configuration (env vars — see `.env.example`)

| Channel  | Vars |
|----------|------|
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (comma-separated for multiple chats; add `_2`/`_3` suffixed pairs for extra bots) |
| Email    | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_TO`, `MAIL_FROM` (optional) |

`monitor.mjs` auto-loads a `.env` file if present. **Secrets are read from the
environment only — never committed** (`.env`, `seen.json`, `news.json` are gitignored).

**Telegram setup:** message `@BotFather` → `/newbot` → copy the token. Message
your bot once, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` to read
your `chat id`.

**Gmail email setup:** `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`,
`SMTP_SECURE=true`, and `SMTP_PASS` = a Google **App Password** (not your login).

## Files

| File | Role |
|------|------|
| `scraper.mjs` | Reusable core: `fetchHomepage`, `parseNews`, `selectNewest`, `getNews` |
| `index.mjs`   | CLI — print newest N, write `news.json` |
| `monitor.mjs` | Loop: diff against `seen.json`, notify only new items |
| `notify.mjs`  | Telegram + Email channels (env-gated) |

## State file (`seen.json`)

```json
{ "seenIds": ["9d8c469f-...", "a4f7c914-..."], "updatedAt": "2026-07-22T15:44:06.000Z" }
```

## Output shape (`news.json`)

```json
[
  {
    "id": "9d8c469f-8fcd-4df5-a5fb-98a544eafe97",
    "title": "Bộ Công Thương ban hành Quyết định rà soát ...",
    "url": "https://pvtm.gov.vn/default.aspx?page=news-detail&do=detail&id=9d8c469f-...",
    "category": "Tin điều tra của Việt Nam",
    "date": "20/07/2026",
    "dateISO": "2026-07-20",
    "summary": "Ngày 19 tháng 01 năm 2026, Bộ Công Thương ..."
  }
]
```

## How it works

1. **Fetch** — `GET https://pvtm.gov.vn` with a browser user-agent.
2. **Parse** — every article is a `div.news` card:
   title → `.news__title a` (falls back to image `alt`); link → `.news__title a[href]`
   (relative `./default.aspx?...`, resolved to absolute); category → `.news__tag`;
   date → `.news__info` (`DD/MM/YYYY` → `dateISO`); summary → `.news__desc`.
3. **Diff** — dedup by article `id`, compare to `seen.json`, notify the difference.

## Caveats

- Selectors are coupled to the site's current HTML. If `pvtm.gov.vn` redesigns,
  update the selectors in `parseNews()` (in `scraper.mjs`).
- The homepage shows only the most recent articles. Older news would need the
  category pages (`?page=news&do=browse&category_id=...`) paginated.
- Notification policy is **at-most-once**: an item is marked seen after the
  notify attempt, so a send failure is logged but not retried (avoids duplicate
  alerts on partial success).
- The built-in loop is a foreground process. For true background/boot-persistent
  running, wrap `--once` in cron / launchd, or use a process manager.

## Deploy (GitHub Actions)

`.github/workflows/monitor.yml` runs `node monitor.mjs --once` on a schedule
(every 30 min) on GitHub's runners — no server needed.

- **State:** `seen.json` persists between runs via `actions/cache` (it is *not*
  committed). First run catches you up on the newest `CATCHUP_COUNT` (default 5),
  as locally.
- **Secrets:** set these in the repo → Settings → Secrets and variables → Actions:
  `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (and the `SMTP_*` / `MAIL_*` set for email).
  Never commit `.env`.
- **Trigger manually:** Actions tab → "pvtm news monitor" → Run workflow.
- **Caveats:** GitHub cron is best-effort (minutes of delay possible); scheduled
  runs only fire on the default branch; GitHub pauses schedules after ~60 days
  of repo inactivity.
