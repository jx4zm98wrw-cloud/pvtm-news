// Tests for the delivery-durability decision (monitor.mjs → shouldRecordSeen).
// Run with: npm test   (node --test)
//
// This guards the fix for silent alert loss: an alert must only be recorded as
// "seen" (and thus never re-sent) when it actually reached someone. If every
// channel failed, the items must stay unseen so the next cycle retries them.
//
// Importing monitor.mjs is safe: its main() loop is guarded behind a
// direct-invocation check, so importing runs no monitoring.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldRecordSeen, recordEntry, computeLagStats } from '../monitor.mjs';

test('records when at least one channel delivered (other failed)', () => {
	assert.equal(shouldRecordSeen([
		{ channel: 'telegram', sent: '3 item(s) → 2 chat(s)' },
		{ channel: 'email', error: 'smtp unreachable' }
	]), true);
});

test('does NOT record when every channel failed → retry next cycle', () => {
	assert.equal(shouldRecordSeen([
		{ channel: 'telegram', error: 'delivered to 0/2 chat(s)' },
		{ channel: 'email', error: 'smtp unreachable' }
	]), false);
});

test('does NOT record on a single failed channel with no other delivery', () => {
	assert.equal(shouldRecordSeen([{ channel: 'telegram', error: '429 Too Many Requests' }]), false);
});

test('records when all channels are intentionally skipped (disabled, not failed)', () => {
	// No channel configured (local/dev) is a config state, not a transient
	// failure — retrying can't help, so advance state to avoid an endless backlog.
	assert.equal(shouldRecordSeen([
		{ channel: 'telegram', skipped: 'missing env' },
		{ channel: 'email', skipped: 'missing env' }
	]), true);
});

test('records on a mix of delivered and skipped', () => {
	assert.equal(shouldRecordSeen([
		{ channel: 'telegram', sent: '1 item(s) → 1 chat(s)' },
		{ channel: 'email', skipped: 'missing env' }
	]), true);
});

// --- recordEntry: firstSeenAt stamping / preservation (v5) ---

const item = (o = {}) => ({ title: 'T', dateISO: '2026-07-31', group: 'C', ...o });

test('recordEntry stamps detection time for a genuinely new key', () => {
	const e = recordEntry(undefined, item(), '2026-08-03T04:00:00.000Z');
	assert.equal(e.firstSeenAt, '2026-08-03T04:00:00.000Z');
	assert.equal(e.dateISO, '2026-07-31');
	assert.equal(e.group, 'C');
});

test('recordEntry preserves original firstSeenAt on a title change', () => {
	const existing = { title: 'old', dateISO: '2026-07-31', group: 'C', firstSeenAt: '2026-08-01T00:00:00.000Z' };
	const e = recordEntry(existing, item({ title: 'new' }), '2026-08-05T00:00:00.000Z');
	assert.equal(e.firstSeenAt, '2026-08-01T00:00:00.000Z', 'first-seen must not move to the retitle time');
	assert.equal(e.title, 'new', 'title is updated');
});

test('recordEntry keeps firstSeenAt null when a SEEDED item is later retitled', () => {
	const seeded = { title: 'old', dateISO: '2026-06-01', group: 'C', firstSeenAt: null };
	const e = recordEntry(seeded, item({ title: 'new' }), '2026-08-05T00:00:00.000Z');
	assert.equal(e.firstSeenAt, null, 'a seeded item never gains a fabricated detection time');
});

// --- computeLagStats: cover-date → first-detected lag ---

test('computeLagStats excludes seeded (null firstSeenAt) and undated items', () => {
	const { rows, summary } = computeLagStats({
		a: { title: 'seeded', dateISO: '2026-07-01', group: 'C', firstSeenAt: null },
		b: { title: 'undated', dateISO: null, group: 'D', firstSeenAt: '2026-08-03T04:00:00.000Z' },
		c: { title: 'real', dateISO: '2026-07-31', group: 'C', firstSeenAt: '2026-08-03T04:00:00.000Z' }
	});
	assert.equal(summary.n, 1, 'only the fully-known item counts');
	assert.equal(rows[0].key, 'c');
	assert.equal(rows[0].lagDays, 3, 'cover 07-31 → detected 08-03 = 3 days');
});

test('computeLagStats returns n=0 when there is no usable data', () => {
	assert.equal(computeLagStats({ a: { dateISO: '2026-07-01', group: 'C', firstSeenAt: null } }).summary.n, 0);
});

test('computeLagStats reports min/median/mean/max', () => {
	const { summary } = computeLagStats({
		a: { dateISO: '2026-07-31', group: 'C', firstSeenAt: '2026-08-01T00:00:00.000Z' }, // 1d
		b: { dateISO: '2026-07-31', group: 'C', firstSeenAt: '2026-08-03T00:00:00.000Z' }, // 3d
		c: { dateISO: '2026-07-31', group: 'C', firstSeenAt: '2026-08-06T00:00:00.000Z' }  // 6d
	});
	assert.equal(summary.n, 3);
	assert.equal(summary.min, 1);
	assert.equal(summary.max, 6);
	assert.equal(summary.median, 3);
	assert.equal(summary.mean, 3.3);
});
