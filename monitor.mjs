#!/usr/bin/env node
// Periodic monitor — detects genuinely new items across all groups (A/B/C/D)
// and sends a grouped alert. "New" = key (news id / Số ký hiệu) not seen before.
// Also re-alerts an already-seen key whose TITLE changed on the site (e.g. an
// article cloned-then-renamed that first appeared under a stale title), tagged
// as an update so the corrected headline still reaches subscribers.
//
// State: seen.json { version, seen: {key: {title, dateISO, group, firstSeenAt}},
// updatedAt }. The schema/source set changed across versions, so a mismatched or
// absent state is re-seeded SILENTLY to avoid dumping the whole catalogue as
// "new" on the first upgraded run. `firstSeenAt` is the ISO time the monitor
// first DETECTED the key (null for items already present at a re-seed, whose true
// first-seen is unknown) → lets `--stats` measure cover-date-vs-detection lag.
//
// Usage:
//   node monitor.mjs            # loop every 30 min
//   node monitor.mjs --every 10 # every 10 minutes
//   node monitor.mjs --once     # single check (for cron / GitHub Actions)
//   node monitor.mjs --stats    # print cover-date → first-detected lag, then exit

import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { getAllItems, forDisplay, BASE_URL } from './scraper.mjs';
import { notifyItems } from './notify.mjs';

const STATE_FILE = new URL('./seen.json', import.meta.url);
const STATE_VERSION = 5; // v5: store {title,dateISO,group,firstSeenAt} per key → title-change detection + detection-lag stats

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

// Read the title from a seen-entry. v5 entries are objects; tolerate a bare
// string too (defensive — a hand-edited or partially-migrated state).
const titleOf = (e) => (typeof e === 'string' ? e : e?.title) || '';

// Build the v5 seen-entry for an item being recorded. `existing` is its prior
// entry (undefined when the key is genuinely new). A new key stamps the current
// detection time; an already-seen key (title change) KEEPS its original
// firstSeenAt — including null for seeded items, whose true first-seen is
// unknown and must not be faked to the retitle moment.
export function recordEntry (existing, item, nowISO) {
	return {
		title: item.title,
		dateISO: item.dateISO ?? null, // cover date from the site (null if undated)
		group: item.group,
		firstSeenAt: existing ? (existing.firstSeenAt ?? null) : nowISO
	};
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
		// Seeded items were already present, so their true first-seen is unknown:
		// firstSeenAt = null (excluded from lag stats). Only keys detected AFTER
		// the seed get a real detection timestamp.
		items.forEach((it) => seen.set(it.key, { title: it.title, dateISO: it.dateISO ?? null, group: it.group, firstSeenAt: null }));
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
		if (titleKey(titleOf(seen.get(it.key))) !== titleKey(it.title)) { it.updated = true; updatedItems.push(it); }
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

	// Record every alerted item (new + corrected). New keys get stamped with this
	// run's detection time; retitled keys keep their original firstSeenAt.
	const nowISO = new Date().toISOString();
	alertItems.forEach((it) => seen.set(it.key, recordEntry(seen.get(it.key), it, nowISO)));
	await saveSeen(seen);
	return display;
}

// Compute the per-key lag between an item's cover date (dateISO, printed on the
// site) and when the monitor FIRST detected it (firstSeenAt). Pure — takes the
// parsed seen map, returns rows + summary so it can be unit-tested offline.
// Seeded items (firstSeenAt=null) and undated items (dateISO=null) are excluded:
// their lag is unknowable, and including them would fabricate the very statistic
// we're trying to measure honestly.
export function computeLagStats (seenObj = {}) {
	const rows = Object.entries(seenObj)
		.map(([key, e]) => ({ key, ...e }))
		.filter((e) => e.firstSeenAt && e.dateISO)
		.map((e) => ({
			...e,
			lagDays: Math.round((new Date(e.firstSeenAt) - new Date(e.dateISO + 'T00:00:00Z')) / 86400000)
		}))
		.sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt));
	const lags = rows.map((r) => r.lagDays).sort((a, b) => a - b);
	const summary = lags.length ? {
		n: lags.length, min: lags[0], max: lags[lags.length - 1],
		median: lags[Math.floor(lags.length / 2)],
		mean: Number((lags.reduce((s, x) => s + x, 0) / lags.length).toFixed(1))
	} : { n: 0 };
	return { rows, summary };
}

async function printStats () {
	let raw;
	try { raw = JSON.parse(await readFile(STATE_FILE, 'utf8')); }
	catch { console.log('No seen.json state found (nothing tracked yet).'); return; }
	const total = Object.keys(raw.seen || {}).length;
	if (raw.version !== STATE_VERSION) {
		console.log(`seen.json is schema v${raw.version}; lag tracking starts at v${STATE_VERSION}. Run the monitor once to migrate, then data accrues as new items appear.`);
		return;
	}
	const { rows, summary } = computeLagStats(raw.seen || {});
	if (summary.n === 0) {
		console.log(`No lag data yet: no item has been DETECTED since the v${STATE_VERSION} upgrade.`);
		console.log(`(Seeded items are excluded — their true first-seen is unknown.) Total tracked keys: ${total}.`);
		return;
	}
	console.log(`Detection lag (cover date → first detected), n=${summary.n} of ${total} keys:`);
	rows.forEach((r) => console.log(`  ${String(r.lagDays).padStart(3)}d | [${r.group}] cover=${r.dateISO} seen=${r.firstSeenAt.slice(0, 10)} | ${titleOf(r).slice(0, 50)}`));
	console.log(`\nlag days — min ${summary.min} · median ${summary.median} · mean ${summary.mean} · max ${summary.max}  (±1d: cover date is calendar-VN, detection is UTC)`);
	const byGroup = {};
	for (const r of rows) (byGroup[r.group] ??= []).push(r.lagDays);
	for (const g of Object.keys(byGroup).sort()) {
		const gl = byGroup[g].sort((a, b) => a - b);
		const gm = (gl.reduce((s, x) => s + x, 0) / gl.length).toFixed(1);
		console.log(`  group ${g}: n=${gl.length} · median ${gl[Math.floor(gl.length / 2)]}d · mean ${gm}d`);
	}
}

async function main () {
	const args = process.argv.slice(2);
	if (args.includes('--stats')) { await printStats(); return; }
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
