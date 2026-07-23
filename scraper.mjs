// Data layer for pvtm.gov.vn — fetch + parse + group + sort. No side effects.
// Sources per group:
//   A/B/C  -> news browse pages (div.news cards):  ?page=news&do=browse&category_id=…
//   D      -> legal table pages:                   ?page=legal&category_id=…

import got from 'got';
import * as cheerio from 'cheerio';

export const BASE_URL = 'https://pvtm.gov.vn';

// Priority groups A→B→C→D. Each category = { id, name }.
export const GROUPS = [
	{ key: 'A', label: 'Tin điều tra', emoji: '⚖️', type: 'news', cats: [
		{ id: '91b07cf1-3658-4f39-b688-73b9e8ff8a05', name: 'Điều tra VN' },
		{ id: '061fcf6d-54dd-4a7b-9293-33e0c3c218ad', name: 'Điều tra nước ngoài' },
		{ id: 'ba011a30-923a-477c-ac10-9d65e97ae104', name: 'Quyết định miễn trừ' }
	] },
	{ key: 'B', label: 'Tin chung', emoji: '📌', type: 'news', cats: [
		{ id: 'dc20631d-b698-41fe-b945-72a1a71e8c8c', name: 'Tin hoạt động' },
		{ id: 'd9ee2fcf-a0b1-446c-9bd9-87a14f695cd6', name: 'Thị trường – Ngành hàng' },
		{ id: 'b440999f-cd9a-4cea-b8d6-e1a090d01cdb', name: 'Tin khác' }
	] },
	{ key: 'C', label: 'Ấn phẩm', emoji: '📰', type: 'news', cats: [
		{ id: '353327ef-2d62-49fb-bd95-8411bdb046b3', name: 'Bản tin PVTM & Cảnh báo sớm' },
		{ id: '9b13725e-e38b-4849-afb4-8365288d722e', name: 'Bản tin Quý' }
	] },
	{ key: 'D', label: 'Văn bản', emoji: '📄', type: 'legal', cats: [
		{ id: 'ab0a8044-906f-4c1b-927c-592a8ab825ca', name: 'Văn bản pháp luật VN' },
		{ id: '4b41f8af-e7bf-4647-a635-7361c399af22', name: 'Hiệp định WTO' },
		{ id: '158d217d-8755-4c04-bbee-ee574d9ab32f', name: 'Hiệp định FTA' },
		{ id: '0255c368-49da-429e-a3d3-7d073bbe5319', name: 'Pháp luật nước khác' },
		{ id: '7c13fdf9-3f5c-4466-9a40-47cb55504d5c', name: 'Quyết định miễn trừ' }
	] }
];

const PRIORITY = { A: 0, B: 1, C: 2, D: 3 };

// How to source each group. C (newsletter) uses a distinct table layout that
// is not yet parsed — it is DEFERRED (parse:null skips fetch) so the rest ships.
const GROUP_SOURCE = {
	A: { page: 'news', parse: 'cards' },
	B: { page: 'news', parse: 'cards' },
	C: { page: 'newsletter', parse: null }, // TODO: newsletter bulletin tables — add parser
	D: { page: 'legal', parse: 'table' }
};
const UA = {
	headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
	timeout: { request: 20000 }
};

export function labelOf (key) {
	const g = GROUPS.find((x) => x.key === key);
	return g ? `${g.emoji} ${g.label}` : key;
}

