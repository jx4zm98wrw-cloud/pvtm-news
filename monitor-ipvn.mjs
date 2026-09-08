#!/usr/bin/env node
// Periodic monitor for the IP gazette. New = issue number not seen before.
// Isolated from monitor.mjs: own state (seen-ipvn.json), own recipients
// (TELEGRAM_CHAT_ID_IPVN — never the pvtm chat, #5), own structure guard (#1).
// State: { version, degraded, seen:{key:{title,dateISO,firstSeenAt}}, updatedAt }.
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { fetchGazetteHtml, parseGazette, isBroken } from './ipvn.mjs';
import { buildGazetteTelegram, buildDegradedAlert } from './messages-ipvn.mjs';
import { notifyTelegramTo, notifyEmailTo } from './notify.mjs';
import { shouldRecordSeen } from './monitor.mjs'; // safe import: monitor's main() is guarded

const STATE_FILE = new URL('./seen-ipvn.json', import.meta.url);
const STATE_VERSION = 1;
const CHAT_ENV = 'TELEGRAM_CHAT_ID_IPVN';
const MAIL_ENV = 'MAIL_TO_IPVN';
const vnDateStr = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());

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
  log('notify (telegram):', res.sent || res.skipped || res.error);

  const emailRes = await notifyEmailTo(display, { dateStr: vnDateStr() }, { mailToEnv: MAIL_ENV });
  log('notify (email):', emailRes.sent || emailRes.skipped || emailRes.error);

  // Only advance state if at least one channel delivered (reuse pvtm's durability rule).
  if (!shouldRecordSeen([res, emailRes])) { log('⚠ not delivered — leaving unseen; retry next cycle'); await saveState(seen, false); return; }
  const nowISO = new Date().toISOString();
  newItems.forEach((it) => seen.set(it.key, { title: it.title, dateISO: it.dateISO ?? null, firstSeenAt: nowISO }));
  await saveState(seen, false);
}

async function main () { await checkOnce(); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { main(); }
