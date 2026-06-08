# Contributing to Reborn Apps

Thank you for your interest in Reborn Apps. We genuinely value community involvement, but the way to contribute here is different from most open-source projects. This document explains how, and why.

## We do not accept external code contributions

**All code is written exclusively by Reborn Foundation. We do not accept external pull requests.** Any PR that changes code that ships with the app (including translation files, configuration, and bundled documentation) will be politely closed with a pointer to this document.

This is a deliberate choice, for two reasons:

1. **Security integrity.** Reborn Apps is built on end-to-end encryption and a Zero Knowledge architecture. A single subtle change in the wrong place (a logged plaintext, a key sent to the server, a weakened cipher) breaks the core promise. Every line passes internal security review, and we do not merge code we did not write and review end to end.

2. **Copyright consolidation.** Keeping copyright in a single holder (Reborn Foundation) is what lets us release the apps under the AGPL-3.0 while also distributing native builds through the Apple App Store and Google Play. Copyleft licenses and app-store terms conflict when copyright is fragmented across many contributors; with one holder, we can license and distribute cleanly. It also keeps relicensing and legal decisions in one accountable place: the foundation.

## How you can help, and you really can

Non-code contributions shape this project, and they are credited:

- **Report a bug** - [open an Issue](https://github.com/fundacja-reborn/reapps/issues) with clear reproduction steps. If you know the fix, describe it; we will implement it and credit you (a `Reported-by:` line in the commit, and a mention in the release notes).
- **Suggest a feature or discuss an idea** - join [GitHub Discussions](https://github.com/fundacja-reborn/reapps/discussions). Ideas that shape the product are credited in the README Acknowledgments.
- **Report a security vulnerability** - privately, via our [Security Policy](SECURITY.md). Responsibly disclosed findings are credited in the SECURITY.md Hall of Fame.
- **Improve translations** - suggest corrections or a new language via an Issue or Discussion. We keep all five locales (EN, PL, DE, FR, ES) in sync; send us the text and we will integrate it, with credit.

When a good idea or fix arrives through an Issue, we reimplement it ourselves and credit the reporter. That keeps copyright consolidated without losing your contribution or your recognition.

## Self-hosting and forking

"No external contributions" does not mean closed. The AGPL-3.0 gives you full freedom to **use, study, modify, and self-host** Reborn Apps. If you want to change the code for your own deployment, fork the repository; that is exactly what the license is for. If you run a modified version as a network service, the AGPL requires you to publish your changes under the same license.

---

Reborn Apps is built by [Reborn Foundation](https://reborn.org.pl), a non-profit in Poland. Thank you for helping us build privacy software the right way.
