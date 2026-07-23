// Channel layer — sends grouped items to Telegram (multi-target) + Email.
// Each channel activates only if its env vars are present. Never throws.
// Secrets come from process.env only.

import got from 'got';
import nodemailer from 'nodemailer';
import { buildTelegram, buildEmail, buildPlainText, buildSubject } from './messages.mjs';

// Telegram destinations:
//  - TELEGRAM_CHAT_ID may be comma-separated (one bot -> many chats)
//  - extra bots via TELEGRAM_BOT_TOKEN_2 / TELEGRAM_CHAT_ID_2 … _5
function telegramTargets () {
	const targets = [];
	for (const suffix of ['', '_2', '_3', '_4', '_5']) {
		const token = process.env[`TELEGRAM_BOT_TOKEN${suffix}`];
		const chatIds = process.env[`TELEGRAM_CHAT_ID${suffix}`];
		if (!token || !chatIds) continue;
		for (const chatId of chatIds.split(',').map((s) => s.trim()).filter(Boolean)) {
			targets.push({ token, chatId });
		}
	}
	return targets;
}

async function sendTelegram (items, opts) {
	const targets = telegramTargets();
	if (targets.length === 0) return { channel: 'telegram', skipped: 'missing env' };

	const { text, reply_markup } = buildTelegram(items, opts);
	const results = await Promise.allSettled(
		targets.map((t) =>
			got.post(`https://api.telegram.org/bot${t.token}/sendMessage`, {
				json: { chat_id: t.chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup },
				timeout: { request: 15000 }
			})
		)
	);
	const ok = results.filter((r) => r.status === 'fulfilled').length;
	if (ok < targets.length) return { channel: 'telegram', error: `delivered to ${ok}/${targets.length} chat(s)` };
	return { channel: 'telegram', sent: `${items.length} item(s) → ${targets.length} chat(s)` };
}

async function sendEmail (items, opts) {
	const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_TO } = process.env;
	if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !MAIL_TO) return { channel: 'email', skipped: 'missing env' };

	const transporter = nodemailer.createTransport({
		host: SMTP_HOST,
		port: Number(SMTP_PORT) || 587,
		secure: process.env.SMTP_SECURE === 'true',
		auth: { user: SMTP_USER, pass: SMTP_PASS }
	});
	const mail = {
		from: process.env.MAIL_FROM || SMTP_USER,
		to: MAIL_TO,
		subject: buildSubject(items),
		text: buildPlainText(items),
		html: buildEmail(items, opts)
	};
	// Hidden distribution list — recipients don't see each other (comma-separated).
	if (process.env.MAIL_BCC) mail.bcc = process.env.MAIL_BCC;
	await transporter.sendMail(mail);

	const bcc = process.env.MAIL_BCC ? process.env.MAIL_BCC.split(',').filter((s) => s.trim()).length : 0;
	return { channel: 'email', sent: bcc ? `${items.length} (to 1 + bcc ${bcc})` : items.length };
}

// Send grouped items to every configured channel. opts: { title, dateStr, days }.
export async function notifyItems (items, opts = {}) {
	if (!items.length) return [];
	const results = await Promise.allSettled([sendTelegram(items, opts), sendEmail(items, opts)]);
	return results.map((r) => (r.status === 'fulfilled' ? r.value : { channel: '?', error: r.reason?.message }));
}
