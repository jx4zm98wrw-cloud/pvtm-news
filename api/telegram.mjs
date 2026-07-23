// Vercel serverless webhook for the Telegram bot.
// Telegram POSTs every update here. When the bot is ADDED to a group or
// channel, we welcome that chat with the newest 5 pvtm.gov.vn articles.
//
// Stateless by design: each "added" event is self-contained, so there is no
// database or cache — the function fetches live news on the spot and returns.
//
// Env (set in Vercel project settings):
//   TELEGRAM_BOT_TOKEN  — the bot token
//   WEBHOOK_SECRET      — must match the secret_token given to setWebhook

import got from 'got';
import { getNews } from '../scraper.mjs';

const WELCOME_COUNT = 5;

function escapeHtml (s = '') {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildWelcome (items) {
	const header = `👋 <b>Chào mừng! ${items.length} tin mới nhất từ pvtm.gov.vn</b>`;
	const blocks = items.map((it) => {
		const meta = [it.category, it.date].filter(Boolean).join(' · ');
		const metaLine = meta ? `<i>${escapeHtml(meta)}</i>\n` : '';
		return `${metaLine}<a href="${it.url}">${escapeHtml(it.title)}</a>`;
	});
	return [header, '', blocks.join('\n\n')].join('\n');
}

async function sendMessage (chatId, text) {
	await got.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
		json: { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true },
		timeout: { request: 15000 }
	});
}

// True when this update is the bot itself being added to a group/channel.
function botWasAdded (update) {
	const mcm = update.my_chat_member;
	if (!mcm) return null;
	const was = mcm.old_chat_member?.status;
	const now = mcm.new_chat_member?.status;
	const added = ['left', 'kicked'].includes(was) && ['member', 'administrator'].includes(now);
	return added ? mcm.chat.id : null;
}

export default async function handler (req, res) {
	// Health check / anything that isn't Telegram's POST.
	if (req.method !== 'POST') return res.status(200).send('ok');

	// Verify the secret Telegram echoes back, so randoms can't spoof updates.
	const secret = process.env.WEBHOOK_SECRET;
	if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
		return res.status(401).send('unauthorized');
	}

	const update = req.body || {};
	const chatId = botWasAdded(update);

	// Always ack (200) so Telegram doesn't retry non-welcome updates.
	if (!chatId) return res.status(200).send('ignored');

	try {
		const items = await getNews(WELCOME_COUNT);
		if (items.length) await sendMessage(chatId, buildWelcome(items));
	} catch (err) {
		console.error('welcome failed:', err.message); // still 200 — avoid retry storms
	}
	return res.status(200).send('ok');
}
