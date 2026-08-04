// Unit tests for the pure presentation layer (messages.mjs).
// Run with: npm test   (node --test)
//
// These are the launch-critical safety nets: message building is where scraped,
// untrusted site content becomes Telegram HTML — a missed escape either breaks
// delivery (Telegram rejects malformed entities) or renders wrong.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTelegram, buildSubject, buildPlainText } from '../messages.mjs';

const item = (o = {}) => ({
	group: 'A', title: 'Test title', url: 'https://pvtm.gov.vn/x?a=1&b=2',
	category: 'Tin điều tra', date: '01/08/2026', ...o
});

test('buildTelegram escapes HTML special chars in titles', () => {
	const { text } = buildTelegram([item({ title: 'A <b>bold</b> & risky' })]);
	assert.ok(text.includes('&lt;b&gt;bold&lt;/b&gt;'), 'angle brackets in title must be escaped');
	assert.ok(text.includes('&amp;'), 'ampersand in title must be escaped');
});

test('buildTelegram escapes quotes and ampersands inside the href attribute', () => {
	const { text } = buildTelegram([item({ url: 'https://x.test/a?u="evil"&z=1' })]);
	assert.ok(text.includes('&quot;'), 'a double-quote in the URL must be escaped so it cannot break out of href');
	assert.ok(!text.includes('"evil"'), 'raw unescaped quote must not appear in the message');
	assert.ok(text.includes('href='), 'the title is still a link');
});

test('buildTelegram marks retitled items with the update glyph', () => {
	const { text } = buildTelegram([item({ updated: true })]);
	assert.ok(text.includes('🔄'), 'an updated item shows the 🔄 marker');
});

test('buildSubject leads with the brand and clips a long headline at a word boundary', () => {
	const long = 'Quyết định điều tra áp dụng biện pháp chống bán phá giá đối với một số sản phẩm thép cán nóng nhập khẩu';
	const s = buildSubject([item({ title: long }), item({ title: 'Tin thứ hai' })]);
	assert.ok(s.startsWith('PVTM Radar · '), 'subject is brand-forward');
	assert.ok(s.includes('(+1 tin)'), 'subject notes the count of remaining items');
	assert.ok(s.includes('…'), 'a long headline is clipped with an ellipsis');
});

test('buildSubject handles the empty case without throwing', () => {
	assert.equal(buildSubject([]), 'PVTM Radar');
});

test('buildPlainText includes the raw URL and the update marker', () => {
	const txt = buildPlainText([item({ updated: true })]);
	assert.ok(txt.includes('https://pvtm.gov.vn'), 'plain text keeps the clickable URL');
	assert.ok(txt.includes('🔄'), 'plain text also flags updates');
});
