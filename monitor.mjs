#!/usr/bin/env node
// Periodic monitor — detects genuinely new items across all groups (A/B/C/D)
// and sends a grouped alert. "New" = key (news id / Số ký hiệu) not seen before.
// Also re-alerts an already-seen key whose TITLE changed on the site (e.g. an
// article cloned-then-renamed that first appeared under a stale title), tagged
// as an update so the corrected headline still reaches subscribers.
//
// State: seen.json { version, seen: {key: title}, updatedAt }. The schema/source
// set changed across versions, so a mismatched/absent state is re-seeded SILENTLY
// to avoid dumping the whole catalogue as "new" on the first upgraded run.
//
// Usage:
//   node monitor.mjs            # loop every 30 min
//   node monitor.mjs --every 10 # every 10 minutes
//   node monitor.mjs --once     # single check (for cron / GitHub Actions)

import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { getAllItems, forDisplay, BASE_URL } from './scraper.mjs';
import { notifyItems } from './notify.mjs';

const STATE_FILE = new URL('./seen.json', import.meta.url);
const STATE_VERSION = 4; // v4: store title per key → detect site-side title changes (re-seed)

try { process.loadEnvFile(new URL('./.env', import.meta.url)); } catch { /* no .env */ }

const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const log = (...a) => console.log(`[${now()}]`, ...a);
// Header date shown to readers, pinned to Vietnam time. MUST use an explicit
// timeZone: GitHub Actions runners are UTC, so a plain `new Date().getDate()`
// would print the previous day during 00:00–07:00 VN (17:00–24:00 UTC).
// Display-only — never used for filtering or seen-diff.
const todayVN = () => new Intl.DateTimeFormat('en-GB', {
	timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric'
}).format(new Date());

// Normalize a title for change comparison. The scraper already collapses
// whitespace; lowercasing ignores trivial case-only edits.
const titleKey = (t) => (t || '').toLowerCase().replace(/\s+/g, ' ').trim();

// Given the results from notifyItems(), decide whether it's safe to record the
// alerted items as "seen". Returns true when at least one channel delivered, OR
// when every channel was intentionally skipped (disabled via missing env —
// retrying can't help). Returns false ONLY when a channel actively failed and
// nothing else delivered: in that case we leave the items unseen so the next
// cycle retries them, instead of marking them seen and losing the alert forever.
export function shouldRecordSeen (results) {
	const delivered = results.some((r) => r.sent);
	const hardFailed = results.some((r) => r.error);
	return delivered || !hardFailed;
}

// State is a Map<key, lastSeenTitle>, persisted as a plain object under `seen`.
async function loadSeen () {
	try {
		const raw = JSON.parse(await readFile(STATE_FILE, 'utf8'));
		if (raw.version !== STATE_VERSION) return { seen: new Map(), fresh: true }; // schema changed
		return { seen: new Map(Object.entries(raw.seen || {})), fresh: false };
	} catch {
		return { seen: new Map(), fresh: true };
	}
}

async function saveSeen (seen) {
	await writeFile(STATE_FILE, JSON.stringify({
		version: STATE_VERSION, seen: Object.fromEntries(seen), updatedAt: new Date().toISOString()
	}, null, 2));
}

async function checkOnce () {
	const { seen, fresh } = await loadSeen();
	const items = (await getAllItems()).filter((it) => it.key);

	if (fresh) {
		items.forEach((it) => seen.set(it.key, it.title));
		await saveSeen(seen);
		log(`seeded ${seen.size} items (first run / schema v${STATE_VERSION} — no alert sent)`);
		return [];
	}

	// New    = key never seen before.
	// Updated = key already seen but the site changed its title since — marked so
	//           the message flags it and a repeat headline isn't just confusing.
	const newItems = [];
	const updatedItems = [];
	for (const it of items) {
		if (!seen.has(it.key)) { newItems.push(it); continue; }
		if (titleKey(seen.get(it.key)) !== titleKey(it.title)) { it.updated = true; updatedItems.push(it); }
	}
	const alertItems = [...newItems, ...updatedItems];

	if (alertItems.length === 0) {
		log(`no new items (${items.length} scanned, all seen)`);
		return [];
	}

	const display = forDisplay(alertItems);
	log(`${newItems.length} new + ${updatedItems.length} retitled item(s):`);
	// key + url in the log make a "why the duplicate / title mismatch?" case
	// diagnosable straight from the Actions run logs (no live-site re-probing).
	display.forEach((it) => log(`  • [${it.group}]${it.updated ? ' (cập nhật)' : ''} ${it.date || '??'} ${it.title.slice(0, 60)} · key=${it.key} · ${it.url}`));

	const parts = [];
	if (newItems.length) parts.push(`${newItems.length} tin mới`);
	if (updatedItems.length) parts.push(`${updatedItems.length} cập nhật`);
	const results = await notifyItems(display, {
		title: parts.join(' + '), dateStr: todayVN(), days: 7
	});
	results.forEach((r) => log(`  notify ${r.channel}:`, r.sent ? `sent ${r.sent}` : (r.skipped || r.error)));

	// Only advance state if delivery actually happened. If every channel failed,
	// leave these items unseen so the next cycle retries them — otherwise a
	// transient Telegram/SMTP outage would mark them seen and drop the alert for
	// good. (A rare partial failure still records; notify.mjs logs which target
	// missed so it's visible rather than silent.)
	if (!shouldRecordSeen(results)) {
		log('⚠ no channel delivered — leaving items unseen; will retry next cycle');
		return display;
	}

	// Record the current title for every alerted item (new + corrected).
	alertItems.forEach((it) => seen.set(it.key, it.title));
	await saveSeen(seen);
	return display;
}

async function main () {
	const args = process.argv.slice(2);
	const once = args.includes('--once');
	const everyIdx = args.indexOf('--every');
	const minutes = everyIdx >= 0 ? Number(args[everyIdx + 1]) : 30;

	log(`monitoring ${BASE_URL}${once ? ' (single run)' : ` every ${minutes} min`}`);

	const cycle = async () => {
		try { await checkOnce(); } catch (err) { log('cycle error:', err.message); }
	};

	await cycle();
	if (once) return;

	const intervalMs = Math.max(1, minutes) * 60_000;
	const tick = () => setTimeout(async () => { await cycle(); tick(); }, intervalMs);
	tick();
	process.on('SIGINT', () => { log('stopping'); process.exit(0); });
}

// Run the monitor only when invoked directly (node monitor.mjs …), not when a
// test or other module imports this file for its exported helpers.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main();
}
