import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notifyTelegramTo } from '../notify.mjs';

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
