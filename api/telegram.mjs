// Vercel webhook — welcomes a group/channel the bot is added to with the
// news of the last 7 days (grouped A→B→C→D, numbered buttons). Stateless.
//
// Env: TELEGRAM_BOT_TOKEN, WEBHOOK_SECRET

import got from 'got';
import { getAllItems, recentWindow, forDisplay } from '../scraper.mjs';
import { buildTelegram } from '../messages.mjs';

const WINDOW_DAYS = Number(process.env.WELCOME_DAYS) || 30; // override via Vercel env
const WINDOW_CAP = Number(process.env.WELCOME_CAP) || 8;

function botWasAdded (update) {
	const mcm = update.my_chat_member;
	if (!mcm) return null;
	const was = mcm.old_chat_member?.status;
	const nowSt = mcm.new_chat_member?.status;
	const added = ['left', 'kicked'].includes(was) && ['member', 'administrator'].includes(nowSt);
	return added ? mcm.chat.id : null;
}

async function sendWelcome (chatId, items, fellBack) {
	const title = fellBack
		? 'Gần đây không có tin mới — tin gần nhất'
		: `${items.length} tin mới (${WINDOW_DAYS} ngày qua)`;
	const { text, reply_markup } = buildTelegram(forDisplay(items), { title });
	await got.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
		json: { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup },
		timeout: { request: 15000 }
	});
}

export default async function handler (req, res) {
	if (req.method !== 'POST') return res.status(200).send('ok');

	// Fail closed: authenticate every request against WEBHOOK_SECRET. If the
	// secret isn't configured we can't verify the caller, so reject rather than
	// leave this public URL open to anyone (the old `secret && …` check silently
	// accepted all requests when the env var was missing).
	// NOTE: requires WEBHOOK_SECRET in the Vercel env AND that the webhook was
	// registered with the same secret_token (see set-webhook.mjs), so Telegram
	// sends the matching `x-telegram-bot-api-secret-token` header.
	const secret = process.env.WEBHOOK_SECRET;
	if (!secret || req.headers['x-telegram-bot-api-secret-token'] !== secret) {
		if (!secret) console.error('WEBHOOK_SECRET not configured — rejecting request');
		return res.status(401).send('unauthorized');
	}

	const update = req.body || {};

	// /id command — bot replies with this chat's id, to add to TELEGRAM_CHAT_ID
	// so the group also receives periodic new-news alerts (not just the welcome).
	const text = (update.message?.text || '').trim();
	if (/^\/id(@\w+)?\b/i.test(text)) {
		const id = update.message.chat.id;
		try {
			await got.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
				json: {
					chat_id: id,
					text: `🆔 Chat ID: <code>${id}</code>\nThêm ID này vào <b>TELEGRAM_CHAT_ID</b> để nhóm nhận cảnh báo tin mới.`,
					parse_mode: 'HTML'
				},
				timeout: { request: 15000 }
			});
		} catch (err) { console.error('/id failed:', err.message); }
		return res.status(200).send('ok');
	}

	const chatId = botWasAdded(update);
	if (!chatId) return res.status(200).send('ignored');

	try {
		const { items, fellBack } = recentWindow(await getAllItems(), WINDOW_DAYS, WINDOW_CAP);
		if (items.length) await sendWelcome(chatId, items, fellBack);
	} catch (err) {
		console.error('welcome failed:', err.message); // still 200 — avoid retry storms
	}
	return res.status(200).send('ok');
}
