import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, setEntry } from '../public/model.js';
import { mergeArchives, samePayload, conflictFingerprint } from '../public/sync-merge.js';
const put = (state, month, amount, note = '') => setEntry(state, { month, balanceCents: amount, note });
test('goal setup propagates to a second device without inventing default settings', () => {
  const base = emptyState(), local = emptyState(), remote = emptyState();
  remote.settings = { targetCents: 1500000, deadline: '2032-03-31' };
  assert.deepEqual(mergeArchives(base, local, remote).payload.settings, remote.settings);
});
test('clearing an automatic goal preserves balances and a concurrent explicit goal becomes a resolvable conflict', () => {
  const base = put(emptyState(), '2026-11', 100000);
  base.settings = { targetCents: 5000000, deadline: '2030-12-31' };
  const remote = structuredClone(base); remote.settings = { targetCents: null, deadline: null };
  assert.deepEqual(mergeArchives(base, base, remote).payload, remote);
  const local = structuredClone(base); local.settings.targetCents = 7000000;
  const result = mergeArchives(base, local, remote);
  assert.equal(result.conflicts[0].path, 'settings');
  assert.deepEqual(result.payload.settings, local.settings);
  assert.deepEqual(mergeArchives(base, local, remote, 'remote').payload.settings, remote.settings);
});
test('different months merge without discarding either device’s changes', () => {
  const base = put(emptyState(), '2032-01', 10000);
  const local = put(base, '2032-02', 20000), remote = put(base, '2032-03', 30000);
  const result = mergeArchives(base, local, remote);
  assert.equal(result.conflicts.length, 0); assert.equal(result.payload.entries.length, 3);
});
test('balance and note edits to the same month merge independently', () => {
  const base = put(emptyState(), '2035-01', 10000, 'inizio');
  const local = put(base, '2035-01', 0, 'inizio'), remote = put(base, '2035-01', 10000, 'nota nuova');
  const result = mergeArchives(base, local, remote);
  assert.equal(result.conflicts.length, 0);
  assert.deepEqual(result.payload.entries[0], { month: '2035-01', balanceCents: 0, note: 'nota nuova' });
});
test('conflicting values are explicit and resolution affects only conflicting fields', () => {
  const base = put(emptyState(), '2032-01', 10000);
  const local = put(put(base, '2032-01', 11000), '2032-02', 30000);
  const remote = put(put(base, '2032-01', 12000), '2032-03', 40000);
  const conflict = mergeArchives(base, local, remote);
  assert.deepEqual(conflict.conflicts.map(item => item.path), ['entries.2032-01.balanceCents']);
  for (const preference of ['local', 'remote']) {
    const merged = mergeArchives(base, local, remote, preference).payload;
    assert.equal(merged.entries.length, 3);
    assert.equal(merged.entries[0].balanceCents, preference === 'local' ? 11000 : 12000);
  }
});
test('deletion propagates against unchanged data but conflicts with a remote edit', () => {
  const base = put(emptyState(), '2032-01', 10000);
  const deleted = put(base, '2032-01', null);
  assert.equal(mergeArchives(base, deleted, base).payload.entries.length, 0);
  const modified = put(base, '2032-01', 15000);
  assert.equal(mergeArchives(base, deleted, modified).conflicts[0].path, 'entries.2032-01');
  assert.equal(mergeArchives(base, deleted, modified, 'local').payload.entries.length, 0);
  assert.equal(mergeArchives(base, deleted, modified, 'remote').payload.entries[0].balanceCents, 15000);
});
test('a fresh empty device pulls existing data instead of publishing an empty archive', () => {
  const remote = put(emptyState(), '2040-01', 10000); remote.settings = { targetCents: 5000000, deadline: '2045-12-31' };
  assert.ok(samePayload(mergeArchives(null, emptyState(), remote).payload, remote));
  assert.ok(samePayload(mergeArchives(null, remote, emptyState()).payload, remote));
});
test('first-time linking merges non-overlapping months and flags different settings', () => {
  const local = put(emptyState(), '2035-01', 10000), remote = put(emptyState(), '2035-02', 20000);
  local.settings = { targetCents: 5000000, deadline: '2030-12-31' }; remote.settings = { targetCents: 9000000, deadline: '2030-12-31' };
  const result = mergeArchives(null, local, remote);
  assert.equal(result.payload.entries.length, 2);
  assert.equal(result.conflicts[0].path, 'settings.targetCents');
  assert.notEqual(conflictFingerprint(local, remote, 1), conflictFingerprint(local, remote, 2));
});