// DD/MM/YYYY -> YYYY-MM-DD (sortable). null if absent (e.g. WTO agreements).
export function toISODate (raw) {
	const m = (raw || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
	if (!m) return null;
	return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

// --- Parsers ---------------------------------------------------------------
function parseNewsCards (html, groupKey, cat) {
	const $ = cheerio.load(html);
	const items = [];
	$('div.news').each((_, el) => {
		const $el = $(el);
		const href = $el.find('.news__title a').attr('href') || $el.find('a.news__frame').attr('href');
		const id = (href || '').match(/id=([0-9a-f-]{36})/i);
		if (!id) return;
		const dateRaw = ($el.find('.news__info').text().match(/\d{1,2}\/\d{1,2}\/\d{4}/) || [])[0] || null;
		items.push({
			group: groupKey, groupLabel: labelOf(groupKey), category: cat.name,
			key: id[1],
			code: null,
			title: $el.find('.news__title').text().replace(/\s+/g, ' ').trim() ||
				($el.find('a.news__frame img').attr('alt') || '').trim(),
			url: new URL(href, BASE_URL).href,
			date: dateRaw, dateISO: toISODate(dateRaw),
			summary: $el.find('.news__desc').text().replace(/\s+/g, ' ').trim() || null,
			isDoc: false
		});
	});
	return items;
}

function parseLegalTable (html, cat) {
	const $ = cheerio.load(html);
	// "Tải về" is a JS link (#!) with no static URL, so we link to the listing page.
	const pageUrl = `${BASE_URL}/default.aspx?page=legal&category_id=${cat.id}`;
	const items = [];
	$('table tr').each((i, tr) => {
		if (i === 0) return; // header row
		const tds = $(tr).find('td');
		if (tds.length < 3) return;
		const code = $(tds[0]).text().replace(/\s+/g, ' ').trim();
		// Title is the anchor; plain .text() also grabs a hidden modal (duplicate).
		const title = ($(tds[1]).find('a.doc-table__title').first().text() ||
			$(tds[1]).text()).replace(/\s+/g, ' ').trim();
		if (!code && !title) return;
		const dateRaw = ($(tds[2]).text().match(/\d{1,2}\/\d{1,2}\/\d{4}/) || [])[0] || null;
		items.push({
			group: 'D', groupLabel: labelOf('D'), category: cat.name,
			key: code || `${cat.id}:${title}`, // Số ký hiệu = stable identity
			code: code || null,
			title, url: pageUrl,
			date: dateRaw, dateISO: toISODate(dateRaw),
			summary: null, isDoc: true
		});
	});
	return items;
}

async function fetchCategory (groupKey, cat) {
	const src = GROUP_SOURCE[groupKey];
	if (!src || !src.parse) return []; // deferred group (e.g. C)
	const q = src.page === 'news' ? 'page=news&do=browse' : `page=${src.page}`;
	const url = `${BASE_URL}/default.aspx?${q}&category_id=${cat.id}`;
	try {
		const html = (await got(url, UA)).body;
		return src.parse === 'table' ? parseLegalTable(html, cat) : parseNewsCards(html, groupKey, cat);
	} catch {
		return []; // a failing category must not kill the whole run
	}
}

// Fetch every category (parallel), merge, dedup by key. Items are pre-tagged
// with group — nothing outside A/B/C/D is ever fetched, so "newest" is always
// computed over the filtered set (no filter-after-select gap).
export async function getAllItems () {
	const tasks = [];
	for (const g of GROUPS) for (const cat of g.cats) tasks.push(fetchCategory(g.key, cat));
	const results = await Promise.all(tasks);
	const seen = new Set();
	const merged = [];
	for (const arr of results) for (const it of arr) {
		if (seen.has(it.key)) continue;
		seen.add(it.key);
		merged.push(it);
	}
	return merged;
}

// Sort by date, newest first; undated sink to the bottom.
export function byNewest (items) {
	return [...items].sort((a, b) => {
		if (a.dateISO && b.dateISO) return b.dateISO.localeCompare(a.dateISO);
		if (a.dateISO) return -1;
		if (b.dateISO) return 1;
		return 0;
	});
}

// Display order: group A→B→C→D, within a group newest first.
export function forDisplay (items) {
	return [...items].sort((a, b) => {
		if (PRIORITY[a.group] !== PRIORITY[b.group]) return PRIORITY[a.group] - PRIORITY[b.group];
		if (a.dateISO && b.dateISO) return b.dateISO.localeCompare(a.dateISO);
		if (a.dateISO) return -1;
		if (b.dateISO) return 1;
		return 0;
	});
}

// Welcome selection: items published within `days`, newest first, capped.
// Fallback to the single newest item if nothing is recent (never empty).
// `nowMs` is injectable for testing; defaults to real time.
export function recentWindow (items, days = 7, cap = 8, nowMs = Date.now()) {
	const dated = items.filter((i) => i.dateISO);
	const cutoff = new Date(nowMs - days * 86400000).toISOString().slice(0, 10);
	const recent = byNewest(dated.filter((i) => i.dateISO >= cutoff)).slice(0, cap);
	if (recent.length > 0) return { items: recent, fellBack: false };
	return { items: byNewest(dated).slice(0, 1), fellBack: true };
}
