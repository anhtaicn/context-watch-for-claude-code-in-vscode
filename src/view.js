// @ts-check
'use strict';

const vscode = require('vscode');
const crypto = require('crypto');

/** Sidebar panel. The page renders whatever the extension last posted; it reads no files. */
class PanelProvider {
  /** @param {vscode.Uri} extensionUri */
  constructor(extensionUri) {
    this.extensionUri = extensionUri;
    /** @type {vscode.WebviewView | null} */
    this.view = null;
    /** @type {unknown} */
    this.last = null;
    /** @type {() => void} */
    this.onVisible = () => {};
  }

  get visible() {
    return !!this.view && this.view.visible;
  }

  /** @param {vscode.WebviewView} view */
  resolveWebviewView(view) {
    this.view = view;
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    view.webview.html = html(view.webview, media);
    view.webview.onDidReceiveMessage((msg) => {
      if (msg && msg.type === 'ready' && this.last) view.webview.postMessage(this.last);
    });
    view.onDidChangeVisibility(() => { if (view.visible) this.onVisible(); });
    view.onDidDispose(() => { this.view = null; });
    this.onVisible();
  }

  /** @param {unknown} state */
  post(state) {
    this.last = state;
    if (this.view) this.view.webview.postMessage(state);
  }
}

/**
 * @param {vscode.Webview} webview
 * @param {vscode.Uri} media
 */
function html(webview, media) {
  const nonce = crypto.randomBytes(16).toString('base64');
  const css = webview.asWebviewUri(vscode.Uri.joinPath(media, 'panel.css'));
  const js = webview.asWebviewUri(vscode.Uri.joinPath(media, 'panel.js'));
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${css}">
</head>
<body>
<div id="burn" class="burn" hidden></div>
<div id="list"></div>
<script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
}

module.exports = { PanelProvider };
