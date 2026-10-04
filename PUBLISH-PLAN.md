# Publish plan: Context Watch as a VS Code extension

Restart context for a fresh session (updated 2026-10-04). Read this, not the old chat.

## Goal
Ship "Context Watch for Claude Code" on VS Code Marketplace + Open VSX (Cursor/Windsurf/VSCodium).

## State: v1.0.1 released (2026-10-04)
- Plain JavaScript (CommonJS + `// @ts-check`), zero runtime dependencies, no build step.
  `engines.vscode ^1.75.0` -> code must stay Node 16 compatible (no `fs.readdir` recursive,
  no `Array.findLast`, no `structuredClone`).
- Python prototype removed from the repo (git history keeps it). Owner: no need to keep old stuff.
- Publisher ID: `nguyenxuantai` (also in `.env`, which is git-ignored and holds the Open VSX token).
- GitHub repo: `anhtaicn/context-watch-for-claude-code-in-vscode` (renamed from `claude-ctx-watch`; package.json and README already point to the new name).
- Layout: `src/sessions.js` (scan, titles, alive), `src/burn.js`, `src/lines.js` (incremental and
  tail readers), `src/windows.js` (model table), `src/view.js` + `media/panel.*` (webview),
  `src/extension.js` (timer, status bar). Tests: `test/core.test.js`.
- Checks: `npm run check && npm test`, package with `npx vsce package`.
- Smoke on owner's machine: 446 transcripts, 20 sessions; scan 35 ms, burn 6 ms after first pass.

## Remaining
1. Ow## Release status
- Marketplace: 1.0.0 uploaded by owner (its repo links are wrong); **owner must upload 1.0.1**
  (`context-watch-1.0.1.vsix`, also attached to the GitHub Release) via Manage > ... > Update.
- Open VSX: 1.0.1 published from this machine (`npx ovsx publish`, token read from `.env`).
- GitHub Release v1.0.1 created by the Action. Open VSX step in CI skips: secret `OVSX_PAT` not
  set (`gh` is not logged in). Until it is, publish Open VSX locally as above.

## Next release
1. Bump `version` in package.json + CHANGELOG, `npm run check && npm test`, commit, push.
2. `git tag vX.Y.Z && git push origin vX.Y.Z` -> Action builds the Release with the .vsix.
3. Open VSX: `npx ovsx publish <vsix>` with OVSX_PAT from `.env` (or set the repo secret once).
4. Marketplace: owner uploads the .vsix by hand.
5. Optional: claim the Open VSX namespace (issue on EclipseFdn/open-vsx.org) for the verified badge.

e formats read are undocumented Claude Code internals; can break on CC updates.
- Model window table needs manual upkeep (`src/windows.js`).
- A reused PID can make a closed session look live (`procStart` in the pid file could fix it).
