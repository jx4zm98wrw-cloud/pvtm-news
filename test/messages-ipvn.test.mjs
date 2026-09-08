import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGazetteTelegram, buildDegradedAlert } from '../messages-ipvn.mjs';

const item = (o = {}) => ({ key: '465', title: 'Số 465 ngày 17 tháng 08 năm 2026',
  url: 'https://www.ipvietnam.gov.vn/x?a=1&b=2', date: '17/08/2026', dateISO: '2026-08-17', ...o });

test('buildGazetteTelegram: masthead 📕 + numbered link + date', () => {
  const { text, reply_markup } = buildGazetteTelegram([item()], { title: '1 công báo mới' });
  assert.match(text, /📕 <b>Công báo Sở hữu công nghiệp<\/b>/);
  assert.match(text, /<b>1\.<\/b> <a href="https:\/\/www\.ipvietnam\.gov\.vn\/x\?a=1&amp;b=2">Số 465/);
  assert.match(text, /17\/08\/2026/);
  assert.equal(reply_markup.inline_keyboard[0][0].url, 'https://www.ipvietnam.gov.vn/cong-bao-so-huu-cong-nghiep1');
});

test('buildGazetteTelegram escapes a hostile title', () => {
  const { text } = buildGazetteTelegram([item({ title: 'Số 1 <script>&"x"' })]);
  assert.doesNotMatch(text, /<script>/);
  assert.match(text, /&lt;script&gt;/);
});

test('buildDegradedAlert down/up', () => {
  assert.match(buildDegradedAlert('down').text, /⚠️.*không đọc được/);
  assert.match(buildDegradedAlert('up').text, /✅.*trở lại/);
});
