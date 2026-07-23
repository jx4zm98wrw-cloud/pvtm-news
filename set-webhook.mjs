#!/usr/bin/env node
// Register (or remove) the Telegram webhook that points at your Vercel function.
//
// Prereq: TELEGRAM_BOT_TOKEN (and ideally WEBHOOK_SECRET) in .env or the env.
// Usage:
//   node set-webhook.mjs https://<app>.vercel.app/api/telegram   # register
//   node set-webhook.mjs --info                                   # show current webhook
//   node set-webhook.mjs --delete                                 # remove (re-enables getUpdates)

import got from 'got';

try { process.loadEnvFile(new URL('./.env', import.meta.url)); } catch { /* no .env */ }

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
	console.error('✗ Set TELEGRAM_BOT_TOKEN in .env first.');
	process.exit(1);
}
const api = (method) => `https://api.telegram.org/bot${token}/${method}`;
const arg = process.argv[2];

if (arg === '--info') {
	console.log(await got(api('getWebhookInfo')).json());
	process.exit(0);
}

if (arg === '--delete') {
	console.log(await got.post(api('deleteWebhook')).json());
	process.exit(0);
}

if (!arg || !arg.startsWith('https://')) {
	console.error('Usage: node set-webhook.mjs https://<app>.vercel.app/api/telegram');
	process.exit(1);
}

const result = await got.post(api('setWebhook'), {
	json: {
		url: arg,
		secret_token: process.env.WEBHOOK_SECRET || undefined,
		allowed_updates: ['my_chat_member', 'message']
	}
}).json();
console.log('setWebhook:', result);
