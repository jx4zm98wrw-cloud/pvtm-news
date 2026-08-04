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
import { shouldRecordSeen } from '../monitor.mjs';

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
