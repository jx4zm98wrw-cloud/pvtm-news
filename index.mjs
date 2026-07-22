#!/usr/bin/env node
// CLI: print the newest news from pvtm.gov.vn and write news.json.
// The scraping logic lives in scraper.mjs (shared with monitor.mjs).
//
// Usage:
//   node index.mjs            # print newest 10, write news.json
//   node index.mjs 20         # print newest 20
//   node index.mjs 20 --json  # print raw JSON only (pipe-friendly)

import { writeFile } from 'node:fs/promises';
import { getNews, BASE_URL } from './scraper.mjs';

function printNews (news) {
	console.log(`\n📰  Newest ${news.length} news from ${BASE_URL}\n`);
	news.forEach((n, i) => {
		console.log(`${String(i + 1).padStart(2)}. [${n.date || '  ??  '}] ${n.title}`);
		if (n.category) console.log(`    ${n.category}`);
		console.log(`    ${n.url}\n`);
	});
}

async function main () {
	const args = process.argv.slice(2);
	const jsonOnly = args.includes('--json');
	const limit = Number(args.find((a) => /^\d+$/.test(a))) || 10;

	const newest = await getNews(limit);

	if (jsonOnly) {
		process.stdout.write(JSON.stringify(newest, null, 2) + '\n');
		return;
	}

	printNews(newest);
	await writeFile('news.json', JSON.stringify(newest, null, 2));
	console.log(`Wrote ${newest.length} items to news.json`);
}

main().catch((err) => {
	console.error('Failed:', err.message);
	process.exit(1);
});
