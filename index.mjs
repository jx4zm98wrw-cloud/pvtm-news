#!/usr/bin/env node
// CLI: list current pvtm.gov.vn items grouped A→B→C→D and write news.json.
// Usage:
//   node index.mjs            # print grouped, write news.json
//   node index.mjs --json     # raw JSON only (pipe-friendly)

import { writeFile } from 'node:fs/promises';
import { getAllItems, forDisplay, BASE_URL } from './scraper.mjs';

function print (items) {
	console.log(`\n📰  ${items.length} tin từ ${BASE_URL}\n`);
	let lastGroup = null;
	items.forEach((it) => {
		if (it.group !== lastGroup) {
			console.log(`\n${it.groupLabel}`);
			lastGroup = it.group;
		}
		const head = it.isDoc && it.code ? `${it.code} — ` : '';
		console.log(`  [${it.date || '  ??  '}] ${head}${it.title}`);
	});
	console.log();
}

async function main () {
	const jsonOnly = process.argv.includes('--json');
	const items = forDisplay(await getAllItems());

	if (jsonOnly) {
		process.stdout.write(JSON.stringify(items, null, 2) + '\n');
		return;
	}
	print(items);
	await writeFile('news.json', JSON.stringify(items, null, 2));
	console.log(`Wrote ${items.length} items to news.json`);
}

main().catch((err) => { console.error('Failed:', err.message); process.exit(1); });
