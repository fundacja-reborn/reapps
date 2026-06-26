## 0.37.1 (2026-06-26)

### 🩹 Fixes

- **whats-new:** scope last-seen baseline per app ([#346](https://github.com/fundacja-reborn/reapps/pull/346))

## 0.37.0 (2026-06-26)

### 🚀 Features

- **backup:** portable cross-account password-encrypted export ([#335](https://github.com/fundacja-reborn/reapps/pull/335))
- **notes:** back/forward navigation between linked notes ([#337](https://github.com/fundacja-reborn/reapps/pull/337))
- **notes:** in-note search with match navigation ([#344](https://github.com/fundacja-reborn/reapps/pull/344))

### 🩹 Fixes

- **backup:** warn that portable import adds a fresh copy ([#340](https://github.com/fundacja-reborn/reapps/pull/340), [#335](https://github.com/fundacja-reborn/reapps/issues/335))
- **notes:** show authored label for internal links in Preview ([#336](https://github.com/fundacja-reborn/reapps/pull/336))
- **notes:** remap internal note links on portable cross-account import ([#343](https://github.com/fundacja-reborn/reapps/pull/343))
- **settings:** localize task file picker, drop notes folder-sync dupe ([#342](https://github.com/fundacja-reborn/reapps/pull/342))
- **task:** interpolate counts in import summary message ([#339](https://github.com/fundacja-reborn/reapps/pull/339))
- **task:** guard cross-account import of account-key encrypted backup ([#338](https://github.com/fundacja-reborn/reapps/pull/338))
- **task:** localize export/import labels in settings UI ([#341](https://github.com/fundacja-reborn/reapps/pull/341))

## 0.36.0 (2026-06-24)

### 🚀 Features

- **notes:** heading anchors + table of contents ([#327](https://github.com/fundacja-reborn/reapps/pull/327))
- **notes:** show the outline toggle in the mobile note header ([#329](https://github.com/fundacja-reborn/reapps/pull/329))

## 0.35.0 (2026-06-23)

### 🚀 Features

- **reapps:** what's new release notes across apps and website ([#324](https://github.com/fundacja-reborn/reapps/pull/324))

## 0.34.1 (2026-06-22)

### 🩹 Fixes

- **notes:** pin Encryption X-Ray overlay to the editor viewport ([#321](https://github.com/fundacja-reborn/reapps/pull/321))

## 0.34.0 (2026-06-21)

### 🚀 Features

- **notes:** convert inter-note links on Markdown import (opt-in) ([#317](https://github.com/fundacja-reborn/reapps/pull/317))
- **notes:** convert Obsidian wikilinks on Markdown import (opt-in) ([#318](https://github.com/fundacja-reborn/reapps/pull/318), [#317](https://github.com/fundacja-reborn/reapps/issues/317))
- **notes:** linked-notes panel (backlinks + outgoing links) ([#319](https://github.com/fundacja-reborn/reapps/pull/319))

## 0.33.0 (2026-06-20)

### 🚀 Features

- **notes:** native folder sync (FolderSource + FolderFs plugin) ([#310](https://github.com/fundacja-reborn/reapps/pull/310))
- **notes:** native folder sync on Android (FolderFs Java/SAF plugin) ([#312](https://github.com/fundacja-reborn/reapps/pull/312))

### 🩹 Fixes

- **auth:** allow entering all 6 2FA digits on iOS native ([#313](https://github.com/fundacja-reborn/reapps/pull/313))
- **notes:** persist native refresh token on local-to-account upgrade ([#306](https://github.com/fundacja-reborn/reapps/pull/306))
- **notes:** layout height tracks window resize ([#3](https://github.com/fundacja-reborn/reapps/pull/3), [#307](https://github.com/fundacja-reborn/reapps/pull/307))
- **notes:** align split preview header with the variable-height editor toolbar ([#308](https://github.com/fundacja-reborn/reapps/pull/308))
- **notes:** pull note versions only for changed notes (native sync speed) ([#309](https://github.com/fundacja-reborn/reapps/pull/309))
- **notes:** keep iOS keyboard off auth & settings password fields ([#311](https://github.com/fundacja-reborn/reapps/pull/311))
- **notes:** account login from local-only mode (state + sync + UX) ([#314](https://github.com/fundacja-reborn/reapps/pull/314))

## 0.32.2 (2026-06-17)

### 🩹 Fixes

- **notes:** gate "Load all images" banner on a render counter, not an HTML scan ([#303](https://github.com/fundacja-reborn/reapps/pull/303))

## 0.32.1 (2026-06-17)

### 🩹 Fixes

- **docker:** align container pnpm to packageManager (11.1.2) ([#301](https://github.com/fundacja-reborn/reapps/pull/301), [#300](https://github.com/fundacja-reborn/reapps/issues/300))
- **notes:** Obsidian-style tag autocomplete keyboard nav + clear input on select ([#298](https://github.com/fundacja-reborn/reapps/pull/298))

## 0.32.0 (2026-06-15)

### 🚀 Features

- **notes:** surface hard push rejections as per-note sync_error ([#288](https://github.com/fundacja-reborn/reapps/pull/288))
- **task:** surface hard push rejections as per-task sync_error ([#293](https://github.com/fundacja-reborn/reapps/pull/293))

### 🩹 Fixes

- **deps:** update dependency esbuild to v0.28.1 [security] ([#291](https://github.com/fundacja-reborn/reapps/pull/291))
- **deps:** update codemirror to v6.43.1 ([#292](https://github.com/fundacja-reborn/reapps/pull/292))
- **deps:** update patch-updates ([#294](https://github.com/fundacja-reborn/reapps/pull/294))
- **notes:** sync large notes blocked by 512K server body limit ([#286](https://github.com/fundacja-reborn/reapps/pull/286))
- **task:** trash-aware detail view + bigger mobile search toggle ([#296](https://github.com/fundacja-reborn/reapps/pull/296))

### 🔥 Performance

- **notes:** cap concurrency of bulk push sync (settleInBatches) ([#287](https://github.com/fundacja-reborn/reapps/pull/287))

## 0.31.1 (2026-06-14)

### 🩹 Fixes

- **notes:** keep whitespace outside emphasis markers when formatting ([#284](https://github.com/fundacja-reborn/reapps/pull/284))

## 0.31.0 (2026-06-14)

### 🚀 Features

- **crypto:** optional local passcode for local-only mode ([#278](https://github.com/fundacja-reborn/reapps/pull/278))
- **notes:** local-only / no-account mode + upgrade to account ([#276](https://github.com/fundacja-reborn/reapps/pull/276))
- **task:** local-only / no-account mode + upgrade to account ([#277](https://github.com/fundacja-reborn/reapps/pull/277), [#276](https://github.com/fundacja-reborn/reapps/issues/276))

### 🩹 Fixes

- **notes:** match folder-sync files to notes by path manifest ([#279](https://github.com/fundacja-reborn/reapps/pull/279))
- **notes:** suppress "Load all images" on code-span image syntax ([#280](https://github.com/fundacja-reborn/reapps/pull/280))

## 0.30.0 (2026-06-13)

### 🚀 Features

- **notes:** folder import targeting and unchanged-note skip ([#270](https://github.com/fundacja-reborn/reapps/pull/270))
- **notes:** live folder sync - one-way local directory mirror ([#271](https://github.com/fundacja-reborn/reapps/pull/271), [#270](https://github.com/fundacja-reborn/reapps/issues/270))
- **notes:** folder sync - nested destination paths ([#273](https://github.com/fundacja-reborn/reapps/pull/273))
- **ui:** add Support heart link to the icon nav in both apps ([#268](https://github.com/fundacja-reborn/reapps/pull/268))

### 🩹 Fixes

- **notes:** left-align "search in content" label when it wraps ([#274](https://github.com/fundacja-reborn/reapps/pull/274))

## 0.29.1 (2026-06-11)

### 🩹 Fixes

- **notes:** stop Safari clipping 2-digit ordered-list markers in preview ([#265](https://github.com/fundacja-reborn/reapps/pull/265), [#262](https://github.com/fundacja-reborn/reapps/issues/262))

## 0.29.0 (2026-06-11)

### 🚀 Features

- **notes:** deep links + native share sheet for shares (Faza 3b) ([#258](https://github.com/fundacja-reborn/reapps/pull/258))
- **notes:** saved searches / smart folders (Travis Tier 2) ([#263](https://github.com/fundacja-reborn/reapps/pull/263))

## 0.28.0 (2026-06-09)

### 🚀 Features

- **notes:** detect + merge multi-device periodic-note duplicates ([#250](https://github.com/fundacja-reborn/reapps/pull/250), [#248](https://github.com/fundacja-reborn/reapps/issues/248))
- **notes:** render horizontal rule (---) in Live Preview ([#251](https://github.com/fundacja-reborn/reapps/pull/251))

### 🩹 Fixes

- **deps:** update codemirror ([#240](https://github.com/fundacja-reborn/reapps/pull/240))
- **deps:** update patch-updates ([#241](https://github.com/fundacja-reborn/reapps/pull/241))
- **notes:** make last code line selectable + add copy button ([#246](https://github.com/fundacja-reborn/reapps/pull/246))

## 0.27.0 (2026-06-07)

### 🚀 Features

- **auth:** extend refresh-token lifetime to 30 days ([#236](https://github.com/fundacja-reborn/reapps/pull/236))

### 🩹 Fixes

- **deps:** bump hono override to 4.12.23 to clear moderate advisories ([#235](https://github.com/fundacja-reborn/reapps/pull/235))

## 0.26.6 (2026-06-04)

### 🩹 Fixes

- **deps:** bump dompurify to 3.4.8 (XSS, GHSA-87xg-pxx2-7hvx) ([#229](https://github.com/fundacja-reborn/reapps/pull/229))
- **task:** quick-add fixes for empty lists, list selector, and submit UX ([#228](https://github.com/fundacja-reborn/reapps/pull/228), [#227](https://github.com/fundacja-reborn/reapps/issues/227))

## 0.26.5 (2026-05-29)

### 🩹 Fixes

- **csp:** zod jitless ([#224](https://github.com/fundacja-reborn/reapps/pull/224))

## 0.26.4 (2026-05-27)

### 🩹 Fixes

- **task:** route notification clicks to PWA window under sub-path ([#222](https://github.com/fundacja-reborn/reapps/pull/222))

## 0.26.3 (2026-05-27)

### 🩹 Fixes

- **task:** push delivery ([#220](https://github.com/fundacja-reborn/reapps/pull/220))

## 0.26.2 (2026-05-27)

### 🩹 Fixes

- **task:** auto-recover push subscription after VAPID key rotation ([#219](https://github.com/fundacja-reborn/reapps/pull/219))

## 0.26.1 (2026-05-27)

### 🩹 Fixes

- **task:** fan out push schedules per user + align cron to wall-clock 5min ([#218](https://github.com/fundacja-reborn/reapps/pull/218))

## 0.26.0 (2026-05-27)

### 🚀 Features

- **task:** push notifications server side ([#216](https://github.com/fundacja-reborn/reapps/pull/216))

## 0.25.2 (2026-05-26)

### 🩹 Fixes

- **notes:** keep caret at click position on plain list content in Live Preview ([#215](https://github.com/fundacja-reborn/reapps/pull/215), [#153](https://github.com/fundacja-reborn/reapps/issues/153))

## 0.25.1 (2026-05-19)

### 🩹 Fixes

- **session:** expired banner rate limit ([#213](https://github.com/fundacja-reborn/reapps/pull/213))
- **ui:** gate share dialogs on active session, fix programmatic re-auth close ([#214](https://github.com/fundacja-reborn/reapps/pull/214))

## 0.25.0 (2026-05-18)

### 🚀 Features

- **ui:** support Windows forced-colors mode for selected states ([#212](https://github.com/fundacja-reborn/reapps/pull/212))

## 0.24.1 (2026-05-18)

### 🩹 Fixes

- **deps:** update patch-updates ([#207](https://github.com/fundacja-reborn/reapps/pull/207))
- **deps:** update minor-updates ([#209](https://github.com/fundacja-reborn/reapps/pull/209))
- **notes:** enlarge action icons in All Notes header on mobile ([#210](https://github.com/fundacja-reborn/reapps/pull/210))

## 0.24.0 (2026-05-17)

### 🚀 Features

- **notes,task:** add Copy markdown / Download .md to share viewer ([#203](https://github.com/fundacja-reborn/reapps/pull/203))

### 🩹 Fixes

- **notes,task:** localize app-loading stall and offline banners ([#202](https://github.com/fundacja-reborn/reapps/pull/202))

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