#!/usr/bin/env node
// Monitor pvtm.gov.vn and notify (Telegram + Email) ONLY about news that is
// new since the last run. Runs in a self-rescheduling loop.
//
// State: seen article IDs are persisted to seen.json between cycles.
// First run has no state, so it CATCHES YOU UP: it notifies the newest
// CATCHUP_COUNT items, then marks everything currently on the homepage as seen
// so the rest don't re-alert later. After that, only genuinely new items alert.
//
// Usage:
//   node monitor.mjs            # loop, checking every 30 min (default)
//   node monitor.mjs --every 10 # loop, every 10 minutes
//   node monitor.mjs --once     # single check then exit (good for cron)
//
// Config a channel by exporting its env vars (see notify.mjs). Optionally put
// them in a .env file next to this script — it is loaded automatically.

import { readFile, writeFile } from 'node:fs/promises';
import { getNews, BASE_URL } from './scraper.mjs';
import { notifyNewItems } from './notify.mjs';

const STATE_FILE = new URL('./seen.json', import.meta.url);

// On the very first run (no state yet), notify the newest N items to catch you
// up, then go quiet on them. Override with CATCHUP_COUNT (0 = seed silently).
const CATCHUP_COUNT = process.env.CATCHUP_COUNT !== undefined
	? Number(process.env.CATCHUP_COUNT)
	: 5;

// Optional .env support without adding a dependency (Node >= 20.12).
try { process.loadEnvFile(new URL('./.env', import.meta.url)); } catch { /* no .env — fine */ }

const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const log = (...a) => console.log(`[${now()}]`, ...a);

async function loadSeen () {
	try {
		const raw = JSON.parse(await readFile(STATE_FILE, 'utf8'));
		return { ids: new Set(raw.seenIds || []), fresh: false };
	} catch {
		return { ids: new Set(), fresh: true }; // no state file yet
	}
}

async function saveSeen (idSet) {
	const payload = { seenIds: [...idSet], updatedAt: new Date().toISOString() };
	await writeFile(STATE_FILE, JSON.stringify(payload, null, 2));
}

// One check cycle. Returns the list of new items (for logging/tests).
async function checkOnce () {
	const { ids: seen, fresh } = await loadSeen();
	const items = await getNews();
	const withId = items.filter((it) => it.id); // need a stable key to dedup

	if (fresh) {
		// withId is already newest-first (getNews sorts by date desc).
		const catchUp = CATCHUP_COUNT > 0 ? withId.slice(0, CATCHUP_COUNT) : [];

		if (catchUp.length > 0) {
			log(`first run — catching you up on the ${catchUp.length} newest of ${withId.length} item(s):`);
			catchUp.forEach((it) => log(`  • [${it.date || '??'}] ${it.title}`));
			const results = await notifyNewItems(catchUp);
			results.forEach((r) => log(`  notify ${r.channel}:`, r.sent ? `sent ${r.sent}` : (r.skipped || r.error)));
		} else {
			log(`first run — seeded ${withId.length} items silently (CATCHUP_COUNT=0)`);
		}

		// Mark ALL current items seen, so items beyond the catch-up window
		// (and the caught-up ones) don't alert again next cycle.
		withId.forEach((it) => seen.add(it.id));
		await saveSeen(seen);
		return catchUp;
	}

	const newItems = withId.filter((it) => !seen.has(it.id));

	if (newItems.length === 0) {
		log(`no new news (${withId.length} on homepage, all seen)`);
		return [];
	}

	log(`${newItems.length} NEW item(s):`);
	newItems.forEach((it) => log(`  • [${it.date || '??'}] ${it.title}`));

	const results = await notifyNewItems(newItems);
	results.forEach((r) => log(`  notify ${r.channel}:`, r.sent ? `sent ${r.sent}` : (r.skipped || r.error)));

	// Only mark as seen after a notification attempt, so a total failure retries.
	newItems.forEach((it) => seen.add(it.id));
	await saveSeen(seen);
	return newItems;
}

async function main () {
	const args = process.argv.slice(2);
	const once = args.includes('--once');
	const everyIdx = args.indexOf('--every');
	const minutes = everyIdx >= 0 ? Number(args[everyIdx + 1]) : 30;

	log(`monitoring ${BASE_URL}${once ? ' (single run)' : ` every ${minutes} min`}`);

	const cycle = async () => {
		try {
			await checkOnce();
		} catch (err) {
			log('cycle error:', err.message); // keep the loop alive on transient failures
		}
	};

	await cycle();
	if (once) return;

	const intervalMs = Math.max(1, minutes) * 60_000;
	const tick = () => setTimeout(async () => { await cycle(); tick(); }, intervalMs);
	tick();

	process.on('SIGINT', () => { log('stopping'); process.exit(0); });
}

main();
