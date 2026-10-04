// @ts-check
'use strict';

const fs = require('fs');
const path = require('path');
const { readAppended, tailLines } = require('./lines');
const { windowFor } = require('./windows');

const USAGE = Buffer.from('"usage"');
const TITLE = Buffer.from('-title"');
const TAIL_STEPS = [512 * 1024, 8 * 1024 * 1024];

/**
 * @typedef {{ file: string, sid: string, dir: string, mtimeMs: number }} Transcript
 * @typedef {{ sessionId: string, pid?: number, name?: string, status?: string, cwd?: string, startedAt?: number }} SessionMeta
 * @typedef {{ offset: number, custom: string | null, ai: string | null }} TitleState
 * @typedef {{
 *   sid: string, name: string, model: string | null, total: number | null, window: number | null,
 *   ageMs: number, alive: boolean, busy: boolean, cwd: string | null
 * }} SessionRow
 */

/**
 * Main transcripts only: projects/<project>/<sessionId>.jsonl. Subagent transcripts live one
 * level deeper and are not sessions of their own.
 * @param {string} projectsDir
 * @returns {Promise<Transcript[]>}
 */
async function listTranscripts(projectsDir) {
  const out = [];
  for (const project of await readdirSafe(projectsDir)) {
    if (!project.isDirectory()) continue;
    const dir = path.join(projectsDir, project.name);
    for (const entry of await readdirSafe(dir)) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const file = path.join(dir, entry.name);
      const st = await statSafe(file);
      if (st) out.push({ file, sid: entry.name.slice(0, -6), dir, mtimeMs: st.mtimeMs });
    }
  }
  return out;
}

/**
 * sessionId -> metadata from sessions/<pid>.json; on a reused id the newer start wins.
 * @param {string} sessionsDir
 * @returns {Promise<Map<string, SessionMeta>>}
 */
async function readSessionIndex(sessionsDir) {
  /** @type {Map<string, SessionMeta>} */
  const index = new Map();
  for (const entry of await readdirSafe(sessionsDir)) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const data = await readJsonSafe(path.join(sessionsDir, entry.name));
    if (!data || typeof data.sessionId !== 'string') continue;
    const prev = index.get(data.sessionId);
    if (prev && (prev.startedAt || 0) >= (data.startedAt || 0)) continue;
    index.set(data.sessionId, data);
  }
  return index;
}

/**
 * process.kill(pid, 0) only probes, on Windows too (libuv opens a query handle).
 * EPERM means the process exists but belongs to someone else.
 * @param {unknown} pid
 */
function pidAlive(pid) {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return /** @type {NodeJS.ErrnoException} */ (err).code === 'EPERM';
  }
}

/**
 * Newest real usage record. Error turns are written with model "<synthetic>" and zero
 * usage; counting one would show an empty window, so they are skipped.
 * @param {string} file
 * @returns {Promise<{ total: number, model: string | null } | null>}
 */
async function lastUsage(file) {
  for (const bytes of TAIL_STEPS) {
    const lines = await tailLines(file, bytes, USAGE);
    for (const line of lines) {
      const rec = parseSafe(line);
      const msg = rec && rec.message;
      const usage = msg && msg.usage;
      if (!usage || typeof usage.input_tokens !== 'number') continue;
      if (rec.isSidechain === true || msg.model === '<synthetic>') continue;
      const total = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) +
        (usage.cache_creation_input_tokens || 0);
      if (total > 0) return { total, model: typeof msg.model === 'string' ? msg.model : null };
    }
    const st = await statSafe(file);
    if (!st || st.size <= bytes) break;
  }
  return null;
}

/**
 * The name the VS Code tab shows: a rename (custom-title) beats the AI title, and within each
 * kind the last line wins. Only bytes appended since the previous call are read.
 * @param {Transcript} t
 * @param {Map<string, TitleState>} cache
 */
