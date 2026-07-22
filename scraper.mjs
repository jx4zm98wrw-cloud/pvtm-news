// Reusable scraping core for pvtm.gov.vn — shared by the CLI (index.mjs)
// and the monitor (monitor.mjs). No side effects on import.

import got from 'got';
import * as cheerio from 'cheerio';

export const BASE_URL = 'https://pvtm.gov.vn';

// --- FETCH ------------------------------------------------------------------
// One HTTP GET. A browser-ish user-agent avoids the odd government-site block.
export async function fetchHomepage () {
	const { body } = await got(BASE_URL, {
		headers: {
			'user-agent':
				'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
		},
		timeout: { request: 20000 }
	});
	return body;
}

// --- PARSE ------------------------------------------------------------------
// Each article on the homepage is a `div.news` card.
export function parseNews (html) {
	const $ = cheerio.load(html);
	const items = [];

	$('div.news').each((_, el) => {
		const $el = $(el);

		const href =
			$el.find('.news__title a').attr('href') ||
			$el.find('a.news__frame').attr('href');
		if (!href) return;

		const title =
			$el.find('.news__title').text().replace(/\s+/g, ' ').trim() ||
			($el.find('a.news__frame img').attr('alt') || '').trim();

		const dateRaw =
			($el.find('.news__info').text().match(/\d{1,2}\/\d{1,2}\/\d{4}/) || [])[0] ||
			null;

		items.push({
			id: (href.match(/id=([0-9a-f-]+)/i) || [])[1] || null,
			title,
			url: new URL(href, BASE_URL).href,
			category: $el.find('.news__tag').first().text().replace(/\s+/g, ' ').trim() || null,
			date: dateRaw,
			dateISO: toISODate(dateRaw),
			summary: $el.find('.news__desc').text().replace(/\s+/g, ' ').trim() || null
		});
	});

	return items;
}

// Vietnamese sites use DD/MM/YYYY; normalise to an ISO date string for sorting.
export function toISODate (ddmmyyyy) {
	if (!ddmmyyyy) return null;
	const [d, m, y] = ddmmyyyy.split('/').map(Number);
	return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Dedup by article id, sort newest-first (undated items sink to the bottom).
export function selectNewest (items, limit = Infinity) {
	const seen = new Set();
	const unique = items.filter((it) => {
		const key = it.id || it.url;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});

	unique.sort((a, b) => {
		if (a.dateISO && b.dateISO) return b.dateISO.localeCompare(a.dateISO);
		if (a.dateISO) return -1;
		if (b.dateISO) return 1;
		return 0;
	});

	return unique.slice(0, limit);
}

// Convenience: fetch + parse + dedup/sort in one call.
export async function getNews (limit = Infinity) {
	const html = await fetchHomepage();
	return selectNewest(parseNews(html), limit);
}
