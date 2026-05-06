# Search operators

Both **re/task** and **re/notes** ship a unified search box that combines plain-text search with structured operators. Type a few words for substring search; add operators to filter by tag, folder, list, dates, flags, and more.

All search runs **client-side** over already-decrypted data — the server never sees your query. Operators are therefore privacy-neutral: they don't add a new attack surface compared to plain-text search.

---

## Quick reference

| Operator | Where | Examples |
|---|---|---|
| `tag:NAME` | re/notes | `tag:work`, `tag:"side projects"` |
| `folder:PATH` | re/notes | `folder:projects`, `folder:projects/active` |
| `list:NAME` | re/task | `list:Inbox`, `list:"this week"` |
| `created:DATE` | both | `created:2026-01-01`, `created:>2026-01-01`, `created:<7d`, `created:today`, `created:2026-01-01..2026-02-01` |
| `modified:DATE` | both | `modified:<14d`, `modified:yesterday` |
| `due:DATE` | re/task | `due:<7d`, `due:today`, `due:>2026-06-01` |
| `is:starred` | both | `is:starred` |
| `is:pinned` | re/notes | `is:pinned` |
| `is:completed` | re/task | `is:completed` |
| `is:overdue` | re/task | `is:overdue` |
| `is:trashed` | both | `is:trashed` (see [trash note](#searching-in-trash) below) |
| `has:link` | both | `has:link` (matches notes/descriptions containing URLs or Markdown links) |

**Modifiers**

- `-OPERATOR` — negate the operator. Example: `-tag:archived` (exclude tag), `-is:completed` (only incomplete).
- `"quoted value"` — preserve whitespace and colons inside an operator value. Example: `tag:"in progress"`, `list:"Q2 planning"`.

**Combining**

All operators are AND-combined with each other and with any plain-text words. Example:

```
meeting tag:work -is:completed modified:<14d
```

…matches items containing the word *meeting*, tagged `work`, not yet completed, modified within the last 14 days.

---

## Date operators in detail

Three fields accept date expressions: `created:` (creation timestamp), `modified:` (last update), and `due:` (re/task only). All three accept the same expression grammar.

### Absolute dates

```
created:2026-01-15            # exactly that day
created:>2026-01-15           # after that day
created:<2026-01-15           # before that day
created:2026-01-01..2026-01-31  # range, inclusive on both ends
```

Format is always `YYYY-MM-DD`. Invalid dates (e.g. `2026-02-30`) silently fall back to plain-text search instead of erroring — you can keep typing without seeing red squiggles.

### Relative ranges

```
modified:<7d   # within the last 7 days
created:<2w    # within the last 2 weeks
modified:>1m   # older than 1 month
due:<3d        # due within the next 3 days  ← note: `due:` is forward-looking
```

Units: `d` (days), `w` (weeks = 7 days), `m` (months ≈ 30 days).

> **Note on the `<`/`>` direction with relative ranges:** `<7d` means *recent* (within the last 7 days), `>7d` means *older than 7 days*. Mnemonic: `<` points toward "now," `>` points away from it.

### Keywords

```
created:today
modified:yesterday
```

Dates are interpreted in your **local timezone**, not UTC — "today" matches your wall clock.

---

## Plain-text and the description/content toggle

Plain-text words (anything that's not an operator) match by substring against:

- **Titles** — always, instantly, no decryption.
- **Descriptions** (re/task) / **content** (re/notes) — only when the *Search in description / content* toggle is on. Decryption happens in-memory; the server never sees the query.

Operators that need note/task body — currently only `has:link` — automatically force the body-aware path even when the toggle is off.

Multiple plain-text words are AND-combined: `meeting prep` requires both *meeting* and *prep* to appear in the searched fields.

To search for a phrase containing whitespace as a single substring, wrap operator values in quotes (`tag:"side projects"`). Plain-text quoting is not supported — `meeting prep` and `"meeting prep"` behave the same.

---

## Searching in trash

In re/notes the trash has its own view; switching to it makes `is:trashed` redundant but useful to combine with other operators (e.g. `is:trashed tag:work`).

In re/task the search box only scans active tasks — `is:trashed` will return zero results from the global search. To browse deleted tasks, use the trash view directly.

This is by design: searching across active and trashed items at the same time is rarely useful and would surface stale matches in everyday queries. Future versions may add an explicit "search in trash" mode.

---

## Graceful fallback

If the parser doesn't recognize a token (e.g. a typo like `taq:work` or an invalid date), it silently treats the whole token as plain text instead of failing. This is intentional — you can keep typing without ever seeing a red error state mid-query.

What this means in practice:

- `created:tomorrow` — there's no such keyword (we support `today` and `yesterday` only). The whole `created:tomorrow` becomes a plain-text search for the literal string `created:tomorrow`.
- `tag:` (no value) — falls back to plain text.
- Unknown operator names (`status:done`, `priority:high`, …) — treated as plain text. They may become real operators in a future Tier 2.

If a query "doesn't work as expected," the most common cause is a typo silently degrading to plain-text. Double-check the operator name and value format above.

---

## Privacy & architecture

All matching happens on your device:

1. Your encrypted database is decrypted in memory at unlock.
2. The search box parses your query into an **AST** (abstract syntax tree).
3. The AST is evaluated against an in-memory metadata index (titles, dates, tags, …).
4. If the query needs body content (`has:link` or the description/content toggle), only the candidate items are decrypted and re-evaluated.
5. Nothing is sent to the server.

There is no server-side search endpoint, no inverted index, and no query telemetry — the full Zero-Knowledge architecture is preserved. For the deep dive, see [Zero Knowledge Architecture](architecture/zero-knowledge-architecture.md).
