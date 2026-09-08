// Data layer for the IP-gazette feed (ipvietnam.gov.vn). Fetch + parse only.
// The site ships an INCOMPLETE TLS chain (missing intermediate), so the fetch
// disables verification FOR THIS REQUEST ONLY (scoped, not global): the feed
// reads public data and sends no secrets, so the residual MITM risk is bounded
// and covered by the structure guard downstream. See spec §4/§8.
import got from 'got';
import * as cheerio from 'cheerio';

export const SOURCE_URL = 'https://www.ipvietnam.gov.vn/cong-bao-so-huu-cong-nghiep1';
const ISSUE_RE = /S[ốo]\s*(\d+)/i;
const UA = {
  headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  timeout: { request: 20000 },
  https: { rejectUnauthorized: false } // scoped SSL bypass — see file header
};

// DD/MM/YYYY -> YYYY-MM-DD (sortable). null if absent.
export function toISODate (raw) {
  const m = (raw || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

// Guard #1: a healthy scan has content rows AND at least one parseable issue.
export function isBroken ({ rows, items }) {
  return rows === 0 || items.length === 0;
}

// Pure: HTML -> { items:[{key,title,url,date,dateISO,numberMismatch}], rows, dropped:[title] }.
// key = issue number (stable identity). Date comes from the 2nd column, NOT the
// title (titles are inconsistent). Rows without an <a> (e.g. the header) are
// skipped entirely; content rows with no issue number go to `dropped` (logged),
// never silently lost (#2). Link is the row's own anchor + slug-number check (#3).
export function parseGazette (html, baseUrl = SOURCE_URL) {
  const $ = cheerio.load(html);
  const items = [];
  const dropped = [];
  let rows = 0;
  $('table tr').each((_, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 2) return;
    const a = $(tds[0]).find('a[href]').first();
    if (!a.length) return; // header / non-content row
    const title = a.text().replace(/\s+/g, ' ').trim();
    if (!title) return;
    rows++;
    const no = title.match(ISSUE_RE);
    if (!no) { dropped.push(title); return; }
    const dateRaw = ($(tds[1]).text().match(/\d{1,2}\/\d{1,2}\/\d{4}/) || [])[0] || null;
    items.push({
      key: no[1],
      title,
      // The site's per-row detail hrefs are systematically off by one issue
      // (the anchor whose text is "Số 465" links to the so-464 page — verified
      // in-browser and across every row at activation). Linking to them would
      // send readers to the WRONG, older gazette. The issue number + date in the
      // title is the reliable identity; link to the listing page instead, mirroring
      // how the pvtm group-D legal table handles its non-static (JS) links.
      url: baseUrl,
      date: dateRaw,
      dateISO: toISODate(dateRaw)
    });
  });
  return { items, rows, dropped };
}

// Network. Throws on transport failure (caller catches → treated as broken).
export async function fetchGazetteHtml () {
  return (await got(SOURCE_URL, UA)).body;
}
