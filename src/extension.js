// @ts-check
'use strict';

const vscode = require('vscode');
const os = require('os');
const path = require('path');
const { scanSessions, pickCurrent } = require('./sessions');
const { computeBurn } = require('./burn');
const { PanelProvider } = require('./view');

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  const log = vscode.window.createOutputChannel('Context Watch');
  const panel = new PanelProvider(context.extensionUri);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = 'ctxWatch.sessions.focus';
  /** @type {Map<string, import('./sessions').TitleState>} */
  const titles = new Map();
  /** @type {Map<string, import('./burn').BurnFile>} */
  const burnCache = new Map();
  const reported = new Set();
  let running = false;
  /** @type {NodeJS.Timeout | undefined} */
  let timer;

  const config = () => vscode.workspace.getConfiguration('ctxWatch');

  function claudeDir() {
    const fromSetting = String(config().get('claudeDir') || '').trim();
    if (fromSetting) return fromSetting.replace(/^~(?=$|[\\/])/, os.homedir());
    return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      const cfg = config();
      const now = Date.now();
      const recentMinutes = Math.max(1, Number(cfg.get('recentMinutes')) || 30);
      const { rows, transcripts } = await scanSessions({
        claudeDir: claudeDir(), now, recentMs: recentMinutes * 60000,
        overrides: cfg.get('contextWindows') || {}, titles,
      });
      const folders = (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath);
      const current = pickCurrent(rows, folders);
      updateStatus(current, cfg.get('statusBar') !== false);
      if (panel.visible) {
        const burn = cfg.get('showBurn') !== false
          ? await computeBurn({ transcripts, now, cache: burnCache }) : null;
        panel.post({
          type: 'update',
          recentMinutes,
          burn,
          rows: rows.map((r) => ({ ...r, current: r === current })),
        });
      }
    } catch (err) {
      // log each distinct failure once instead of every few seconds
      const msg = err instanceof Error ? (err.stack || err.message) : String(err);
      if (!reported.has(msg)) {
        reported.add(msg);
        log.appendLine(`[${new Date().toISOString()}] refresh failed: ${msg}`);
      }
    } finally {
      running = false;
    }
  }

  /**
   * @param {import('./sessions').SessionRow | null} row
   * @param {boolean} enabled
   */
  function updateStatus(row, enabled) {
    if (!enabled || !row) {
      status.hide();
      return;
    }
    const frac = row.total !== null && row.window ? row.total / row.window : null;
    if (row.total === null) status.text = '$(pulse) ctx —';
    else if (frac === null) status.text = `$(pulse) ${human(row.total)}`;
    else status.text = `$(pulse) ${Math.round(frac * 100)}%`;
    status.backgroundColor = frac !== null && frac >= 0.9
      ? new vscode.ThemeColor('statusBarItem.errorBackground')
      : frac !== null && frac >= 0.75
        ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
    status.tooltip = [
      `Claude Code context: ${row.name}`,
      row.total === null ? 'No turns yet'
        : `${human(row.total)} / ${row.window ? human(row.window) : 'unknown window'}`,
      row.model ? `Model: ${row.model}` : '',
    ].filter(Boolean).join('\n');
    status.show();
  }

  function restartTimer() {
    if (timer) clearInterval(timer);
    const seconds = Math.max(2, Number(config().get('refreshSeconds')) || 5);
    timer = setInterval(tick, seconds * 1000);
  }

  panel.onVisible = () => { tick(); };
  // open the panel once after install, so it is found even with the Activity Bar hidden
  if (!context.globalState.get('ctxWatch.revealed')) {
    context.globalState.update('ctxWatch.revealed', true);
    vscode.commands.executeCommand('ctxWatch.sessions.focus');
  }
  restartTimer();
  tick();

  context.subscriptions.push(
    log,
    status,
    vscode.window.registerWebviewViewProvider('ctxWatch.sessions', panel),
    vscode.commands.registerCommand('ctxWatch.refresh', () => tick()),
    vscode.commands.registerCommand('ctxWatch.show', () => vscode.commands.executeCommand('ctxWatch.sessions.focus')),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('ctxWatch')) return;
      if (e.affectsConfiguration('ctxWatch.claudeDir')) { titles.clear(); burnCache.clear(); }
      restartTimer();
      tick();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => tick()),
    { dispose: () => { if (timer) clearInterval(timer); } },
  );
}

/** @param {number} n */
function human(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
}

function deactivate() {}

module.exports = { activate, deactivate };
