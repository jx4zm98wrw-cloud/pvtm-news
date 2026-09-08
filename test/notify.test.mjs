import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notifyTelegramTo, notifyEmailTo } from '../notify.mjs';

test('notifyTelegramTo skips (no send) when its chatEnv is unset — no fallback', async () => {
  delete process.env.TELEGRAM_CHAT_ID_IPVN;
  process.env.TELEGRAM_BOT_TOKEN = 'x';
  const r = await notifyTelegramTo({ text: 'hi' }, { chatEnv: 'TELEGRAM_CHAT_ID_IPVN' });
  assert.equal(r.channel, 'telegram');
  assert.match(r.skipped, /TELEGRAM_CHAT_ID_IPVN/);
  assert.equal(r.sent, undefined);
  assert.equal(r.error, undefined);
});

test('notifyTelegramTo skips when token env is unset', async () => {
  process.env.TELEGRAM_CHAT_ID_IPVN = '-100123';
  delete process.env.TELEGRAM_BOT_TOKEN;
  const r = await notifyTelegramTo({ text: 'hi' }, { chatEnv: 'TELEGRAM_CHAT_ID_IPVN' });
  assert.ok(r.skipped);
});

test('notifyEmailTo skips (no send) when its mailToEnv is unset — no fallback to MAIL_TO_PVTM', async () => {
  delete process.env.MAIL_TO_IPVN;
  process.env.SMTP_HOST = 'smtp.example.com';
  process.env.SMTP_USER = 'u';
  process.env.SMTP_PASS = 'p';
  process.env.MAIL_TO_PVTM = 'someone@else.com'; // pvtm's own recipient — must never be used as a fallback
  const r = await notifyEmailTo([{ key: '1', title: 't', url: 'https://x', date: '01/01/2026' }], {}, { mailToEnv: 'MAIL_TO_IPVN' });
  assert.equal(r.channel, 'email');
  assert.match(r.skipped, /MAIL_TO_IPVN/);
  assert.equal(r.sent, undefined);
  assert.equal(r.error, undefined);
  delete process.env.MAIL_TO_PVTM;
});

test('notifyEmailTo skips when SMTP env is missing', async () => {
  process.env.MAIL_TO_IPVN = 'ip-team@example.com';
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  const r = await notifyEmailTo([{ key: '1', title: 't', url: 'https://x', date: '01/01/2026' }], {}, { mailToEnv: 'MAIL_TO_IPVN' });
  assert.equal(r.channel, 'email');
  assert.ok(r.skipped);
});
