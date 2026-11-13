# Set Whisper

A local Bloom-filter workbench with real packed bits, exact reference-set comparisons, false-positive experiments, and portable filter files.

![Set Whisper](docs/workbench.png)

Membership queries and exact reference results occupy the main workspace. Select a result to highlight its hash positions in the bit strip. Filter settings opens the source list, capacity, and hash-count controls.

## Run

Requires Python 3.10+. No runtime dependencies or API keys.

```sh
python run.py --port 8000
```

Open http://127.0.0.1:8000/. Hashing and experiments run in a browser worker. Source items stay in browser memory and disappear on refresh. Export the filter to reuse its membership checks later.

## Explore

- Build a filter from one key per line, choosing its bit capacity and number of hash positions.
- Compare measured occupancy and packed byte cost with an explicitly approximate false-positive model.
- Query known members and absent keys; inspect each query's actual hash positions on the occupancy map.
- Run 1,000 deterministic absent probes, inspect a concrete false positive, and export the analysis.
- Save and reopen a filter with validated format fields and a SHA-256 corruption checksum.

The default example has 500 fictional catalog keys, 4,096 bits, and six hash positions. It occupies 512 packed bytes with 2,125 bits set. Its fixed 1,000-probe experiment produces 18 false positives. File metadata and the locally retained exact reference set require additional memory; the packed byte count is not the total application's memory footprint.

## Membership contract

An intact filter returns positive for every inserted key under the same encoding and hash scheme. A positive result alone does not prove membership. An imported filter lacks its original reference set: the UI reports exact truth as unknown and disables the known-absent experiment. A filter cannot enumerate original keys or safely delete an individual item.

Input uses exact UTF-8 bytes. CRLF/CR delimiters normalize to lines, empty lines are ignored, and duplicate lines collapse. Whitespace, case, and Unicode normalization forms remain distinct; unpaired UTF-16 surrogates are rejected. Limits: 10,000 nonempty source lines, 1,024 UTF-8 bytes per key, 2 MB source text, and 1,000 distinct queries per inspection.

The first two big-endian 32-bit words of SHA-256 provide a and b. Set b's low bit to obtain an odd step. Hash position i is `(a + i * b) mod m`. Bit capacities are powers of two from 64 to 1,048,576, with 1–16 positions. An odd step prevents repeated positions within the supported hash count. Packed bits use least-significant-bit-first ordering inside each byte.

Double hashing follows the construction discussed by [Kirsch and Mitzenmacher](https://www.eecs.harvard.edu/~michaelm/postscripts/esa2006a.pdf). The displayed `(1 - exp(-kn/m))^k` rate is an idealized approximation, not an exact guarantee for these finite filters or arbitrary query distributions. The suggested hash count rounds `(m/n) ln 2` and caps it to the supported range. The measured experiment describes its fixed synthetic probes, excluding any collisions with reference-set keys.

## Portable format

JSON contains `version`, `algorithm`, `m`, `k`, `count`, hexadecimal `bits`, and `checksum`. The checksum hashes the UTF-8 encoding of compact JSON with the first six fields in that order. Imports validate dimensions, field names, algorithm version, bit population bounds, and checksum; files are limited to 400 KB. SHA-256 here detects accidental corruption, not forgery. Anyone holding the filter can test candidate keys, so it is not a privacy mechanism. Item counts in a third-party file are metadata, not independently proven history.

## Verification

Requires Node.js 22+ for tests.

```sh
npm test
npm run check
python -m unittest discover -s tests -p 'test_*.py'
```

Eleven JavaScript tests verify SHA-256 positions against Node's independent hash implementation and BigInt arithmetic, packed bits against a boolean-array oracle, no false negatives across multiple capacities, duplicates and Unicode, empty and saturated filters, absent-probe exclusion, serialization, tamper rejection, and bounds. One Python test checks the static server. CI runs on Linux and Windows.

Browser verification covers membership, a measured false positive, export/import, and unknown reference truth after import. Independent Python verified the exported checksum, all 500 inserted members, 2,125 occupied bits, all 18 measured false positives, and highlighted query positions.

`core.js` holds the data structure, encoding, and experiments. `worker.js` isolates hashing work; `app.js` handles cancellable operations, input invalidation, and the grouped SVG bit map. Each cell's bit range is labeled; the map never presents an aggregated cell as a single bit.
