// @ts-check
'use strict';

(function () {
  // @ts-ignore acquireVsCodeApi is injected by VS Code
  const vscode = acquireVsCodeApi();
  const list = /** @type {HTMLElement} */ (document.getElementById('list'));
  const burn = /** @type {HTMLElement} */ (document.getElementById('burn'));

  /** @param {number} n */
  function human(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(Math.round(n));
  }

  /** @param {number} ms */
  function age(ms) {
    const s = ms / 1000;
    if (s < 60) return Math.floor(s) + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return (s / 3600).toFixed(1) + 'h';
    return Math.floor(s / 86400) + 'd';
  }

  /**
   * Titles come from transcripts, so text is only ever set through textContent.
   * @param {string} tag
   * @param {string} cls
   * @param {string} [text]
   */
  function el(tag, cls, text) {
    const node = document.createElement(tag);
    node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderBurn(data) {
    if (!data.burn) {
      burn.hidden = true;
      return;
    }
    const b = data.burn;
    const level = b.t10m >= 3e6 ? ' hot' : b.t10m >= 1e6 ? ' warm' : '';
    burn.hidden = false;
    burn.className = 'burn' + level;
    burn.textContent = 'Burn  5h ' + human(b.t5h) + '  ·  10m ' + human(b.t10m);
    burn.title = 'Quota used on this machine, all sessions and subagents, in input-equivalent ' +
      'tokens (input ×1, cache write ×2, cache read ×0.1, output ×5).';
  }

  function renderRows(data) {
    list.replaceChildren();
    if (!data.rows.length) {
      list.appendChild(el('div', 'empty',
        'No Claude Code session active in the last ' + data.recentMinutes + ' minutes.'));
      return;
    }
    for (const row of data.rows) {
      const card = el('div', 'row' + (row.alive ? '' : ' closed') + (row.current ? ' current' : ''));
      const head = el('div', 'head');
      head.appendChild(el('span', 'name', row.name));
      head.appendChild(el('span', 'age', age(row.ageMs)));
      card.appendChild(head);

      const frac = row.total !== null && row.window ? row.total / row.window : null;
      const bar = el('div', 'bar');
      const fill = el('div', 'fill ' + (frac === null ? 'unknown' : frac >= 0.75 ? 'red' : frac >= 0.5 ? 'yellow' : 'green'));
      fill.style.width = (frac === null ? 0 : Math.min(1, frac) * 100) + '%';
      bar.appendChild(fill);
      card.appendChild(bar);

      const meta = el('div', 'meta');
      meta.appendChild(el('span', 'tokens', row.total === null ? 'no turns yet' : human(row.total)));
      if (row.total !== null) {
        meta.appendChild(el('span', 'pct', frac === null ? 'window ?' : Math.round(frac * 100) + '%'));
      }
      const state = row.alive ? (row.busy ? 'busy' : 'live') : 'closed';
      meta.appendChild(el('span', 'state ' + state, (row.alive ? '● ' : '× ') + state));
      card.appendChild(meta);

      card.title = [
        row.name,
        row.total === null ? '' : human(row.total) + ' / ' + (row.window ? human(row.window) : 'unknown window'),
        row.model ? 'Model: ' + row.model : '',
        frac === null && row.total !== null ? 'Set ctxWatch.contextWindows to give this model a size.' : '',
      ].filter(Boolean).join('\n');
      list.appendChild(card);
    }
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.type !== 'update') return;
    renderBurn(data);
    renderRows(data);
  });
  vscode.postMessage({ type: 'ready' });
})();
