// Notification channels: Telegram + Email. Each channel activates ONLY if its
// environment variables are present, so you can start with one and add the
// other later. Secrets are read from process.env — never hardcoded here.
//
// Telegram env:  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
// Email env:     SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
//                MAIL_TO, MAIL_FROM (optional; defaults to SMTP_USER),
//                SMTP_SECURE ("true" for port 465)

import got from 'got';
import nodemailer from 'nodemailer';

function escapeHtml (s = '') {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncate (s = '', n = 160) {
	return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}

// Map a category to an emoji + email colours. Colour encodes importance:
// investigation notices (legally significant) get the accent tone; the rest
// stay neutral. Email uses literal hex — mail clients don't do CSS variables.
function categoryMeta (category = '') {
	const c = (category || '').toLowerCase();
	if (c.includes('điều tra')) return { emoji: '⚖️', tag: '#185FA5', bg: '#E6F1FB' };
	if (c.includes('cảnh báo')) return { emoji: '⚠️', tag: '#854F0B', bg: '#FAEEDA' };
	if (c.includes('hoạt động')) return { emoji: '📌', tag: '#5F5E5A', bg: '#F1EFE8' };
	return { emoji: '📄', tag: '#5F5E5A', bg: '#F1EFE8' };
}

// --- Telegram: HTML parse-mode only allows <b>/<i>/<a>/<code>, no layout,
// so we approximate the card with an emoji + "category · date" meta line. ----
function buildTelegramHtml (items) {
	const header = `🔔 <b>${items.length} tin mới — Cục Phòng vệ Thương mại</b>`;
	const blocks = items.map((it) => {
		const { emoji } = categoryMeta(it.category);
		const meta = [it.category, it.date].filter(Boolean).join(' · ');
		const metaLine = meta ? `${emoji} <i>${escapeHtml(meta)}</i>\n` : '';
		return `${metaLine}<a href="${it.url}">${escapeHtml(it.title)}</a>`;
	});
	return [header, '', blocks.join('\n\n')].join('\n');
}

// --- Email: table layout + fully inlined styles so Gmail/Outlook render it. --
function buildEmailHtml (items) {
	const rows = items
		.map((it) => {
			const { emoji, tag, bg } = categoryMeta(it.category);
			const meta = [
				it.category
					? `<span style="font-size:11px;font-weight:bold;color:${tag};">${escapeHtml(it.category)}</span>`
					: '',
				it.date ? `<span style="font-size:12px;color:#999999;">${it.date}</span>` : ''
			]
				.filter(Boolean)
				.join('<span style="color:#cccccc;"> &middot; </span>');
			const summary = it.summary
				? `<p style="margin:4px 0 0;font-size:13px;color:#666666;line-height:1.5;">${escapeHtml(truncate(it.summary))}</p>`
				: '';
			return `<tr><td style="padding:16px 24px;border-bottom:1px solid #f0efec;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td valign="top" width="48" style="padding-right:14px;">
      <div style="width:34px;height:34px;border-radius:8px;background:${bg};text-align:center;line-height:34px;font-size:18px;">${emoji}</div>
    </td>
    <td valign="top">
      <div style="margin-bottom:4px;">${meta}</div>
      <a href="${it.url}" style="font-size:14px;font-weight:bold;color:#1a1a1a;text-decoration:none;line-height:1.4;">${escapeHtml(it.title)}</a>
      ${summary}
    </td>
  </tr></table>
</td></tr>`;
		})
		.join('');

	return `<div style="background:#f5f5f4;padding:24px 12px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e5e5e0;border-radius:12px;">
<tr><td style="padding:20px 24px;background:#faf9f7;border-bottom:1px solid #e5e5e0;border-radius:12px 12px 0 0;">
  <p style="margin:0;font-size:12px;color:#999999;">Cảnh báo tin mới &middot; pvtm.gov.vn</p>
  <p style="margin:4px 0 0;font-size:18px;font-weight:bold;color:#1a1a1a;">${items.length} bài viết mới</p>
</td></tr>
${rows}
<tr><td style="padding:14px 24px;background:#faf9f7;border-top:1px solid #e5e5e0;border-radius:0 0 12px 12px;">
  <p style="margin:0;font-size:11px;color:#999999;">Bạn nhận email này từ pvtm-news monitor &middot; nguồn: <a href="https://pvtm.gov.vn" style="color:#185FA5;text-decoration:none;">pvtm.gov.vn</a></p>
</td></tr>
</table></td></tr></table></div>`;
}

// Plain-text part (fallback for text-only mail clients).
function buildPlainText (items) {
	return items
		.map((it) => {
			const meta = [it.category, it.date].filter(Boolean).join(' · ');
			return `${meta ? meta + '\n' : ''}${it.title}\n${it.url}`;
		})
		.join('\n\n');
}

// --- Channels ---------------------------------------------------------------
async function sendTelegram (items) {
	const token = process.env.TELEGRAM_BOT_TOKEN;
	const chatId = process.env.TELEGRAM_CHAT_ID;
	if (!token || !chatId) return { channel: 'telegram', skipped: 'missing env' };

	await got.post(`https://api.telegram.org/bot${token}/sendMessage`, {
		json: {
			chat_id: chatId,
			text: buildTelegramHtml(items),
			parse_mode: 'HTML',
			disable_web_page_preview: true
		},
		timeout: { request: 15000 }
	});
	return { channel: 'telegram', sent: items.length };
}

async function sendEmail (items) {
	const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_TO } = process.env;
	if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !MAIL_TO) {
		return { channel: 'email', skipped: 'missing env' };
	}

	const transporter = nodemailer.createTransport({
		host: SMTP_HOST,
		port: Number(SMTP_PORT) || 587,
		secure: process.env.SMTP_SECURE === 'true', // true for 465
		auth: { user: SMTP_USER, pass: SMTP_PASS }
	});

	await transporter.sendMail({
		from: process.env.MAIL_FROM || SMTP_USER,
		to: MAIL_TO,
		subject: `🔔 ${items.length} tin mới từ pvtm.gov.vn`,
		text: buildPlainText(items),
		html: buildEmailHtml(items)
	});
	return { channel: 'email', sent: items.length };
}

// Exported for tests / previews (buildEmailHtml etc. render without sending).
export { buildTelegramHtml, buildEmailHtml, buildPlainText };

// Send to every configured channel. Never throws — a failing channel is
// reported in the results array so the monitor loop keeps running.
export async function notifyNewItems (items) {
	if (!items.length) return [];

	const results = await Promise.allSettled([sendTelegram(items), sendEmail(items)]);
	return results.map((r) =>
		r.status === 'fulfilled' ? r.value : { channel: '?', error: r.reason?.message }
	);
}
