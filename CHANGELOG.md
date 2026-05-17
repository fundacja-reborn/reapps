## 0.23.4 (2026-05-17)

### 🩹 Fixes

- **notes:** drop interactive-widget=resizes-content to stop IconNav squash ([#201](https://github.com/fundacja-reborn/reapps/pull/201))

## 0.23.3 (2026-05-17)

### 🩹 Fixes

- **notes,task:** inject localized OG meta tags for shared link unfurls ([#200](https://github.com/fundacja-reborn/reapps/pull/200))

## 0.23.2 (2026-05-17)

### 🩹 Fixes

- **notes:** prevent IconNav squash when keyboard opens on mobile list ([#197](https://github.com/fundacja-reborn/reapps/pull/197))
- **notes:** folder UI improvements ([#198](https://github.com/fundacja-reborn/reapps/pull/198))
- **notes:** push pending content before delete for archived notes ([#199](https://github.com/fundacja-reborn/reapps/pull/199))

## 0.23.1 (2026-05-17)

### 🩹 Fixes

- **share:** close manage dialog before opening create dialog ([#196](https://github.com/fundacja-reborn/reapps/pull/196))

## 0.23.0 (2026-05-16)

### 🚀 Features

- **share:** readonly snapshot ([#193](https://github.com/fundacja-reborn/reapps/pull/193), [#149](https://github.com/fundacja-reborn/reapps/issues/149), [#9](https://github.com/fundacja-reborn/reapps/issues/9), [#12](https://github.com/fundacja-reborn/reapps/issues/12), [#13](https://github.com/fundacja-reborn/reapps/issues/13), [#14](https://github.com/fundacja-reborn/reapps/issues/14))

### 🩹 Fixes

- **share:** rate limit and quota ([#194](https://github.com/fundacja-reborn/reapps/pull/194))

## 0.22.4 (2026-05-13)

### 🩹 Fixes

- **notes:** refresh open note view after pull sync ([#192](https://github.com/fundacja-reborn/reapps/pull/192))

## 0.22.3 (2026-05-13)

### 🩹 Fixes

- **notes:** preserve shadow indexes when metadata decrypt fails after login ([#189](https://github.com/fundacja-reborn/reapps/pull/189))
- **session:** expiry rebuild resilience ([#190](https://github.com/fundacja-reborn/reapps/pull/190))

## 0.22.2 (2026-05-13)

### 🩹 Fixes

- **notes:** preserve folder id when navigating from note metadata ([#186](https://github.com/fundacja-reborn/reapps/pull/186))
- **notes:** dim markdown markers on the active line in Live Preview ([#188](https://github.com/fundacja-reborn/reapps/pull/188))

## 0.22.1 (2026-05-12)

### 🩹 Fixes

- **notes:** match periodic notes by encrypted anchor, not by title ([#185](https://github.com/fundacja-reborn/reapps/pull/185))

## 0.22.0 (2026-05-12)

### 🚀 Features

- **notes:** multi select ([#183](https://github.com/fundacja-reborn/reapps/pull/183))

## 0.21.0 (2026-05-11)

### 🚀 Features

- **i18n:** localize service worker update toast across 5 locales ([#180](https://github.com/fundacja-reborn/reapps/pull/180))

### 🩹 Fixes

- **api-client:** three-state onUnauthorized contract with onSessionExpired callback ([#181](https://github.com/fundacja-reborn/reapps/pull/181))
- **deps:** rollback cookie to 0.7.2 and @hono/node-server to 1.19.14 ([#179](https://github.com/fundacja-reborn/reapps/pull/179))
- **i18n:** deep-recursive translation merge so common keys survive app-specific overrides ([#182](https://github.com/fundacja-reborn/reapps/pull/182))

## 0.20.1 (2026-05-11)

### 🩹 Fixes

- **deps:** update minor-updates ([#174](https://github.com/fundacja-reborn/reapps/pull/174))

## 0.20.0 (2026-05-10)

### 🚀 Features

- **auth:** cross-app SSO unlock for shared E2E master key ([#173](https://github.com/fundacja-reborn/reapps/pull/173))

### 🩹 Fixes

- **task:** preserve shadow indexes when metadata decrypt fails after session unlock ([#172](https://github.com/fundacja-reborn/reapps/pull/172))

## 0.19.1 (2026-05-10)

### 🩹 Fixes

- **deps:** update patch-updates ([#159](https://github.com/fundacja-reborn/reapps/pull/159))
- **deps:** update minor-updates ([#161](https://github.com/fundacja-reborn/reapps/pull/161))

## 0.19.0 (2026-05-09)

### 🚀 Features

- **notes:** task lists ([#158](https://github.com/fundacja-reborn/reapps/pull/158), [#147](https://github.com/fundacja-reborn/reapps/issues/147))

## 0.18.1 (2026-05-09)

### 🩹 Fixes

- **notes:** render nested list indentation in live preview ([#153](https://github.com/fundacja-reborn/reapps/pull/153), [#146](https://github.com/fundacja-reborn/reapps/issues/146))
- **notes:** create unfoldered note from periodic view ([#154](https://github.com/fundacja-reborn/reapps/pull/154))
- **notes:** list tab keymap ([#155](https://github.com/fundacja-reborn/reapps/pull/155))
- **notes:** toolbar empty sub-bullet renders as BulletList ([#156](https://github.com/fundacja-reborn/reapps/pull/156))
- **notes:** render PDF export list markers via CSS counters ([#157](https://github.com/fundacja-reborn/reapps/pull/157))

## 0.18.0 (2026-05-09)

### 🚀 Features

- **notes:** periodic notes ([#150](https://github.com/fundacja-reborn/reapps/pull/150))
- **storage:** e2e settings sync ([#151](https://github.com/fundacja-reborn/reapps/pull/151))

## 0.17.0 (2026-05-08)

### 🚀 Features

- **search:** query parser ([#137](https://github.com/fundacja-reborn/reapps/pull/137))
- **search:** query parser ([#138](https://github.com/fundacja-reborn/reapps/pull/138))
- **search:** freetext negation and quoted phrases (Tier 1.5) ([#139](https://github.com/fundacja-reborn/reapps/pull/139))
- **search:** tier 2 boolean or grouping ([#142](https://github.com/fundacja-reborn/reapps/pull/142))
- **task:** search inline ([#141](https://github.com/fundacja-reborn/reapps/pull/141))

### 🩹 Fixes

- **task:** auto-expand completed accordion when active results are empty ([#144](https://github.com/fundacja-reborn/reapps/pull/144))
- **utils:** avoid polynomial ReDoS in has:link evaluator ([#140](https://github.com/fundacja-reborn/reapps/pull/140), [#7](https://github.com/fundacja-reborn/reapps/issues/7))

## 0.16.0 (2026-05-05)

### 🚀 Features

- **notes:** tasks show time in list ([#136](https://github.com/fundacja-reborn/reapps/pull/136), [#135](https://github.com/fundacja-reborn/reapps/issues/135))

## 0.15.2 (2026-05-04)

### 🩹 Fixes

- **DateTimePicker:** update locale handling and date formatters for improved localization ([#134](https://github.com/fundacja-reborn/reapps/pull/134))
- **deps:** update minor-updates ([#130](https://github.com/fundacja-reborn/reapps/pull/130))
- **deps:** update patch-updates ([#128](https://github.com/fundacja-reborn/reapps/pull/128))

## 0.15.1 (2026-05-02)

### 🩹 Fixes

- **auth:** treat transient refresh failures as retryable, not session expiry ([#126](https://github.com/fundacja-reborn/reapps/pull/126))

## 0.15.0 (2026-05-02)

### 🚀 Features

- **task:** configurable notification lead time and date-only reminder hour ([#125](https://github.com/fundacja-reborn/reapps/pull/125))

## 0.14.6 (2026-05-01)

### 🩹 Fixes

- **notes:** make folder and tag DELETE endpoints idempotent ([#123](https://github.com/fundacja-reborn/reapps/pull/123))

## 0.14.5 (2026-05-01)

### 🩹 Fixes

- **notes:** defer all imports to pushPendingItems to satisfy folder FK ([#122](https://github.com/fundacja-reborn/reapps/pull/122))

## 0.14.4 (2026-05-01)

### 🩹 Fixes

- **notes:** make backup import resilient to legacy/null user_id ([#121](https://github.com/fundacja-reborn/reapps/pull/121), [#120](https://github.com/fundacja-reborn/reapps/issues/120))

## 0.14.3 (2026-05-01)

### 🩹 Fixes

- **notes:** accept null in folder_id/parent_id when importing JSON backup ([#120](https://github.com/fundacja-reborn/reapps/pull/120))

## 0.14.2 (2026-04-30)

### 🩹 Fixes

- **notes:** prevent wide code blocks/tables from stretching live preview on mobile ([#117](https://github.com/fundacja-reborn/reapps/pull/117))

## 0.14.1 (2026-04-30)

### 🩹 Fixes

- **notes:** editor mode dialog icon, dark popover contrast, missing register title ([#115](https://github.com/fundacja-reborn/reapps/pull/115))

## 0.14.0 (2026-04-30)

### 🚀 Features

- **notes:** render inline images in Live Preview with click-to-load ([#114](https://github.com/fundacja-reborn/reapps/pull/114))

## 0.13.0 (2026-04-29)

### 🚀 Features

- **notes:** make Live Preview the default editor mode with first-run intro ([#113](https://github.com/fundacja-reborn/reapps/pull/113))

## 0.12.3 (2026-04-29)

### 🩹 Fixes

- **notes:** position dialogs in visual viewport so iPad keyboard does not cover them ([#112](https://github.com/fundacja-reborn/reapps/pull/112))

## 0.12.2 (2026-04-29)

### 🩹 Fixes

- **notes:** also size desktop layout to visual viewport for iPad keyboard ([#111](https://github.com/fundacja-reborn/reapps/pull/111))

## 0.12.1 (2026-04-29)

### 🩹 Fixes

- **notes:** keep editor panel sized to visual viewport on mobile keyboard ([#110](https://github.com/fundacja-reborn/reapps/pull/110))

## 0.12.0 (2026-04-29)

### 🚀 Features

- **notes:** editable tables in live preview (Obsidian-style) ([#109](https://github.com/fundacja-reborn/reapps/pull/109))

## 0.11.0 (2026-04-29)

### 🚀 Features

- **live:** preview code blocks ([#108](https://github.com/fundacja-reborn/reapps/pull/108))

## 0.10.6 (2026-04-28)

### 🩹 Fixes

- **notes:** editor placeholder and caret ([#107](https://github.com/fundacja-reborn/reapps/pull/107))

## 0.10.5 (2026-04-28)

### 🩹 Fixes

- **notes:** restore scrolling in preview, settings, auth, and error pages ([#106](https://github.com/fundacja-reborn/reapps/pull/106), [#105](https://github.com/fundacja-reborn/reapps/issues/105))

## 0.10.4 (2026-04-28)

### 🩹 Fixes

- **notes:** stabilize editor header, split view, and toolbar on iPadOS Safari ([#105](https://github.com/fundacja-reborn/reapps/pull/105))

## 0.10.3 (2026-04-28)

### 🩹 Fixes

- **notes:** force raw markdown in split view editor pane ([#104](https://github.com/fundacja-reborn/reapps/pull/104))

## 0.10.2 (2026-04-28)

### 🩹 Fixes

- **notes:** make Live Preview italic visible, enable strikethrough, match Preview styling ([#103](https://github.com/fundacja-reborn/reapps/pull/103))

## 0.10.1 (2026-04-28)

### 🩹 Fixes

- **notes:** activate edit view when picking editor mode from toolbar ([#102](https://github.com/fundacja-reborn/reapps/pull/102))

## 0.10.0 (2026-04-28)

### 🚀 Features

- **notes:** add Live Preview editor mode with toolbar toggle ([#101](https://github.com/fundacja-reborn/reapps/pull/101))

## 0.9.6 (2026-04-28)

### 🩹 Fixes

- **deps:** update patch-updates ([#100](https://github.com/fundacja-reborn/reapps/pull/100))

## 0.9.5 (2026-04-28)

### 🩹 Fixes

- **crypto:** clear waitForRestore timer when restore wins the race ([#98](https://github.com/fundacja-reborn/reapps/pull/98))

## 0.9.4 (2026-04-27)

### 🩹 Fixes

- **auth:** single-flight 401 refresh and retry across sync paths ([#97](https://github.com/fundacja-reborn/reapps/pull/97))

## 0.9.3 (2026-04-27)

### 🩹 Fixes

- **deps:** update dependency marked to v18 ([#92](https://github.com/fundacja-reborn/reapps/pull/92))
- **deps:** update dependency dotenv to v17 ([#91](https://github.com/fundacja-reborn/reapps/pull/91))
- **deps:** update dependency diff to v9 ([#90](https://github.com/fundacja-reborn/reapps/pull/90))
- **deps:** update dependency zod to v4 ([#93](https://github.com/fundacja-reborn/reapps/pull/93))
- **deps:** update dependency @lucide/svelte to v1 ([#89](https://github.com/fundacja-reborn/reapps/pull/89))
- **deps:** update minor-updates ([#67](https://github.com/fundacja-reborn/reapps/pull/67))
- **types:** use ZodError.issues instead of deprecated .errors ([#95](https://github.com/fundacja-reborn/reapps/pull/95), [#93](https://github.com/fundacja-reborn/reapps/issues/93))
- **types:** pass explicit key schema to z.record() ([#96](https://github.com/fundacja-reborn/reapps/pull/96), [#93](https://github.com/fundacja-reborn/reapps/issues/93))

## 0.9.2 (2026-04-27)

### 🩹 Fixes

- **deps:** update svelte ([#69](https://github.com/fundacja-reborn/reapps/pull/69))
- **deps:** update prisma to v7.8.0 ([#68](https://github.com/fundacja-reborn/reapps/pull/68))

## 0.9.1 (2026-04-27)

### 🩹 Fixes

- **deps:** update patch-updates ([#66](https://github.com/fundacja-reborn/reapps/pull/66))

## 0.9.0 (2026-04-26)

### 🚀 Features

- **notes:** include subfolders in folder-view search ([#62](https://github.com/fundacja-reborn/reapps/pull/62))

## 0.8.4 (2026-04-26)

### 🩹 Fixes

- **notes:** drill-up folder navigation on mobile back gesture ([#61](https://github.com/fundacja-reborn/reapps/pull/61))

## 0.8.3 (2026-04-26)

This was a version bump only, there were no code changes.

## 0.8.2 (2026-04-26)

### 🩹 Fixes

- **notes:** add progress feedback and content sanitization to imports ([#58](https://github.com/fundacja-reborn/reapps/pull/58))

## 0.8.1 (2026-04-26)

### 🩹 Fixes

- **task,notes:** cache-bust app icons via ?v query string ([#57](https://github.com/fundacja-reborn/reapps/pull/57))

## 0.8.0 (2026-04-26)

### 🚀 Features

- **task:** show initial-sync state in main view on fresh login ([#55](https://github.com/fundacja-reborn/reapps/pull/55))

## 0.7.0 (2026-04-26)

### 🚀 Features

- **notes:** show initial-sync state in main view on fresh login ([#53](https://github.com/fundacja-reborn/reapps/pull/53))

## 0.6.5 (2026-04-26)

### 🩹 Fixes

- **notes:** heading wraps correctly in PDF export ([#52](https://github.com/fundacja-reborn/reapps/pull/52), [#2696](https://github.com/fundacja-reborn/reapps/issues/2696), [#3205](https://github.com/fundacja-reborn/reapps/issues/3205), [#1497](https://github.com/fundacja-reborn/reapps/issues/1497), [#51](https://github.com/fundacja-reborn/reapps/issues/51))

## 0.6.4 (2026-04-26)

### 🩹 Fixes

- **deps:** update dependency jspdf to v4 [security] ([#51](https://github.com/fundacja-reborn/reapps/pull/51))

## 0.6.3 (2026-04-26)

### 🩹 Fixes

- **deps:** update dependency postcss to v8.5.10 [security] ([#50](https://github.com/fundacja-reborn/reapps/pull/50))

## 0.6.2 (2026-04-25)

### 🩹 Fixes

- **notes:** repair PDF export on iOS Safari and Android PWA ([#48](https://github.com/fundacja-reborn/reapps/pull/48))

## 0.6.1 (2026-04-25)

### 🩹 Fixes

- **notes:** render PDF export in isolated iframe for PWA + filename ([#47](https://github.com/fundacja-reborn/reapps/pull/47))

## 0.6.0 (2026-04-25)

### 🚀 Features

- **notes:** add PDF export via native print dialog ([#46](https://github.com/fundacja-reborn/reapps/pull/46))

## 0.5.0 (2026-04-25)

### 🚀 Features

- **notes:** show subfolders in folder view ([#45](https://github.com/fundacja-reborn/reapps/pull/45))

## 0.4.1 (2026-04-25)

### 🩹 Fixes

- **notes:** switch to all-notes view when creating from trash + use existing delete_permanently i18n key ([#43](https://github.com/fundacja-reborn/reapps/pull/43))
- **notes:** order folder/tag pushes before notes during folder import ([#44](https://github.com/fundacja-reborn/reapps/pull/44), [#1](https://github.com/fundacja-reborn/reapps/issues/1))

## 0.4.0 (2026-04-25)

### 🚀 Features

- **notes:** add per-folder markdown import + clarify root prompt ([#42](https://github.com/fundacja-reborn/reapps/pull/42))

## 0.3.0 (2026-04-25)

### 🚀 Features

- **notes:** add duplicate handling strategies for markdown folder import ([#38](https://github.com/fundacja-reborn/reapps/pull/38))

### 🩹 Fixes

- **deps:** update dependency uuid to v14 ([#35](https://github.com/fundacja-reborn/reapps/pull/35))

## 0.2.0 (2026-04-23)

### 🚀 Features

- **notes:** add back arrow to desktop note header ([#29](https://github.com/fundacja-reborn/reapps/pull/29))

### 🩹 Fixes

- back sync indicator with real connectivity probe ([#31](https://github.com/fundacja-reborn/reapps/pull/31))
- **task:** restore offline session regardless of navigator.onLine ([#30](https://github.com/fundacja-reborn/reapps/pull/30))

## 0.1.4 (2026-04-22)

### 🩹 Fixes

- **notes:** render single newlines as line breaks in markdown preview ([a9efa3d](https://github.com/fundacja-reborn/reapps/commit/a9efa3d))
- **security:** address CodeQL findings ([#26](https://github.com/fundacja-reborn/reapps/pull/26))

## 0.1.3 (2026-04-22)

### 🩹 Fixes

- **auth:** handle 2FA in re-auth flow and serialize refresh across tabs ([aca2cf3](https://github.com/fundacja-reborn/reapps/commit/aca2cf3))
- **notes:** mark sync_status pending on every local mutation ([92eed2a](https://github.com/fundacja-reborn/reapps/commit/92eed2a))
- **notes:** keep sync_status pending when entity mutated during push ([1cb907f](https://github.com/fundacja-reborn/reapps/commit/1cb907f))
- **notes:** serialize per-entity push ops and intent-check delete/restore ([2aa7bac](https://github.com/fundacja-reborn/reapps/commit/2aa7bac))
- **notes:** propagate soft-delete and restore across devices ([5e01b7c](https://github.com/fundacja-reborn/reapps/commit/5e01b7c))

## 0.1.2 (2026-04-21)

### 🩹 Fixes

- **auth:** recover from master key / IDB ciphertext mismatch ([76d2281](https://github.com/fundacja-reborn/reapps/commit/76d2281))
- **release:** sync private workspace manifests in nx release ([dd424be](https://github.com/fundacja-reborn/reapps/commit/dd424be))
- **release:** add --specifier flag and release:patch/minor scripts ([a7ba4b8](https://github.com/fundacja-reborn/reapps/commit/a7ba4b8))
- **release:** detect conventional-commits bump across whole workspace ([3280f6e](https://github.com/fundacja-reborn/reapps/commit/3280f6e))
- **release:** decode spaces in repo path when resolving workspace root ([a2a7751](https://github.com/fundacja-reborn/reapps/commit/a2a7751))

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

## 0.1.0 (2026-04-20)

This was a version bump only, there were no code changes.