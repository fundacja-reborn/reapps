# Third-Party Notices

Reborn Apps is © 2025-2026 Fundacja Reborn and licensed under
[AGPL-3.0-only](LICENSE). The applications - including the binary packages
distributed through app stores - bundle open-source components from the npm
ecosystem. This file records how those components are licensed and the
license elections we make for dual-licensed packages.

## Dual-license elections

Where a bundled package is offered under a choice of licenses, Fundacja
Reborn elects the following license for redistribution:

| Package | Offered as | Elected |
|---|---|---|
| `jszip` | `MIT OR GPL-3.0-or-later` | **MIT** |
| `dompurify` | `MPL-2.0 OR Apache-2.0` | **Apache-2.0** |

## Dependency licensing overview

The full dependency tree (audited 2026-06-08, re-checked 2026-06-11; ~1.1k
unique packages) is overwhelmingly permissive: roughly 92% MIT/ISC/
Apache-2.0/BSD, with the remainder being other permissive licenses
(BlueOak, Unlicense, CC0, Zlib and similar).

No copyleft-only code is bundled into the client (and therefore native)
application packages. The only copyleft-licensed dependencies in the tree
sit outside the shipped bundle:

- `web-push` (MPL-2.0) - server-only (`$lib/server`), never shipped to
  clients;
- `lightningcss` (MPL-2.0) - build-time tool (Tailwind toolchain), not
  distributed;
- `sharp`/libvips (Apache-2.0/LGPL-3.0) - development tool (asset
  generation), not distributed.

## Bundled fonts

re/notes ships the following fonts as self-hosted files (no requests to a
font CDN). All are licensed under the SIL Open Font License 1.1, which
permits bundling with software under another license; the fonts themselves
remain under the OFL. The full license text is distributed next to each
font, as `OFL.txt` in its directory under `apps/reborn-notes/static/fonts/`.

| Font | Copyright | Used for |
|---|---|---|
| Roboto | 2011 The Roboto Project Authors | interface and default note font |
| Source Serif 4 | 2014 The Source Serif 4 Project Authors | optional note font (Latin script) |
| Amiri | 2010-2022 The Amiri Project Authors | optional note font (Arabic script) |
| Noto Naskh Arabic | 2022 The Noto Project Authors | optional note font (Arabic script) |
| Tajawal | 2018 Boutros International | optional note font (Arabic script) |

The files are the script subsets published by Google Fonts (Latin, Latin
Extended, Arabic), which the OFL treats as Modified Versions. None of these
fonts declares a Reserved Font Name, so the subsets keep the original names.

## Attribution and license texts

Exact bundled versions are pinned in `pnpm-lock.yaml`; each package carries
its copyright notice and license text in its published npm artifact
(`node_modules/<name>/LICENSE*`), which is the authoritative attribution
source for a given release. A flat inventory can be regenerated offline at
any time with the license audit script (see `docs/development` notes; the
script groups every installed package by its declared license and flags
anything non-permissive).
