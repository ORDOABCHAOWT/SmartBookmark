# Smart Bookmark Agent Guide

Read this before editing Smart Bookmark.

## Repository Map

- `manifest.json`: Chrome/Edge extension manifest. Preserve the fixed key and permissions unless explicitly changing release identity or capability.
- Root `*.js`, `*.html`, and `css/`: active extension source.
- `_locales/`: localization resources.
- `tests/`: Node-based regression and extension identity tests.
- `scripts/check-extension-identity.js`: verifies stable extension ID derived from `manifest.json`.
- `EXTENSION_ID`: expected Chrome extension ID.
- `build.py` and `build.sh`: production/development packaging workflow.
- `backup-pre-redesign/`, `icons-backup/`, `icons-new/`, `ui-previews/`: historical or design-support material; do not treat as active runtime source unless the user asks.

## Commands

- Behavior regression check: `node tests/smartbookmark.regression.test.js`
- Extension identity test: `node tests/extensionIdentity.test.js`
- Manifest identity script: `node scripts/check-extension-identity.js`
- Production package: `./build.sh`

There is no `package.json` in this project. Do not invent an npm workflow unless the project is intentionally migrated.

## Non-Negotiable Behavior

- Preserve the extension ID unless the user explicitly requests a breaking release identity change.
- Keep manifest permissions minimal; do not add new permissions without a clear product need.
- Do not commit API keys, WebDAV credentials, tokens, or private sync data.
- Maintain Chrome and Edge packaging paths.
- Avoid editing backup or preview directories as if they were production code.
- Keep search behavior useful without requiring embedding APIs for exact or deterministic matches.

## Working Agreements

- For search, tagging, storage, identity, or UI layout changes, add or update the Node regression tests when practical.
- For visual changes, verify the unpacked extension manually in Chrome/Edge if browser access is available; otherwise report that manual verification remains.
- Keep root source files loadable directly by the browser extension runtime.
- Before release packaging, run both regression tests and identity checks.

## Done Criteria

- `node tests/smartbookmark.regression.test.js` passes.
- `node tests/extensionIdentity.test.js` passes.
- `node scripts/check-extension-identity.js` passes.
- If packaging was requested, `./build.sh` completes and the generated Chrome/Edge zip paths are reported.

