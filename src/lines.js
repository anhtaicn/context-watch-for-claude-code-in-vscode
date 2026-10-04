// @ts-check
'use strict';

const fs = require('fs');

const CHUNK = 4 * 1024 * 1024;
const NEWLINE = 10;

/**
 * Feed every COMPLETE line appended after `offset` that contains `needle` to `onLine`.
 * Lines are filtered as bytes before decoding, so a 20 MB transcript costs little.
 * A half-written last line is left for the next call.
 *
 * @param {string} file
 * @param {number} offset byte offset already consumed
 * @param {Buffer} needle
 * @param {(line: string) => void} onLine
 * @returns {Promise<{offset: number, reset: boolean}>} reset = file shrank, offset restarted at 0
 */
async function readAppended(file, offset, needle, onLine) {
  const fh = await fs.promises.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const reset = size < offset;
    let pos = reset ? 0 : offset;
    while (pos < size) {
      let len = Math.min(CHUNK, size - pos);
      let buf = await readAt(fh, pos, len);
      let cut = buf.lastIndexOf(NEWLINE);
      // a single line longer than the chunk: widen until it ends or the file does
      while (cut < 0 && buf.length === len && pos + len < size) {
        len = Math.min(len * 2, size - pos);
        buf = await readAt(fh, pos, len);
        cut = buf.lastIndexOf(NEWLINE);
      }
      if (cut < 0) break;
      let start = 0;
      while (start <= cut) {
        const end = buf.indexOf(NEWLINE, start);
        const line = buf.subarray(start, end);
        if (line.indexOf(needle) >= 0) onLine(line.toString('utf8'));
        start = end + 1;
      }
      pos += cut + 1;
    }
    return { offset: pos, reset };
  } finally {
    await fh.close();
  }
}

/**
 * @param {fs.promises.FileHandle} fh
 * @param {number} pos
 * @param {number} len
 */
async function readAt(fh, pos, len) {
  const buf = Buffer.alloc(len);
  const { bytesRead } = await fh.read(buf, 0, len, pos);
  return buf.subarray(0, bytesRead);
}

/**
 * Last lines of a file containing `needle`, newest first, read from the tail only.
 * @param {string} file
 * @param {number} tailBytes
 * @param {Buffer} needle
 * @returns {Promise<string[]>}
 */
async function tailLines(file, tailBytes, needle) {
  const fh = await fs.promises.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const start = Math.max(0, size - tailBytes);
    const buf = await readAt(fh, start, size - start);
    const out = [];
    let end = buf.length;
    while (end > 0) {
      const nl = buf.lastIndexOf(NEWLINE, end - 1);
      const line = buf.subarray(nl + 1, end);
      // the first line is cut mid-way unless the tail reached the file start
      if ((nl >= 0 || start === 0) && line.indexOf(needle) >= 0) out.push(line.toString('utf8'));
      if (nl < 0) break;
      end = nl;
    }
    return out;
  } finally {
    await fh.close();
  }
}

module.exports = { readAppended, tailLines };
