import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot, mergeSnapshot, toCsv, cmpVersion } from './snapshot.mjs';

const entry = { downloads: 149, updated: 1790541285000, '1.0.1': 5, '1.0.2': 7, '1.0.3': 18, '1.0.4': 39, '1.0.5': 18, '1.0.6': 62 };

test('buildSnapshot splits versions from totals', () => {
  const s = buildSnapshot(entry, '2026-10-11');
  assert.equal(s.total, 149);
  assert.equal(Object.keys(s.versions).length, 6);
  assert.equal(s.versions['1.0.6'], 62);
  assert.equal(s.updated, 1790541285000);
});

test('mergeSnapshot replaces same-day rows and keeps order', () => {
  const h = { plugin: 'x', snapshots: [{ date: '2026-10-10', total: 146, versions: { '1.0.6': 59 } }] };
  const a = mergeSnapshot(h, buildSnapshot({ downloads: 149, '1.0.6': 62 }, '2026-10-11')).history;
  const b = mergeSnapshot(a, buildSnapshot({ downloads: 150, '1.0.6': 63 }, '2026-10-11')).history;
  assert.equal(b.snapshots.length, 2);
  assert.equal(b.snapshots[1].total, 150);
});

test('mergeSnapshot flags decreases', () => {
  const h = { plugin: 'x', snapshots: [{ date: '2026-10-10', total: 146, versions: { '1.0.6': 59 } }] };
  const r = mergeSnapshot(h, buildSnapshot({ downloads: 140, '1.0.6': 53 }, '2026-10-11'));
  assert.ok(r.warnings.length >= 1);
  assert.equal(r.history.snapshots[1].anomaly, 'total_decreased');
});

test('toCsv has one column per version', () => {
  const h = { plugin: 'x', snapshots: [{ date: '2026-10-11', total: 149, versions: { '1.0.1': 5, '1.0.6': 62 } }] };
  assert.equal(toCsv(h), 'date,total,1.0.1,1.0.6\n2026-10-11,149,5,62\n');
});

test('cmpVersion orders numerically', () => {
  assert.deepEqual(['1.0.10', '1.0.2', '1.0.1'].sort(cmpVersion), ['1.0.1', '1.0.2', '1.0.10']);
});
