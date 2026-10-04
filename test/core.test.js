'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { windowFor } = require('../src/windows');
const { readAppended, tailLines } = require('../src/lines');
const { scanSessions, pickCurrent, lastUsage, tabTitle } = require('../src/sessions');
const { computeBurn } = require('../src/burn');

const NOW = Date.parse('2026-10-04T12:00:00Z');
const DEAD_PID = 2147483646;

function tmpClaude() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxwatch-'));
  fs.mkdirSync(path.join(dir, 'projects', 'proj'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'sessions'));
  return dir;
}

function usageLine({ model = 'claude-opus-5-5', input = 10, read = 1000, write = 90, output = 5,
  rid = 'req_1', ts = NOW - 1000, sidechain = false } = {}) {
  return JSON.stringify({
    type: 'assistant', isSidechain: sidechain, requestId: rid, timestamp: new Date(ts).toISOString(),
    message: { model, id: 'msg_' + rid, usage: {
      input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: write,
      output_tokens: output } },
  });
}

function writeTranscript(dir, sid, lines, mtimeMs = NOW - 1000) {
  const file = path.join(dir, 'projects', 'proj', sid + '.jsonl');
  fs.writeFileSync(file, lines.map((l) => l + '\n').join(''));
  fs.utimesSync(file, mtimeMs / 1000, mtimeMs / 1000);
  return file;
}

function writeMeta(dir, meta) {
  fs.writeFileSync(path.join(dir, 'sessions', meta.pid + '.json'), JSON.stringify(meta));
}

test('windowFor: prefix match, longest wins, user override wins ties, unknown is null', () => {
  assert.equal(windowFor('claude-opus-5-5'), 1000000);
  assert.equal(windowFor('claude-haiku-4-5-20251001'), 200000);
  assert.equal(windowFor('claude-sonnet-5-5'), null);
  assert.equal(windowFor(undefined), null);
  assert.equal(windowFor('claude-opus-5-5', { 'claude-opus-5': 500000 }), 500000);
  assert.equal(windowFor('claude-opus-5-5', { 'claude-opus-5-5': 123 }), 123);
  assert.equal(windowFor('claude-sonnet-5-5', { 'claude-sonnet': 'bad', 'claude-': 7 }), 7);
});

test('readAppended: leaves a half-written line, resumes, resets when the file shrinks', async () => {
  const dir = tmpClaude();
  const file = path.join(dir, 'f.jsonl');
  fs.writeFileSync(file, 'a-x\nb\na-y');
  const seen = [];
  const needle = Buffer.from('a-');
  let res = await readAppended(file, 0, needle, (l) => seen.push(l));
  assert.deepEqual(seen, ['a-x']);
  assert.equal(res.offset, 6);
  fs.appendFileSync(file, 'z\n');
  res = await readAppended(file, res.offset, needle, (l) => seen.push(l));
  assert.deepEqual(seen, ['a-x', 'a-yz']);
  fs.writeFileSync(file, 'a-new\n');
  res = await readAppended(file, res.offset, needle, (l) => seen.push(l));
  assert.equal(res.reset, true);
  assert.deepEqual(seen.slice(-1), ['a-new']);
});

test('readAppended: a line longer than one read chunk is still delivered whole', async () => {
  const dir = tmpClaude();
  const file = path.join(dir, 'big.jsonl');
  const long = 'a-' + 'x'.repeat(5 * 1024 * 1024);
  fs.writeFileSync(file, long + '\nshort\n');
  const seen = [];
  await readAppended(file, 0, Buffer.from('a-'), (l) => seen.push(l.length));
  assert.deepEqual(seen, [long.length]);
});

test('tailLines: newest first, and the cut first line is dropped', async () => {
  const dir = tmpClaude();
  const file = path.join(dir, 't.jsonl');
  fs.writeFileSync(file, 'k-1111111111\nk-2\nk-3\n');
  assert.deepEqual(await tailLines(file, 1000, Buffer.from('k-')), ['k-3', 'k-2', 'k-1111111111']);
  assert.deepEqual(await tailLines(file, 10, Buffer.from('k-')), ['k-3', 'k-2']);
});

test('lastUsage: newest real record; skips synthetic, sidechain and zero usage', async () => {
  const dir = tmpClaude();
  const file = writeTranscript(dir, 's1', [
    usageLine({ input: 1, read: 2, write: 3 }),
    usageLine({ input: 100, read: 200, write: 300 }),
    usageLine({ sidechain: true, input: 9999 }),
    usageLine({ model: '<synthetic>', input: 0, read: 0, write: 0 }),
    JSON.stringify({ type: 'user', message: { content: 'hi "usage" text' } }),
  ]);
  assert.deepEqual(await lastUsage(file), { total: 600, model: 'claude-opus-5-5' });
});

test('tabTitle: rename beats AI title, last wins, appended lines are picked up', async () => {
  const dir = tmpClaude();
  const file = writeTranscript(dir, 's1', [
    JSON.stringify({ type: 'ai-title', aiTitle: 'First AI' }),
    JSON.stringify({ type: 'ai-title', aiTitle: 'Second AI' }),
  ]);
  const t = { file, sid: 's1', dir: path.dirname(file), mtimeMs: NOW };
  const cache = new Map();
  assert.equal(await tabTitle(t, cache), 'Second AI');
  fs.appendFileSync(file, JSON.stringify({ type: 'custom-title', customTitle: 'Renamed' }) + '\n');
  fs.appendFileSync(file, JSON.stringify({ type: 'ai-title', aiTitle: 'Third AI' }) + '\n');
  assert.equal(await tabTitle(t, cache), 'Renamed');
});