async function tabTitle(t, cache) {
  let state = cache.get(t.file);
  if (!state) {
    state = { offset: 0, custom: null, ai: null };
    cache.set(t.file, state);
  }
  const s = state;
  const res = await readAppended(t.file, s.offset, TITLE, (line) => {
    const rec = parseSafe(line);
    if (!rec) return;
    if (rec.type === 'custom-title' && typeof rec.customTitle === 'string' && rec.customTitle) {
      s.custom = rec.customTitle;
    } else if (rec.type === 'ai-title' && typeof rec.aiTitle === 'string' && rec.aiTitle) {
      s.ai = rec.aiTitle;
    }
  }).catch(() => null);
  if (res) {
    if (res.reset) { s.custom = null; s.ai = null; }
    s.offset = res.offset;
  }
  if (s.custom) return s.custom;
  // some versions also keep the rename in a sidecar file
  const side = await readJsonSafe(path.join(t.dir, t.sid, 'custom-title.json'));
  if (side && typeof side.customTitle === 'string' && side.customTitle) return side.customTitle;
  return s.ai;
}

/**
 * @param {{
 *   claudeDir: string, now: number, recentMs: number,
 *   overrides?: Record<string, unknown>, titles: Map<string, TitleState>
 * }} opts
 * @returns {Promise<{ rows: SessionRow[], transcripts: Transcript[] }>}
 */
async function scanSessions(opts) {
  const [transcripts, index] = await Promise.all([
    listTranscripts(path.join(opts.claudeDir, 'projects')),
    readSessionIndex(path.join(opts.claudeDir, 'sessions')),
  ]);
  /** @type {SessionRow[]} */
  const rows = [];
  const seen = new Set();
  for (const t of transcripts) {
    const meta = index.get(t.sid);
    const ageMs = Math.max(0, opts.now - t.mtimeMs);
    const alive = !!meta && pidAlive(meta.pid);
    if (!alive && ageMs > opts.recentMs) continue;
    const usage = await lastUsage(t.file).catch(() => null);
    if (!usage && !alive) continue;
    seen.add(t.file);
    const title = await tabTitle(t, opts.titles);
    rows.push({
      sid: t.sid,
      name: title || (meta && meta.name) || t.sid.slice(0, 8),
      model: usage ? usage.model : null,
      total: usage ? usage.total : null,
      window: usage ? windowFor(usage.model || undefined, opts.overrides) : null,
      ageMs,
      alive,
      busy: alive && !!meta && meta.status === 'busy',
      cwd: (meta && typeof meta.cwd === 'string') ? meta.cwd : null,
    });
  }
  for (const file of opts.titles.keys()) if (!seen.has(file)) opts.titles.delete(file);
  rows.sort((a, b) => (Number(b.alive) - Number(a.alive)) || (a.ageMs - b.ageMs));
  return { rows, transcripts };
}

/**
 * The session the status bar follows: a live one started in (or under) a workspace folder,
 * most recently written first.
 * @param {SessionRow[]} rows
 * @param {string[]} folders
 * @param {string} [platform]
 */
function pickCurrent(rows, folders, platform = process.platform) {
  const norm = (/** @type {string} */ p) => {
    const r = path.resolve(p).replace(/[\\/]+$/, '');
    return platform === 'win32' ? r.toLowerCase() : r;
  };
  const roots = folders.map(norm);
  let best = null;
  for (const row of rows) {
    if (!row.alive || !row.cwd) continue;
    const cwd = norm(row.cwd);
    const inside = roots.some((root) => cwd === root || cwd.startsWith(root + path.sep));
    if (inside && (!best || row.ageMs < best.ageMs)) best = row;
  }
  return best;
}

/** @param {string} dir */
async function readdirSafe(dir) {
  try {
    return await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** @param {string} file */
async function statSafe(file) {
  try {
    return await fs.promises.stat(file);
  } catch {
    return null;
  }
}

/** @param {string} file */
async function readJsonSafe(file) {
  try {
    return parseSafe(await fs.promises.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/** @param {string} text */
function parseSafe(text) {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

module.exports = {
  scanSessions, pickCurrent, listTranscripts, readSessionIndex, lastUsage, tabTitle, pidAlive,
  readdirSafe, statSafe, parseSafe,
};
