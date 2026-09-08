// Channel layer — sends grouped items to Telegram (multi-target) + Email.
// Each channel activates only if its env vars are present. Never throws.
// Secrets come from process.env only.

import got from 'got';
import nodemailer from 'nodemailer';
import { buildTelegram, buildEmail, buildPlainText, buildSubject } from './messages.mjs';
import { buildGazetteSubject, buildGazettePlainText, buildGazetteEmail } from './messages-ipvn.mjs';

// pvtm Telegram destinations: shared bot (TELEGRAM_BOT_TOKEN) → the comma-
// separated chat list in TELEGRAM_CHAT_ID_PVTM (one bot, one-or-many chats).
// Naming convention: transport (bot token, SMTP) is shared and un-suffixed;
// per-monitor recipients carry a _<MON> suffix (pvtm here, _IPVN for the gazette).
function telegramTargets () {
	const token = process.env.TELEGRAM_BOT_TOKEN;
	const chatIds = (process.env.TELEGRAM_CHAT_ID_PVTM || '').split(',').map((s) => s.trim()).filter(Boolean);
	if (!token || chatIds.length === 0) return [];
	return chatIds.map((chatId) => ({ token, chatId }));
}

// Post one pre-built payload to one chat. Isolated so both the multi-bot pvtm
// sender and the single-route feed sender share identical transport + timeout.
function postTelegram (token, chatId, payload) {
	return got.post(`https://api.telegram.org/bot${token}/sendMessage`, {
		json: { chat_id: chatId, text: payload.text, parse_mode: 'HTML',
			disable_web_page_preview: true, reply_markup: payload.reply_markup },
		timeout: { request: 15000 }
	});
}

// Public-log-safe per-target failure logging (no token/chat-id; position #1/#2…).
function logRejected (results) {
	results.forEach((r, i) => {
		if (r.status === 'rejected') {
			const e = r.reason;
			const detail = e?.response?.body || e?.code || e?.name || 'send failed';
			console.error(`telegram: target #${i + 1} failed:`, typeof detail === 'string' ? detail.slice(0, 200) : detail);
		}
	});
}

async function sendTelegram (items, opts) {
	const targets = telegramTargets();
	if (targets.length === 0) return { channel: 'telegram', skipped: 'missing env' };

	const { text, reply_markup } = buildTelegram(items, opts);
	const results = await Promise.allSettled(targets.map((t) => postTelegram(t.token, t.chatId, { text, reply_markup })));
	logRejected(results);
	const ok = results.filter((r) => r.status === 'fulfilled').length;
	if (ok < targets.length) return { channel: 'telegram', error: `delivered to ${ok}/${targets.length} chat(s)` };
	return { channel: 'telegram', sent: `${items.length} item(s) → ${targets.length} chat(s)` };
}

// Send a pre-built Telegram payload to a SINGLE route named by env vars.
// Reads ONLY tokenEnv/chatEnv — never falls back to the pvtm default chat.
// Used by isolated feeds (e.g. the IP gazette feed) for their own recipients.
export async function notifyTelegramTo (payload, { tokenEnv = 'TELEGRAM_BOT_TOKEN', chatEnv } = {}) {
	const token = process.env[tokenEnv];
	const chatIds = (process.env[chatEnv] || '').split(',').map((s) => s.trim()).filter(Boolean);
	if (!token || chatIds.length === 0) return { channel: 'telegram', skipped: `missing ${chatEnv || 'chatEnv'}` };
	const results = await Promise.allSettled(chatIds.map((id) => postTelegram(token, id, payload)));
	logRejected(results);
	const ok = results.filter((r) => r.status === 'fulfilled').length;
	if (ok < chatIds.length) return { channel: 'telegram', error: `delivered to ${ok}/${chatIds.length} chat(s)` };
	return { channel: 'telegram', sent: `→ ${chatIds.length} chat(s)` };
}

// Shared SMTP transporter, built from the same env pattern for every email
// sender (pvtm's sendEmail + the isolated-feed notifyEmailTo below).
function smtpTransporter () {
	const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
	return nodemailer.createTransport({
		host: SMTP_HOST,
		port: Number(SMTP_PORT) || 587,
		secure: process.env.SMTP_SECURE === 'true',
		auth: { user: SMTP_USER, pass: SMTP_PASS }
	});
}

async function sendEmail (items, opts) {
	const { SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_TO_PVTM } = process.env;
	if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !MAIL_TO_PVTM) return { channel: 'email', skipped: 'missing env' };

	const transporter = smtpTransporter();
	const mail = {
		from: process.env.MAIL_FROM || SMTP_USER,
		to: MAIL_TO_PVTM,
		subject: buildSubject(items),
		text: buildPlainText(items),
		html: buildEmail(items, opts)
	};
	// Hidden distribution list — recipients don't see each other (comma-separated).
	if (process.env.MAIL_BCC_PVTM) mail.bcc = process.env.MAIL_BCC_PVTM;
	await transporter.sendMail(mail);

	const bcc = process.env.MAIL_BCC_PVTM ? process.env.MAIL_BCC_PVTM.split(',').filter((s) => s.trim()).length : 0;
	return { channel: 'email', sent: bcc ? `${items.length} (to 1 + bcc ${bcc})` : items.length };
}

// Send grouped items to every configured channel. opts: { title, dateStr, days }.
export async function notifyItems (items, opts = {}) {
	if (!items.length) return [];
	const results = await Promise.allSettled([sendTelegram(items, opts), sendEmail(items, opts)]);
	return results.map((r) => (r.status === 'fulfilled' ? r.value : { channel: '?', error: r.reason?.message }));
}

// Send the IP-gazette email to a SINGLE route named by env vars. Reads ONLY
// mailToEnv — never falls back to pvtm's MAIL_TO_PVTM. Mirrors notifyTelegramTo's
// isolated-routing contract. opts: { dateStr } (forwarded to buildGazetteEmail).
export async function notifyEmailTo (items, opts = {}, { mailToEnv } = {}) {
	const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env;
	const to = (process.env[mailToEnv] || '').trim();
	if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !to) return { channel: 'email', skipped: `missing SMTP or ${mailToEnv || 'mailToEnv'}` };

	try {
		const transporter = smtpTransporter();
		await transporter.sendMail({
			from: process.env.MAIL_FROM || SMTP_USER,
			to,
			subject: buildGazetteSubject(items),
			text: buildGazettePlainText(items),
			html: buildGazetteEmail(items, opts)
		});
		return { channel: 'email', sent: items.length };
	} catch (e) {
		return { channel: 'email', error: e?.message };
	}
}