test('tabTitle: sidecar custom-title.json is used when the transcript has no rename', async () => {
  const dir = tmpClaude();
  const file = writeTranscript(dir, 's2', [JSON.stringify({ type: 'ai-title', aiTitle: 'AI' })]);
  fs.mkdirSync(path.join(path.dirname(file), 's2'));
  fs.writeFileSync(path.join(path.dirname(file), 's2', 'custom-title.json'),
    JSON.stringify({ customTitle: 'Cập nhật danh mục' }));
  assert.equal(await tabTitle({ file, sid: 's2', dir: path.dirname(file), mtimeMs: NOW }, new Map()),
    'Cập nhật danh mục');
});

test('scanSessions: live/busy/closed, old closed dropped, old live kept, sorted', async () => {
  const dir = tmpClaude();
  const hour = 3600 * 1000;
  writeTranscript(dir, 'live-old', [usageLine()], NOW - 5 * hour);
  writeTranscript(dir, 'closed-recent', [usageLine({ model: 'claude-sonnet-5-5' })], NOW - 60000);
  writeTranscript(dir, 'closed-old', [usageLine()], NOW - 5 * hour);
  writeTranscript(dir, 'live-new', [], NOW - 5000);
  writeMeta(dir, { pid: process.pid, sessionId: 'live-old', status: 'busy', cwd: dir, name: 'meta-name' });
  writeMeta(dir, { pid: DEAD_PID, sessionId: 'closed-recent', status: 'idle' });
  writeMeta(dir, { pid: process.ppid, sessionId: 'live-new', status: 'idle', cwd: dir });
  fs.writeFileSync(path.join(dir, 'sessions', 'broken.json'), '{not json');

  const { rows } = await scanSessions({ claudeDir: dir, now: NOW, recentMs: 30 * 60000, titles: new Map() });
  assert.deepEqual(rows.map((r) => r.sid), ['live-new', 'live-old', 'closed-recent']);
  const [fresh, old, closed] = rows;
  assert.equal(fresh.total, null);
  assert.equal(old.name, 'meta-name');
  assert.equal(old.busy, true);
  assert.equal(old.total, 1100);
  assert.equal(old.window, 1000000);
  assert.equal(closed.alive, false);
  assert.equal(closed.window, null);
  assert.equal(closed.name, 'closed-r');
});

test('scanSessions: missing Claude directory yields no rows instead of throwing', async () => {
  const res = await scanSessions({ claudeDir: path.join(os.tmpdir(), 'nope-' + Date.now()), now: NOW,
    recentMs: 60000, titles: new Map() });
  assert.deepEqual(res.rows, []);
});

test('pickCurrent: live session in or under a workspace folder, most recent first', () => {
  const base = { alive: true, total: 1, window: 1, name: 'n', model: null, busy: false };
  const ws = path.resolve('ws');
  const rows = [
    { ...base, sid: 'other', cwd: path.resolve('elsewhere'), ageMs: 1 },
    { ...base, sid: 'older', cwd: ws, ageMs: 50 },
    { ...base, sid: 'sub', cwd: path.join(ws, 'pkg'), ageMs: 10 },
    { ...base, sid: 'dead', cwd: ws, ageMs: 0, alive: false },
    { ...base, sid: 'prefix-trap', cwd: ws + '2', ageMs: 0 },
  ];
  assert.equal(pickCurrent(rows, [ws]).sid, 'sub');
  assert.equal(pickCurrent(rows, []), null);
  assert.equal(pickCurrent([{ ...base, sid: 'case', cwd: ws.toUpperCase(), ageMs: 1 }], [ws], 'win32').sid, 'case');
});

test('computeBurn: dedupes by request, keeps the largest line, windows 5h/10m, reads subagents once', async () => {
  const dir = tmpClaude();
  const min = 60000;
  const file = writeTranscript(dir, 's1', [
    usageLine({ rid: 'a', input: 100, read: 0, write: 0, output: 0, ts: NOW - 2 * min }),
    usageLine({ rid: 'a', input: 100, read: 0, write: 0, output: 20, ts: NOW - 2 * min }),
    usageLine({ rid: 'b', input: 0, read: 1000, write: 50, output: 0, ts: NOW - 60 * min }),
    usageLine({ rid: 'old', input: 999999, ts: NOW - 6 * 60 * min }),
  ]);
  const sub = path.join(path.dirname(file), 's1', 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, 'agent-x.jsonl'),
    usageLine({ rid: 'c', input: 10, read: 0, write: 0, output: 0, ts: NOW - min }) + '\n' +
    usageLine({ rid: 'a', input: 100, read: 0, write: 0, output: 0, ts: NOW - 2 * min }) + '\n');
  const transcripts = [{ file, sid: 's1', dir: path.dirname(file), mtimeMs: NOW - min }];
  const cache = new Map();
  const expect = { t5h: 200 + 200 + 10, t10m: 200 + 10 };
  assert.deepEqual(await computeBurn({ transcripts, now: NOW, cache }), expect);
  assert.deepEqual(await computeBurn({ transcripts, now: NOW, cache }), expect);
});
