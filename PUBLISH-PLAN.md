# Publish plan: Context Watch as a VS Code extension

Restart context for a fresh session (updated 2026-10-04). Read this, not the old chat.

## Goal
Ship "Context Watch for Claude Code" on VS Code Marketplace + Open VSX (Cursor/Windsurf/VSCodium).

## State: v1.0.0 built, installed locally, not published
- Plain JavaScript (CommonJS + `// @ts-check`), zero runtime dependencies, no build step.
  `engines.vscode ^1.75.0` -> code must stay Node 16 compatible (no `fs.readdir` recursive,
  no `Array.findLast`, no `structuredClone`).
- Python prototype removed from the repo (git history keeps it). Owner: no need to keep old stuff.
- Publisher ID: `nguyenxuantai` (also in `.env`, which is git-ignored and holds the Open VSX token).
- Layout: `src/sessions.js` (scan, titles, alive), `src/burn.js`, `src/lines.js` (incremental and
  tail readers), `src/windows.js` (model table), `src/view.js` + `media/panel.*` (webview),
  `src/extension.js` (timer, status bar). Tests: `test/core.test.js`.
- Checks: `npm run check && npm test`, package with `npx vsce package`.
- Smoke on owner's machine: 446 transcripts, 20 sessions; scan 35 ms, burn 6 ms after first pass.

## Remaining
1. Owner looks at the panel (Activity Bar icon "Context Watch") and the status bar item.
2. Screenshot/GIF for README (owner captures; add as `media/screenshot.png`, link absolutely).
3. Push to GitHub, `gh secret set OVSX_PAT` (owner pastes the token from `.env` at the prompt),
   `npx ovsx create-namespace nguyenxuantai -p <token>` once.
4. `git tag v1.0.0 && git push --tags` -> Action tests on 3 OSes, creates a GitHub Release with the
   .vsix, publishes to Open VSX.
5. Owner uploads the .vsix at marketplace.visualstudio.com/manage (no Azure DevOps PAT: needs a card).
6. Claim the Open VSX namespace (issue on EclipseFdn/open-vsx.org) to drop the "unverified" badge.

## Risks
- All file formats read are undocumented Claude Code internals; can break on CC updates.
- Model window table needs manual upkeep (`src/windows.js`).
- A reused PID can make a closed session look live (`procStart` in the pid file could fix it).
