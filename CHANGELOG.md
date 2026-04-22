## 0.1.4 (2026-04-22)

### 🩹 Fixes

- **notes:** render single newlines as line breaks in markdown preview ([a9efa3d](https://github.com/fundacja-reborn/reapps/commit/a9efa3d))
- **security:** address CodeQL findings ([#26](https://github.com/fundacja-reborn/reapps/pull/26))

### ❤️ Thank You

- rerefu @rerefu

## 0.1.3 (2026-04-22)

### 🩹 Fixes

- **auth:** handle 2FA in re-auth flow and serialize refresh across tabs ([aca2cf3](https://github.com/fundacja-reborn/reapps/commit/aca2cf3))
- **notes:** mark sync_status pending on every local mutation ([92eed2a](https://github.com/fundacja-reborn/reapps/commit/92eed2a))
- **notes:** keep sync_status pending when entity mutated during push ([1cb907f](https://github.com/fundacja-reborn/reapps/commit/1cb907f))
- **notes:** serialize per-entity push ops and intent-check delete/restore ([2aa7bac](https://github.com/fundacja-reborn/reapps/commit/2aa7bac))
- **notes:** propagate soft-delete and restore across devices ([5e01b7c](https://github.com/fundacja-reborn/reapps/commit/5e01b7c))

### ❤️ Thank You

- rerefu @rerefu

## 0.1.2 (2026-04-21)

### 🩹 Fixes

- **auth:** recover from master key / IDB ciphertext mismatch ([76d2281](https://github.com/fundacja-reborn/reapps/commit/76d2281))
- **release:** sync private workspace manifests in nx release ([dd424be](https://github.com/fundacja-reborn/reapps/commit/dd424be))
- **release:** add --specifier flag and release:patch/minor scripts ([a7ba4b8](https://github.com/fundacja-reborn/reapps/commit/a7ba4b8))
- **release:** detect conventional-commits bump across whole workspace ([3280f6e](https://github.com/fundacja-reborn/reapps/commit/3280f6e))
- **release:** decode spaces in repo path when resolving workspace root ([a2a7751](https://github.com/fundacja-reborn/reapps/commit/a2a7751))

### ❤️ Thank You

- rerefu @rerefu

## 0.1.1 (2026-04-21)

### 🩹 Fixes

- prevent ghost tasks after user switch in Task app ([ae70de0](https://github.com/fundacja-reborn/reapps/commit/ae70de0))
- renovate config — replace deprecated options ([20a9efd](https://github.com/fundacja-reborn/reapps/commit/20a9efd))
- prevent offline data loss in IndexedDB on key restore and notes sync ([6549d94](https://github.com/fundacja-reborn/reapps/commit/6549d94))
- suppress DEBUG logs in production browser console ([b7450a8](https://github.com/fundacja-reborn/reapps/commit/b7450a8))
- suppress DEBUG/INFO logs in production browser console ([768a7c1](https://github.com/fundacja-reborn/reapps/commit/768a7c1))
- **gitignore:** add .mailmap to ignore Git identity files ([af3ebca](https://github.com/fundacja-reborn/reapps/commit/af3ebca))
- **notes:** regenerate maskable icon with safe zone and clean up manifests ([e6e83b5](https://github.com/fundacja-reborn/reapps/commit/e6e83b5))
- **pwa:** prevent offline startup loading hangs ([5230411](https://github.com/fundacja-reborn/reapps/commit/5230411))
- **pwa:** switch service worker navigation to cache-first with SPA shell fallback ([3457557](https://github.com/fundacja-reborn/reapps/commit/3457557))
- **task:** stabilize offline auth bootstrap and session expiry handling ([6382f58](https://github.com/fundacja-reborn/reapps/commit/6382f58))
- **task:** resolve PWA offline startup redirect loop and false offline screen ([ccc94fd](https://github.com/fundacja-reborn/reapps/commit/ccc94fd))
- **task:** remove dead server load blocking PWA offline cold start ([db688a6](https://github.com/fundacja-reborn/reapps/commit/db688a6))
- **task:** restore offline session from persisted credentials ([b59b664](https://github.com/fundacja-reborn/reapps/commit/b59b664))
- **task:** eliminate offline cold-start race that redirected to login ([8eb8e40](https://github.com/fundacja-reborn/reapps/commit/8eb8e40))
- **task:** remove redundant onStorageInit from E2E restore path ([5107ddd](https://github.com/fundacja-reborn/reapps/commit/5107ddd))
- **task:** sync pending offline ops on PWA cold start ([161aa21](https://github.com/fundacja-reborn/reapps/commit/161aa21))

### ❤️ Thank You

- rerefu @rerefu

## 0.1.0 (2026-04-20)

This was a version bump only, there were no code changes.