// Presentation layer — builds channel messages from grouped items.
// Pure (no network / no nodemailer) so the Vercel webhook can import it cheaply.
// Items must already be display-sorted (scraper.forDisplay).

import { GROUPS, BASE_URL } from './scraper.mjs';

function escapeHtml (s = '') {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Group items into ordered sections A→B→C→D (skips empty groups).
function sections (items) {
	return GROUPS.map((g) => ({
		key: g.key, emoji: g.emoji, label: g.label,
		items: items.filter((it) => it.group === g.key)
	})).filter((s) => s.items.length > 0);
}

function metaText (it) {
	return [it.category, it.date].filter(Boolean).join(' · ');
}

// --- Telegram: full titles in text (numbered by group) + inline number buttons.
export function buildTelegram (items, { title } = {}) {
	const header = `📡 <b>PVTM Radar</b> · ${escapeHtml(title || `${items.length} tin mới`)}`;
	const lines = [header, ''];
	let n = 0;
	for (const sec of sections(items)) {
		lines.push(`${sec.emoji} <b>${escapeHtml(sec.label)}</b>`);
		for (const it of sec.items) {
			n++;
			const head = it.isDoc && it.code ? `${escapeHtml(it.code)} — ` : '';
			const dl = it.isDoc ? ' ⬇' : '';
			const meta = metaText(it);
			// Numbered for reference; the title itself is the link (tap it directly).
			// 🔄 = the site changed this article's title since we last alerted it.
			const upd = it.updated ? '🔄 ' : '';
			lines.push(`<b>${n}.</b> ${upd}<a href="${it.url}">${head}${escapeHtml(it.title)}</a>${dl}${meta ? ` <i>(${escapeHtml(meta)})</i>` : ''}`);
		}
		lines.push('');
	}

	return {
		text: lines.join('\n').trim(),
		reply_markup: { inline_keyboard: [[{ text: 'Tất cả tin ↗', url: BASE_URL }]] }
	};
}

// Plain text (email fallback + logs).
export function buildPlainText (items) {
	const out = [];
	for (const sec of sections(items)) {
		out.push(`${sec.emoji} ${sec.label}`);
		for (const it of sec.items) {
			const head = it.isDoc && it.code ? `${it.code} — ` : '';
			const meta = metaText(it);
			out.push(`• ${it.updated ? '🔄 ' : ''}${head}${it.title}${meta ? ` (${meta})` : ''}\n  ${it.url}`);
		}
		out.push('');
	}
	return out.join('\n').trim();
}

// Email subject: brand-forward + informative (lead headline). Recognizable in
// the inbox at a glance: "PVTM Radar · <tin nổi bật>… (+N tin)".
// Clip to <= n chars at a WORD boundary (avoid cutting mid-word), then add "…".
function clipWords (s, n) {
	if (s.length <= n) return s;
	const cut = s.slice(0, n);
	const sp = cut.lastIndexOf(' ');
	return (sp > n * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + '…';
}

export function buildSubject (items) {
	if (!items.length) return 'PVTM Radar';
	const lead = items[0].isDoc && items[0].code ? `${items[0].code} — ${items[0].title}` : items[0].title;
	const more = items.length > 1 ? ` (+${items.length - 1} tin)` : '';
	return `PVTM Radar · ${clipWords(lead, 60)}${more}`;
}

// --- Email: navy/gold newsletter. Table layout + inlined styles (Gmail/Outlook).
// Committed light design (renders the same in any client theme).
const C = {
	navy: '#0B2A4A', gold: '#C79A3E', goldTx: '#9A7620', goldBg: '#F3E8CC',
	ink: '#17252E', sub: '#4A5C6B', muted: '#96A6B4', hair: '#E4E9EE',
	accBg: '#E7EEF6', heroBg: '#F3F6FA', neuBg: '#F1F4F7'
};

function emailBadge (it) {
	const on = it.group === 'A' || it.isDoc;
	const bg = on ? C.accBg : C.neuBg;
	const tx = on ? C.navy : C.sub;
	const text = it.isDoc && it.code ? it.code : it.category;
	return `<span style="font-size:10.5px;font-weight:600;color:${tx};background:${bg};padding:1px 8px;border-radius:5px;">${escapeHtml(text || '')}</span>`;
}

function emailItemRow (it) {
	const emoji = GROUPS.find((g) => g.key === it.group)?.emoji || '•';
	const iconBg = it.group === 'A' ? C.accBg : (it.isDoc ? C.goldBg : C.neuBg);
	const summary = it.summary
		? `<p style="margin:4px 0 0;font-size:12.5px;color:${C.sub};line-height:1.5;">${escapeHtml(it.summary.slice(0, 160))}</p>`
		: '';
	const dl = it.isDoc
		? `<br><a href="${it.url}" style="display:inline-block;margin-top:8px;font-size:12px;font-weight:600;color:${C.goldTx};background:${C.goldBg};padding:5px 12px;border-radius:6px;text-decoration:none;">⬇ Tải văn bản</a>`
		: '';
	return `<tr><td style="padding:14px 26px;border-bottom:1px solid ${C.hair};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td valign="top" width="50" style="padding-right:13px;"><div style="width:38px;height:38px;border-radius:9px;background:${iconBg};text-align:center;line-height:38px;font-size:18px;">${emoji}</div></td>
<td valign="top">
<div style="margin-bottom:3px;">${emailBadge(it)} <span style="font-size:11.5px;color:${C.muted};">· ${it.date || '—'}</span></div>
<a href="${it.url}" style="font-size:14px;font-weight:500;color:${C.ink};text-decoration:none;line-height:1.45;">${it.updated ? '🔄 ' : ''}${escapeHtml(it.title)}</a>${dl}${summary}
</td></tr></table></td></tr>`;
}

function emailSectionHeader (sec) {
	return `<tr><td style="padding:16px 26px 8px;">
<table role="presentation" width="100%"><tr>
<td width="10" style="padding-right:8px;"><div style="width:3px;height:15px;background:${C.gold};border-radius:2px;"></div></td>
<td style="font-size:12.5px;font-weight:600;color:${C.navy};">${sec.emoji} ${escapeHtml(sec.label)}</td>
<td align="right" style="font-size:11px;color:${C.muted};">${sec.items.length} mục</td>
</tr></table></td></tr>`;
}

export function buildEmail (items, { title, dateStr, days = 7 } = {}) {
	const rows = sections(items).map((sec) =>
		emailSectionHeader(sec) + sec.items.map((it) => emailItemRow(it)).join('')
	).join('');

	return `<div style="background:#EEF1F4;padding:16px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:14px;overflow:hidden;">
<tr><td style="background:${C.navy};padding:20px 28px;">
<table role="presentation" width="100%"><tr>
<td width="56" style="padding-right:14px;"><div style="width:42px;height:42px;border-radius:10px;border:1.5px solid ${C.gold};text-align:center;line-height:42px;font-size:20px;">⚖️</div></td>
<td><div style="font-size:17px;font-weight:600;color:#FFFFFF;letter-spacing:.04em;">PVTM <span style="color:${C.gold};">RADAR</span></div><div style="font-size:11px;color:#9FB2C6;">Điểm tin phòng vệ thương mại</div></td>
<td align="right"><div style="font-size:13px;color:#FFFFFF;font-weight:500;">${dateStr || ''}</div><div style="font-size:10px;color:#9FB2C6;">${days} ngày qua</div></td>
</tr></table></td></tr>
<tr><td style="height:3px;background:${C.gold};font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:16px 28px 4px;font-size:12px;color:${C.sub};">Tổng hợp <b style="color:${C.ink};">${escapeHtml(title || `${items.length} tin mới`)}</b></td></tr>
${rows}
<tr><td style="padding:20px 28px;"><a href="${BASE_URL}" style="display:block;text-align:center;background:${C.gold};color:${C.navy};border-radius:9px;padding:13px;font-size:13.5px;font-weight:600;text-decoration:none;">Xem toàn bộ tin trên pvtm.gov.vn →</a></td></tr>
<tr><td style="background:${C.navy};padding:18px 28px;">
<div style="font-size:12px;color:#C8D5E2;line-height:1.6;">Bản tin tổng hợp tự động từ <b style="color:#FFFFFF;">pvtm.gov.vn</b> — Cục Phòng vệ Thương mại, Bộ Công Thương.</div>
<div style="margin-top:8px;padding-top:10px;border-top:1px solid #1C4067;font-size:10.5px;color:#7C93AB;">Email tự động do PVTM Radar gửi · Không phải thư chính thức của cơ quan.</div>
</td></tr>
</table></td></tr></table></div>`;
}
