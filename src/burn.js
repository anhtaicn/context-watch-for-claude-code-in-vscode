// @ts-check
'use strict';

const path = require('path');
const { readAppended } = require('./lines');
const { readdirSafe, statSafe, parseSafe } = require('./sessions');

const USAGE = Buffer.from('"usage"');
const W5H = 5 * 3600 * 1000;
const W10M = 10 * 60 * 1000;
// input-equivalent weights: what a token costs relative to one fresh input token
const WEIGHTS = [
  ['input_tokens', 1], ['cache_creation_input_tokens', 2],
  ['cache_read_input_tokens', 0.1], ['output_tokens', 5],
];

/**
 * @typedef {{ offset: number, points: Array<[number, number, string]> }} BurnFile ts, weight, requestId
 * @typedef {{ t5h: number, t10m: number }} Burn
 */

/**
 * Quota burned on this machine in the last 5h and 10m, across every session and subagent.
 * The same request is logged on several lines (one per content block), so points are
 * deduped by requestId; summing lines instead inflates the total ~1.8x.
 *
 * @param {{ transcripts: import('./sessions').Transcript[], now: number, cache: Map<string, BurnFile> }} opts
 * @returns {Promise<Burn>}
 */
async function computeBurn(opts) {
  const cutoff = opts.now - W5H;
  const files = [];
  for (const t of opts.transcripts) {
    if (t.mtimeMs < cutoff) continue;
    files.push(t.file);
    // a subagent only writes while its parent session is active, so a stale parent skips the walk
    const subDir = path.join(t.dir, t.sid, 'subagents');
    for (const entry of await readdirSafe(subDir)) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const file = path.join(subDir, entry.name);
      const st = await statSafe(file);
      if (st && st.mtimeMs >= cutoff) files.push(file);
    }
  }

  const live = new Set(files);
  for (const file of opts.cache.keys()) if (!live.has(file)) opts.cache.delete(file);

  for (const file of files) {
    let ent = opts.cache.get(file);
    if (!ent) {
      ent = { offset: 0, points: [] };
      opts.cache.set(file, ent);
    }
    const e = ent;
    const fresh = [];
    const res = await readAppended(file, e.offset, USAGE, (line) => {
      const point = toPoint(line);
      if (point) fresh.push(point);
    }).catch(() => null);
    if (res) {
      if (res.reset) e.points = [];
      e.offset = res.offset;
      for (const p of fresh) e.points.push(p);
    }
    e.points = e.points.filter((p) => p[0] >= cutoff);
  }

  // lines of one request can carry growing output counts; the largest is the final one
  /** @type {Map<string, [number, number]>} */
  const byRequest = new Map();
  for (const ent of opts.cache.values()) {
    for (const [ts, weight, rid] of ent.points) {
      const prev = byRequest.get(rid);
      if (!prev || weight > prev[1]) byRequest.set(rid, [ts, weight]);
    }
  }
  let t5h = 0;
  let t10m = 0;
  for (const [ts, weight] of byRequest.values()) {
    t5h += weight;
    if (ts >= opts.now - W10M) t10m += weight;
  }
  return { t5h, t10m };
}

/**
 * @param {string} line
 * @returns {[number, number, string] | null}
 */
function toPoint(line) {
  const rec = parseSafe(line);
  const msg = rec && rec.message;
  const usage = msg && msg.usage;
  if (!usage || typeof usage !== 'object') return null;
  const rid = rec.requestId || msg.id;
  const ts = Date.parse(rec.timestamp);
  if (typeof rid !== 'string' || !rid || !Number.isFinite(ts)) return null;
  let weight = 0;
  for (const [key, factor] of WEIGHTS) weight += (Number(usage[key]) || 0) * Number(factor);
  return [ts, weight, rid];
}

module.exports = { computeBurn };
