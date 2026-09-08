// Presentation layer for the IP-gazette feed. Pure (no network). Separate from
// messages.mjs because the gazette has its own brand (📕) and a flat issue list,
// not the A→D grouped PVTM Radar layout.
import { escapeHtml, escapeAttr } from './messages.mjs';

export const SOURCE_URL = 'https://www.ipvietnam.gov.vn/cong-bao-so-huu-cong-nghiep1';

// items: [{ key, title, url, date, dateISO }] — already newest-first.
export function buildGazetteTelegram (items, { title } = {}) {
  const header = `📕 <b>Công báo Sở hữu công nghiệp</b> · ${escapeHtml(title || `${items.length} số mới`)}`;
  const lines = [header, ''];
  items.forEach((it, i) => {
    const date = it.date ? ` <i>· ${escapeHtml(it.date)}</i>` : '';
    lines.push(`<b>${i + 1}.</b> <a href="${escapeAttr(it.url)}">${escapeHtml(it.title)}</a>${date}`);
  });
  return {
    text: lines.join('\n').trim(),
    reply_markup: { inline_keyboard: [[{ text: 'Xem tất cả công báo ↗', url: SOURCE_URL }]] }
  };
}

// Guard #1 status message. 'down' when the table can't be read; 'up' on recovery.
export function buildDegradedAlert (kind) {
  const text = kind === 'down'
    ? '⚠️ <b>Công báo SHCN</b>: không đọc được danh sách trên ipvietnam.gov.vn (0 dòng / cấu trúc lạ). Có thể site đã đổi giao diện — cần kiểm tra parser.'
    : '✅ <b>Công báo SHCN</b>: feed đã hoạt động trở lại.';
  return { text, reply_markup: undefined };
}

// --- Email (Feed 2). Committed LIGHT design (no dark mode) — muted palette,
// deliberately distinct from PVTM Radar's navy/gold so the two are never
// confused in an inbox even though they can share a bot/SMTP account.
const EC = {
  ink: '#3B3630', gold: '#C6A56E', mast: '#F3EEE6', mastSub: '#B4A99B',
  body: '#EEE8E0', card: '#FFFFFF', cardBorder: '#E7DECF',
  intro: '#5c5346', introStrong: '#2a2520',
  badgeBg: '#F1EAE2', badgeNum: '#8A5560', badgeTx: '#7A5A50',
  rowHair: '#EEE6D9', metaTx: '#9a8a72', titleTx: '#33302B',
  btnTx: '#7A5E2E', btnBg: '#EFE6D4',
  ctaBg: '#7E5058', ctaTx: '#FFFFFF',
  footTx: '#CFC6BA', footHair: '#55504A', footSub: '#A99E90'
};

function vnDateNow () {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
}

// Email subject: brand-forward, leads with the newest issue. Empty items ->
// bare masthead (no issue to name).
export function buildGazetteSubject (items) {
  if (!items.length) return '📕 Công báo SHCN';
  const [lead, ...rest] = items;
  const more = rest.length ? ` +${rest.length} số` : '';
  return `📕 Công báo SHCN · Số ${lead.key} (${lead.date})${more}`;
}

// Plain-text fallback (clients that don't render HTML).
export function buildGazettePlainText (items) {
  return items.map((it) => `• Số ${it.key} — ${it.date}\n  ${it.url}`).join('\n');
}

function gazetteRow (it) {
  return `<tr><td style="padding:10px 26px;border-bottom:1px solid ${EC.rowHair};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td valign="top" width="52" style="padding-right:14px;">
<div style="width:44px;height:44px;border-radius:9px;background:${EC.badgeBg};text-align:center;line-height:44px;font-size:15px;font-weight:700;color:${EC.badgeNum};">${escapeHtml(it.key)}</div>
</td>
<td valign="top">
<div style="margin-bottom:3px;"><span style="font-size:10.5px;font-weight:600;color:${EC.badgeTx};background:${EC.badgeBg};padding:1px 8px;border-radius:5px;">Công báo SHCN</span> <span style="font-size:11.5px;color:${EC.metaTx};">· ${escapeHtml(it.date || '')}</span></div>
<a href="${escapeAttr(it.url)}" style="font-size:14.5px;font-weight:600;color:${EC.titleTx};text-decoration:none;line-height:1.45;">${escapeHtml(it.title)}</a>
<br><a href="${escapeAttr(it.url)}" style="display:inline-block;margin-top:8px;font-size:12px;font-weight:600;color:${EC.btnTx};background:${EC.btnBg};padding:5px 12px;border-radius:6px;text-decoration:none;">↗ Mở trên Cổng SHCN</a>
</td>
</tr></table>
</td></tr>`;
}

// buildGazetteEmail: table layout + inlined styles (Gmail/Outlook), matching
// the approved preview exactly. items already newest-first.
export function buildGazetteEmail (items, { dateStr } = {}) {
  const date = dateStr || vnDateNow();
  const rows = items.map((it) => gazetteRow(it)).join('');

  return `<div style="background:${EC.body};padding:16px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${EC.card};border-radius:14px;overflow:hidden;border:1px solid ${EC.cardBorder};">

<tr><td style="background:${EC.ink};padding:20px 28px;">
<table role="presentation" width="100%"><tr>
<td width="56" style="padding-right:14px;">
<div style="width:42px;height:42px;border-radius:10px;border:1.5px solid ${EC.gold};text-align:center;line-height:42px;font-size:20px;">📕</div>
</td>
<td>
<div style="font-size:16px;font-weight:700;color:${EC.mast};letter-spacing:.03em;">CÔNG BÁO <span style="color:${EC.gold};">SỞ HỮU CÔNG NGHIỆP</span></div>
<div style="font-size:11px;color:${EC.mastSub};">Cục Sở hữu trí tuệ — ipvietnam.gov.vn</div>
</td>
<td align="right" valign="top">
<div style="font-size:13px;color:${EC.mast};font-weight:600;">${escapeHtml(date)}</div>
<div style="font-size:10px;color:${EC.mastSub};">${items.length} số mới</div>
</td>
</tr></table>
</td></tr>
<tr><td style="height:2px;background:${EC.gold};font-size:0;line-height:0;">&nbsp;</td></tr>

<tr><td style="padding:16px 28px 4px;font-size:12.5px;color:${EC.intro};">Có <b style="color:${EC.introStrong};">${items.length} công báo mới</b> trên Cổng thông tin Sở hữu công nghiệp:</td></tr>
${rows}

<tr><td style="padding:20px 28px;">
<a href="${SOURCE_URL}" style="display:block;text-align:center;background:${EC.ctaBg};color:${EC.ctaTx};border-radius:9px;padding:13px;font-size:13.5px;font-weight:600;text-decoration:none;">Xem tất cả công báo →</a>
</td></tr>

<tr><td style="background:${EC.ink};padding:18px 28px;">
<div style="font-size:12px;color:${EC.footTx};line-height:1.6;">Bản tin tự động theo dõi <b style="color:${EC.mast};">Công báo Sở hữu công nghiệp</b> tại ipvietnam.gov.vn — Cục Sở hữu trí tuệ.</div>
<div style="margin-top:8px;padding-top:10px;border-top:1px solid ${EC.footHair};font-size:10.5px;color:${EC.footSub};">Email tự động do bot gửi · Không phải thư chính thức của cơ quan.</div>
</td></tr>

</table>
</td></tr></table>
</div>`;
}
