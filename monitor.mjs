#!/usr/bin/env node
// Periodic monitor — detects genuinely new items across all groups (A/B/C/D)
// and sends a grouped alert. "New" = key (news id / Số ký hiệu) not seen before.
//
// State: seen.json { version, seenKeys, updatedAt }. The source set changed in
// v2 (multi-category + legal docs), so a v1/absent state is re-seeded SILENTLY
// to avoid dumping the whole catalogue as "new" on the first upgraded run.
//
// Usage:
//   node monitor.mjs            # loop every 30 min
//   node monitor.mjs --every 10 # every 10 minutes
//   node monitor.mjs --once     # single check (for cron / GitHub Actions)

import { readFile, writeFile } from 'node:fs/promises';
import { getAllItems, forDisplay, BASE_URL } from './scraper.mjs';
import { notifyItems } from './notify.mjs';

const STATE_FILE = new URL('./seen.json', import.meta.url);
const STATE_VERSION = 3; // v3: news article-id fix changed keys → re-seed

try { process.loadEnvFile(new URL('./.env', import.meta.url)); } catch { /* no .env */ }

const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const log = (...a) => console.log(`[${now()}]`, ...a);
const todayVN = () => {
	const d = new Date();
	return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

async function loadSeen () {
	try {
		const raw = JSON.parse(await readFile(STATE_FILE, 'utf8'));
		if (raw.version !== STATE_VERSION) return { keys: new Set(), fresh: true }; // schema changed
		return { keys: new Set(raw.seenKeys || []), fresh: false };
	} catch {
		return { keys: new Set(), fresh: true };
	}
}

async function saveSeen (keySet) {
	await writeFile(STATE_FILE, JSON.stringify({
		version: STATE_VERSION, seenKeys: [...keySet], updatedAt: new Date().toISOString()
	}, null, 2));
}

async function checkOnce () {
	const { keys: seen, fresh } = await loadSeen();
	const items = (await getAllItems()).filter((it) => it.key);

	if (fresh) {
		items.forEach((it) => seen.add(it.key));
		await saveSeen(seen);
		log(`seeded ${seen.size} items (first run / schema v${STATE_VERSION} — no alert sent)`);
		return [];
	}

	const newItems = items.filter((it) => !seen.has(it.key));
	if (newItems.length === 0) {
		log(`no new items (${items.length} scanned, all seen)`);
		return [];
	}

	const display = forDisplay(newItems);
	log(`${newItems.length} NEW item(s):`);
	display.forEach((it) => log(`  • [${it.group}] ${it.date || '??'} ${it.title.slice(0, 60)}`));

	const results = await notifyItems(display, {
		title: `${newItems.length} tin mới`, dateStr: todayVN(), days: 7
	});
	results.forEach((r) => log(`  notify ${r.channel}:`, r.sent ? `sent ${r.sent}` : (r.skipped || r.error)));

	newItems.forEach((it) => seen.add(it.key));
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

main();
