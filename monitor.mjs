#!/usr/bin/env node
// Monitor pvtm.gov.vn and notify (Telegram + Email) ONLY about news that is
// new since the last run. Runs in a self-rescheduling loop.
//
// State: seen article IDs are persisted to seen.json between cycles.
// First run has no state, so we SEED it (mark everything seen, notify nothing)
// to avoid dumping the whole homepage as "new".
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
		withId.forEach((it) => seen.add(it.id));
		await saveSeen(seen);
		log(`seeded ${seen.size} existing items (first run — no notifications sent)`);
		return [];
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
