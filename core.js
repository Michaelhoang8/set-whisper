const encoder = new TextEncoder();
export function parameters(m, k) {
  if (!Number.isInteger(m) || m < 64 || m > 1048576 || m & (m - 1))
    throw Error('Bit count must be a power of two from 64 to 1,048,576.');
  if (!Number.isInteger(k) || k < 1 || k > 16) throw Error('Use 1–16 hash positions per item.');
}
export function items(text) {
  if (typeof text !== 'string' || encoder.encode(text).length > 2000000)
    throw Error('Text input is limited to 2 MB.');
  const rows = text
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .split('\n')
    .filter((s) => s.length);
  if (rows.length > 10000) throw Error('Use at most 10,000 nonempty lines.');
  for (const s of rows) validateItem(s);
  return [...new Set(rows)];
}
function validateItem(s) {
  if (
    typeof s !== 'string' ||
    !s.length ||
    encoder.encode(s).length > 1024 ||
    s.includes('\n') ||
    s.includes('\r') ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s)
  )
    throw Error('Items need 1–1,024 UTF-8 bytes without line breaks or unpaired surrogates.');
}
export async function positions(item, m, k) {
  parameters(m, k);
  validateItem(item);
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(item)),
    view = new DataView(bytes),
    a = view.getUint32(0, false),
    b = (view.getUint32(4, false) | 1) >>> 0;
  return Array.from({ length: k }, (_, i) => (a + i * b) % m);
}
export function hasPositions(filter, locations) {
  return locations.every((p) => (filter.bits[p >>> 3] & (1 << (p & 7))) !== 0);
}
export async function contains(filter, item) {
  return hasPositions(filter, await positions(item, filter.m, filter.k));
}
export function stats(filter) {
  let set = 0;
  for (const byte of filter.bits) {
    let n = byte;
    while (n) {
      set++;
      n &= n - 1;
    }
  }
  return {
    bytes: filter.bits.length,
    set,
    occupancy: set / filter.m,
    approximateFPR: (1 - Math.exp((-filter.k * filter.count) / filter.m)) ** filter.k,
    occupancyEstimate: (set / filter.m) ** filter.k,
  };
}
export function suggestedK(m, n) {
  parameters(m, 1);
  if (!Number.isInteger(n) || n < 0 || n > 10000) throw Error('Invalid item count.');
  return Math.min(16, Math.max(1, n ? Math.round((m / n) * Math.LN2) : 1));
}
export async function build(input, m, k) {
  parameters(m, k);
  if (!Array.isArray(input) || input.length > 10000) throw Error('Use at most 10,000 items.');
  input.forEach(validateItem);
  const unique = [...new Set(input)],
    filter = { m, k, count: unique.length, bits: new Uint8Array(m / 8) };
  for (let offset = 0; offset < unique.length; offset += 64) {
    const batch = await Promise.all(
      unique.slice(offset, offset + 64).map((s) => positions(s, m, k)),
    );
    for (const indexes of batch) for (const p of indexes) filter.bits[p >>> 3] |= 1 << (p & 7);
  }
  return filter;
}
export async function inspect(filter, queries, reference = null) {
  if (!Array.isArray(queries) || queries.length > 1000)
    throw Error('Inspect at most 1,000 queries.');
  const truth = reference === null ? null : new Set(reference),
    out = [];
  for (let offset = 0; offset < queries.length; offset += 64) {
    out.push(
      ...(await Promise.all(
        queries.slice(offset, offset + 64).map(async (item) => {
          const indexes = await positions(item, filter.m, filter.k),
            maybe = hasPositions(filter, indexes),
            present = truth === null ? null : truth.has(item);
          return {
            item,
            maybe,
            present,
            falsePositive: present === null ? null : maybe && !present,
            positions: indexes,
          };
        }),
      )),
    );
  }
  return out;
}
export async function experiment(filter, reference, count = 1000) {
  if (!Array.isArray(reference))
    throw Error('A reference set is required for an absent-query experiment.');
  if (!Number.isInteger(count) || count < 1 || count > 10000) throw Error('Use 1–10,000 probes.');
  const truth = new Set(reference),
    queries = [];
  let i = 0;
  while (queries.length < count) {
    const item = `__set_whisper_absent_probe_${i++}__`;
    if (!truth.has(item)) queries.push(item);
  }
  let positives = 0;
  const examples = [];
  for (let offset = 0; offset < queries.length; offset += 1000) {
    const results = await inspect(filter, queries.slice(offset, offset + 1000), reference);
    for (const r of results)
      if (r.maybe) {
        positives++;
        if (examples.length < 20) examples.push(r.item);
      }
  }
  return { probes: count, falsePositives: positives, observedRate: positives / count, examples };
}
function hex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
async function checksum(value) {
  return hex(
    new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(value)))),
  );
}
export async function serialize(filter) {
  const value = {
    version: 1,
    algorithm: 'sha256-double-odd-v1',
    m: filter.m,
    k: filter.k,
    count: filter.count,
    bits: hex(filter.bits),
  };
  return { ...value, checksum: await checksum(value) };
}
export async function deserialize(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== 'algorithm,bits,checksum,count,k,m,version'
  )
    throw Error('Invalid filter file fields.');
  parameters(value.m, value.k);
  if (value.version !== 1 || value.algorithm !== 'sha256-double-odd-v1')
    throw Error('Unsupported filter format.');
  if (!Number.isInteger(value.count) || value.count < 0 || value.count > 10000)
    throw Error('Invalid distinct-item count.');
  if (
    typeof value.bits !== 'string' ||
    value.bits.length !== value.m / 4 ||
    !/^[0-9a-f]+$/.test(value.bits)
  )
    throw Error('Invalid packed bits.');
  const canonical = {
    version: value.version,
    algorithm: value.algorithm,
    m: value.m,
    k: value.k,
    count: value.count,
    bits: value.bits,
  };
  if (typeof value.checksum !== 'string' || value.checksum !== (await checksum(canonical)))
    throw Error('Filter checksum mismatch.');
  const filter = {
    m: value.m,
    k: value.k,
    count: value.count,
    bits: Uint8Array.from(value.bits.match(/../g), (b) => parseInt(b, 16)),
  };
  const s = stats(filter);
  if (
    (filter.count === 0 && s.set !== 0) ||
    (filter.count > 0 && (s.set < filter.k || s.set > filter.count * filter.k))
  )
    throw Error('Bit population is inconsistent with the item count.');
  return filter;
}
export function fixture(count = 500) {
  return Array.from({ length: count }, (_, i) => `catalog/item-${String(i + 1).padStart(4, '0')}`);
}
