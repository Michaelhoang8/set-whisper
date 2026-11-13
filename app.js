import { items, fixture, suggestedK } from './core.js';
const $ = (id) => document.getElementById(id),
  ns = 'http://www.w3.org/2000/svg';
let filter = null,
  reference = null,
  metrics = null,
  answers = [],
  trial = null,
  worker = null,
  busy = false,
  revision = 0;
const el = (tag, text) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  return n;
};
const pct = (value) => (value * 100).toFixed(2) + '%';
function status(text) {
  $('status').textContent = text;
}
function controls() {
  for (const n of document.querySelectorAll('button,input,select,textarea')) n.disabled = busy;
  $('cancel').disabled = !busy;
  for (const id of ['query', 'save', 'report']) $(id).disabled = busy || !filter;
  $('probe').disabled = busy || !filter || reference === null;
}
function invalidate() {
  revision++;
  worker?.terminate();
  worker = null;
  busy = false;
  filter = null;
  reference = null;
  metrics = null;
  answers = [];
  trial = null;
  $('results').hidden = true;
  controls();
  status('Draft changed. Build a filter to inspect it.');
}
function perform(data, done) {
  if (busy) return;
  const ticket = ++revision;
  busy = true;
  controls();
  status('Computing locally…');
  const w = new Worker('worker.js', { type: 'module' });
  worker = w;
  w.onmessage = ({ data }) => {
    if (ticket !== revision) return;
    w.terminate();
    worker = null;
    busy = false;
    if (data.error) status(data.error);
    else {
      try {
        done(data.result);
      } catch (e) {
        status(e.message);
      }
    }
    controls();
  };
  w.onerror = () => {
    if (ticket !== revision) return;
    w.terminate();
    worker = null;
    busy = false;
    status('The worker could not finish. Try the operation again.');
    controls();
  };
  w.postMessage(data);
}
function map(indexes = []) {
  if (!filter) return;
  const root = $('map'),
    cells = Math.min(256, filter.m),
    columns = 16,
    rows = Math.ceil(cells / columns),
    step = filter.m / cells,
    highlight = new Set(indexes.map((i) => Math.floor(i / step)));
  root.replaceChildren();
  root.setAttribute('viewBox', `0 0 320 ${rows * 20}`);
  for (let i = 0; i < cells; i++) {
    let set = 0;
    for (let bit = i * step; bit < (i + 1) * step; bit++)
      if (filter.bits[bit >> 3] & (1 << (bit & 7))) set++;
    const r = document.createElementNS(ns, 'rect');
    for (const [k, v] of Object.entries({
      x: (i % columns) * 20 + 3,
      y: Math.floor(i / columns) * 20 + 3,
      width: 14,
      height: 14,
      rx: 3,
      fill: `rgba(196,163,251,${0.07 + (0.86 * set) / step})`,
      stroke: highlight.has(i) ? '#f5bc95' : 'transparent',
      'stroke-width': 2,
    }))
      r.setAttribute(k, v);
    const title = document.createElementNS(ns, 'title');
    title.textContent = `Bits ${i * step}–${(i + 1) * step - 1}: ${set}/${step} set`;
    r.append(title);
    root.append(r);
  }
  $('map-note').textContent =
    `${cells} cells · ${step} bit${step === 1 ? '' : 's'} per cell. Brighter cells have more set bits. Outlines locate the selected query.`;
  $('positions').textContent = indexes.length
    ? `Selected hash positions: ${indexes.join(', ')}`
    : 'Select a query below to locate its hash positions.';
}
function render() {
  $('results').hidden = false;
  $('bytes').textContent = metrics.bytes.toLocaleString();
  $('occupancy').textContent = pct(metrics.occupancy);
  $('bitcount').textContent =
    `${metrics.set.toLocaleString()} / ${filter.m.toLocaleString()} bits set`;
  $('estimate').textContent = pct(metrics.approximateFPR);
  $('truth-note').textContent =
    reference === null
      ? 'Imported filter: exact membership truth is unknown. No original items are present.'
      : `${reference.length} distinct source items retained locally for exact comparison.`;
  $('answers').replaceChildren();
  answers.slice(0, 100).forEach((row) => {
    const tr = el('tr'),
      cell = el('td'),
      button = el('button', row.item);
    button.addEventListener('click', () => map(row.positions));
    cell.append(button);
    tr.append(
      cell,
      el('td', row.maybe ? 'Probably present' : 'Definitely absent'),
      el(
        'td',
        row.present === null
          ? 'Unknown'
          : row.present
            ? 'Present'
            : row.falsePositive
              ? 'Absent · false positive'
              : 'Absent',
      ),
    );
    if (row.falsePositive) tr.className = 'false';
    $('answers').append(tr);
  });
  $('answer-note').textContent = answers.length
    ? `Showing ${Math.min(100, answers.length)} of ${answers.length} queries. Analysis export contains every checked query.`
    : 'Check a key to inspect its result.';
  $('experiment').hidden = !trial;
  if (trial) {
    $('observed').textContent =
      `${trial.falsePositives} / ${trial.probes} · ${pct(trial.observedRate)}`;
    $('probe-note').textContent =
      'Deterministic synthetic keys, all absent from the reference set. This is a measured sample, not a bound for future queries.';
    $('false-example').hidden = !trial.examples.length;
  }
  map(answers[0]?.positions || []);
  controls();
}
function build() {
  try {
    const source = items($('source').value);
    perform(
      { action: 'build', items: source, m: Number($('m').value), k: Number($('k').value) },
      (value) => {
        filter = value.filter;
        metrics = value.stats;
        reference = source;
        answers = [];
        trial = null;
        $('source-count').textContent = `${source.length} distinct items`;
        render();
        status(
          `Built ${filter.count} items into ${metrics.bytes} packed bytes. No source key is uploaded.`,
        );
      },
    );
  } catch (e) {
    status(e.message);
  }
}
function query() {
  try {
    const queries = items($('queries').value);
    if (!queries.length) throw Error('Enter at least one query.');
    perform({ action: 'query', filter, queries, reference }, (value) => {
      answers = value;
      render();
      status(`Checked ${value.length} distinct queries.`);
    });
  } catch (e) {
    status(e.message);
  }
}
function download(name, data) {
  const u = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    ),
    a = el('a');
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
for (const id of ['source', 'm', 'k']) $(id).addEventListener('input', invalidate);
$('queries').addEventListener('input', () => {
  answers = [];
  if (filter) render();
});
$('build').addEventListener('click', build);
$('query').addEventListener('click', query);
$('recommend').addEventListener('click', () => {
  try {
    const n = items($('source').value).length;
    $('k').value = suggestedK(Number($('m').value), n);
    invalidate();
    status('Suggested hash count set using rounded (m/n) ln 2, capped to 1–16. Build to apply.');
  } catch (e) {
    status(e.message);
  }
});
$('sample').addEventListener('click', () => {
  $('source').value = fixture().join('\n');
  invalidate();
  $('source-count').textContent = '500 synthetic catalog keys';
});
$('cancel').addEventListener('click', () => {
  revision++;
  worker?.terminate();
  worker = null;
  busy = false;
  controls();
  status('Operation cancelled.');
});
$('probe').addEventListener('click', () => {
  if (reference !== null)
    perform({ action: 'experiment', filter, reference, count: 1000 }, (value) => {
      trial = value;
      render();
      status('Absent-key experiment complete.');
    });
});
$('false-example').addEventListener('click', () => {
  if (trial?.examples.length) {
    $('queries').value = trial.examples[0];
    query();
  }
});
$('save').addEventListener('click', () =>
  perform({ action: 'export', filter }, (value) => {
    download('set-whisper-filter.json', value);
    status('Saved the packed filter with its format metadata and checksum.');
  }),
);
$('report').addEventListener('click', () =>
  download('set-whisper-analysis.json', {
    m: filter.m,
    k: filter.k,
    count: filter.count,
    referenceAvailable: reference !== null,
    stats: metrics,
    queries: answers,
    experiment: trial,
  }),
);
$('file').addEventListener('change', async () => {
  const f = $('file').files[0];
  if (!f) return;
  const ticket = ++revision;
  busy = true;
  controls();
  try {
    if (f.size > 400000) throw Error('Filter files are limited to 400 KB.');
    const value = JSON.parse(await f.text());
    if (ticket !== revision) return;
    busy = false;
    perform({ action: 'import', value }, (value) => {
      filter = value.filter;
      metrics = value.stats;
      reference = null;
      answers = [];
      trial = null;
      if (![...$('m').options].some((o) => Number(o.value) === filter.m)) {
        $('m').append(new Option(String(filter.m), String(filter.m)));
      }
      $('m').value = filter.m;
      $('k').value = filter.k;
      $('source').value = '';
      $('source-count').textContent = 'Imported filter · original keys unavailable';
      render();
      status('Filter loaded and checksum verified. Membership truth requires the original set.');
    });
  } catch (e) {
    if (ticket === revision) {
      busy = false;
      controls();
      status(`Import rejected: ${e.message}`);
    }
  } finally {
    $('file').value = '';
  }
});
$('source').value = fixture().join('\n');
build();
