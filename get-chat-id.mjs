#!/usr/bin/env node
// Helper: print the chat id(s) that have messaged your bot, so you can paste
// TELEGRAM_CHAT_ID into .env. No need to read raw getUpdates JSON by hand.
//
// Prereq: set TELEGRAM_BOT_TOKEN in .env, then send your bot any message.
// Usage:  node get-chat-id.mjs

import got from 'got';

try { process.loadEnvFile(new URL('./.env', import.meta.url)); } catch { /* no .env */ }

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
	console.error('✗ TELEGRAM_BOT_TOKEN is not set. Put your @BotFather token in .env first.');
	process.exit(1);
}

let data;
try {
	data = await got(`https://api.telegram.org/bot${token}/getUpdates`).json();
} catch (err) {
	console.error('✗ Telegram request failed:', err.message, '\n  (Is the token correct?)');
	process.exit(1);
}

const updates = data.result || [];
if (updates.length === 0) {
	console.log('No messages yet. Open Telegram, send your bot ANY message, then re-run this.');
	process.exit(0);
}

const chats = new Map();
for (const u of updates) {
	const c = u.message?.chat || u.channel_post?.chat || u.my_chat_member?.chat;
	if (c) chats.set(c.id, c);
}

console.log('Chat(s) that have contacted your bot — copy the id into .env:\n');
for (const [id, c] of chats) {
	const name = c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || '';
	console.log(`  TELEGRAM_CHAT_ID=${id}    (${c.type}${name ? ': ' + name : ''})`);
}
