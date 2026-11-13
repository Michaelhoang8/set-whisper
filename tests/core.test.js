import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  parameters,
  items,
  positions,
  build,
  contains,
  stats,
  suggestedK,
  inspect,
  experiment,
  serialize,
  deserialize,
  fixture,
} from '../core.js';
test('SHA-256 double-hash positions match independent integer arithmetic', async () => {
  for (const text of ['hello', ' café ', '🛰', 'e\u0301'])
    for (const m of [64, 1024, 1048576]) {
      const digest = createHash('sha256').update(text).digest(),
        a = BigInt(digest.readUInt32BE(0)),
        b = BigInt(digest.readUInt32BE(4)) | 1n;
      assert.deepEqual(
        await positions(text, m, 16),
        Array.from({ length: 16 }, (_, i) => Number((a + BigInt(i) * b) % BigInt(m))),
      );
    }
});
test('odd steps produce distinct positions within the supported hash count', async () => {
  for (const item of fixture(100)) {
    const p = await positions(item, 64, 16);
    assert.equal(new Set(p).size, 16);
  }
});
test('all inserted members remain positive across several capacities', async () => {
  const source = fixture(240);
  for (const m of [64, 1024, 8192])
    for (const k of [1, 4, 16]) {
      const f = await build(source, m, k);
      for (const item of source) assert.equal(await contains(f, item), true);
    }
});
test('packed bits match an independent boolean-array construction', async () => {
  const source = fixture(120),
    m = 2048,
    k = 7,
    f = await build(source, m, k),
    bits = Array(m).fill(false);
  for (const text of source) {
    const hash = createHash('sha256').update(text).digest(),
      a = BigInt(hash.readUInt32BE(0)),
      b = BigInt(hash.readUInt32BE(4)) | 1n;
    for (let i = 0; i < k; i++) bits[Number((a + BigInt(i) * b) % BigInt(m))] = true;
  }
  for (let i = 0; i < m; i++) assert.equal(!!(f.bits[i >> 3] & (1 << (i & 7))), bits[i]);
  assert.equal(stats(f).set, bits.filter(Boolean).length);
});
test('duplicates, whitespace, Unicode, and line endings have explicit semantics', async () => {
  assert.deepEqual(items('a\r\na\rb\n\n a \n'), ['a', 'b', ' a ']);
  assert.deepEqual(items('é\ne\u0301'), ['é', 'e\u0301']);
  const f = await build(['a', 'a'], 64, 3);
  assert.equal(f.count, 1);
  assert.equal(stats(f).set, 3);
  await assert.rejects(() => positions('\ud800', 64, 2));
  assert.throws(() => items('a\n'.repeat(10001)));
});
test('empty filters have zero occupancy and definitely reject queries', async () => {
  const f = await build([], 64, 3);
  assert.equal(stats(f).approximateFPR, 0);
  assert.equal(await contains(f, 'any'), false);
  assert.equal(suggestedK(64, 0), 1);
});
test('query reports distinguish true members, negatives, false positives, and unknown truth', async () => {
  const source = fixture(500),
    f = await build(source, 64, 8);
  assert.equal(stats(f).occupancy, 1);
  const rows = await inspect(f, [source[0], 'not-in-source'], source);
  assert.equal(rows[0].falsePositive, false);
  assert.equal(rows[1].falsePositive, true);
  assert.equal((await inspect(f, ['not-in-source']))[0].present, null);
});
test('absent probe experiment excludes reference collisions and reports measured counts', async () => {
  const source = [...fixture(500), '__set_whisper_absent_probe_0__'],
    f = await build(source, 64, 8),
    r = await experiment(f, source, 125);
  assert.equal(r.falsePositives, 125);
  assert.equal(r.observedRate, 1);
  assert.equal(r.examples.length, 20);
  assert.ok(!r.examples.includes(source.at(-1)));
});
test('portable filters round trip independently of key order and retain membership', async () => {
  const f = await build(fixture(70), 2048, 5),
    encoded = await serialize(f),
    reordered = Object.fromEntries(Object.entries(encoded).reverse()),
    copy = await deserialize(reordered);
  assert.deepEqual(copy, f);
  assert.ok(await contains(copy, fixture(1)[0]));
  assert.ok(!JSON.stringify(encoded).includes('catalog/item'));
});
test('checksum and structure reject altered or incompatible filter files', async () => {
  const v = await serialize(await build(['a'], 64, 2));
  for (const bad of [
    { ...v, bits: '00'.repeat(8) },
    { ...v, k: 3 },
    { ...v, version: 2 },
    { ...v, extra: 1 },
    { ...v, count: -1 },
    { ...v, bits: v.bits.toUpperCase().replace(/0/, 'G') },
  ])
    await assert.rejects(() => deserialize(bad));
});
test('parameter and query bounds fail clearly; suggested hashes are bounded', async () => {
  for (const [m, k] of [
    [63, 1],
    [65, 1],
    [2097152, 1],
    [64, 0],
    [64, 17],
    [64, 1.5],
  ])
    assert.throws(() => parameters(m, k));
  assert.equal(suggestedK(8192, 500), 11);
  assert.equal(suggestedK(1048576, 1), 16);
  await assert.rejects(() => inspect(awaitablePlaceholder(), Array(1001).fill('a')));
  await assert.rejects(() => build(['x'.repeat(1025)], 64, 2));
});
function awaitablePlaceholder() {
  return { m: 64, k: 1, count: 0, bits: new Uint8Array(8) };
}
