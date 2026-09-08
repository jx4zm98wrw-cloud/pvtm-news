import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGazette, toISODate, isBroken } from '../ipvn.mjs';

const HTML = `<table>
<tr><th>Tiêu đề</th><th>Ngày xuất bản</th></tr>
<tr><td><a href="https://www.ipvietnam.gov.vn/web/guest/x/-/content/so-465-ngay-17-thang-08-nam-2026">Số 465 ngày 17 tháng 08 năm 2026</a></td><td>17/08/2026</td></tr>
<tr><td><a href="/web/guest/x/-/content/so-457">Số 457 tháng 04 năm 2026</a></td><td>27/04/2026</td></tr>
</table>`;

test('parseGazette: number from title, date from column, absolute url', () => {
  const { items, rows, dropped } = parseGazette(HTML);
  assert.equal(rows, 2);
  assert.equal(dropped.length, 0);
  assert.equal(items[0].key, '465');
  assert.equal(items[0].dateISO, '2026-08-17');
  assert.equal(items[0].date, '17/08/2026');
  assert.ok(items[0].url.startsWith('https://www.ipvietnam.gov.vn/'));
  // #2: the "tháng 04" (no day) format still parses its number
  assert.equal(items[1].key, '457');
  assert.equal(items[1].dateISO, '2026-04-27');
});

test('parseGazette: header row is not counted as content or dropped', () => {
  const { rows, dropped } = parseGazette(HTML);
  assert.equal(rows, 2);             // only the 2 anchored rows
  assert.equal(dropped.length, 0);   // "Tiêu đề" header never enters dropped
});

test('parseGazette: #3 flags label↔slug number mismatch', () => {
  const html = `<table><tr><td><a href="/x/so-464-...">Số 465 ...</a></td><td>17/08/2026</td></tr></table>`;
  assert.equal(parseGazette(html).items[0].numberMismatch, true);
});

test('parseGazette: a content row with no issue number goes to dropped, not items', () => {
  const html = `<table><tr><td><a href="/x/thongbao">Thông báo abc</a></td><td>01/01/2026</td></tr></table>`;
  const { items, dropped } = parseGazette(html);
  assert.equal(items.length, 0);
  assert.equal(dropped.length, 1);
});

test('isBroken: 0 rows OR 0 items = structural failure (guard #1)', () => {
  assert.equal(isBroken({ rows: 0, items: [] }), true);
  assert.equal(isBroken({ rows: 3, items: [] }), true);
  assert.equal(isBroken({ rows: 2, items: [{ key: '465' }] }), false);
});

test('toISODate handles DD/MM/YYYY and null', () => {
  assert.equal(toISODate('04/05/2026'), '2026-05-04');
  assert.equal(toISODate(''), null);
});
