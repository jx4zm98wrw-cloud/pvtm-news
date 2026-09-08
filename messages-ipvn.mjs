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
