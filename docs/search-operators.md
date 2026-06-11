# Search operators

Both **re/task** and **re/notes** ship a unified search box that combines plain-text search with structured operators. Type a few words for substring search; add operators to filter by tag, folder, list, dates, flags, and more.

All search runs **client-side** over already-decrypted data - the server never sees your query. Operators are therefore privacy-neutral: they don't add a new attack surface compared to plain-text search.

---

## Quick reference

| Operator | Where | Examples |
|---|---|---|
| `tag:NAME` | re/notes | `tag:work`, `tag:"side projects"` |
| `folder:PATH` | re/notes | `folder:projects`, `folder:projects/active` - matches the folder **and all its subfolders** (same as searching inside a folder view) |
| `list:NAME` | re/task | `list:Inbox`, `list:"this week"` |
| `created:DATE` | both | `created:2026-01-01`, `created:>2026-01-01`, `created:<7d`, `created:today`, `created:2026-01-01..2026-02-01` |
| `modified:DATE` | both | `modified:<14d`, `modified:yesterday` |
| `due:DATE` | re/task | `due:<7d`, `due:today`, `due:>2026-06-01` |
| `is:starred` | both | `is:starred` |
| `is:pinned` | re/notes | `is:pinned` |
| `is:completed` | re/task | `is:completed` |
| `is:overdue` | re/task | `is:overdue` |
| `has:link` | both | `has:link` (matches notes/descriptions containing URLs or Markdown links) |

**Modifiers**

- `-OPERATOR` - negate the operator. Example: `-tag:archived` (exclude tag), `-is:completed` (only incomplete).
- `-WORD` - exclude items whose title (or body, in the description/content path) contains *WORD*. Example: `cat -mouse` matches items mentioning *cat* but never *mouse*.
- `"quoted value"` - preserve whitespace and colons. Inside an operator: `tag:"in progress"`, `list:"Q2 planning"`. As plain text: `"meeting prep"` matches the literal phrase including whitespace, instead of *meeting* AND *prep* independently.
- `-"quoted value"` - exclude a phrase. Example: `cat -"angry mouse"`.

**Combining**

By default everything is AND-combined: operators with each other, operators with plain-text words, and excludes too - every clause must hold simultaneously. Example:

```
meeting tag:work -is:completed modified:<14d -draft
```

…matches items containing the word *meeting*, tagged `work`, not yet completed, modified within the last 14 days, and not containing *draft*.

To express "either / or" relationships, use the `OR` operator described below.

---

## Boolean operators

Beyond the implicit AND, the search box supports explicit `OR`, parenthesized groups, and group negation. Explicit `AND` is also recognized as a redundant synonym for the implicit AND.

### `OR` - alternatives

```
cat OR mouse                    # title or body contains "cat" OR "mouse"
tag:work OR tag:personal        # either tag matches
is:completed OR is:overdue      # finished or past due
```

`OR` must be **uppercase** with surrounding whitespace. Lowercase `or` is treated as a plain text word - same convention as Gmail, GitHub, and Linear. To search for the literal substring `OR`, quote it: `"OR"`.

**Precedence - AND binds tighter than OR.** That mirrors how the operator behaves in mainstream search boxes:

```
cat dog OR mouse                # = (cat AND dog) OR mouse
```

When in doubt, parenthesize.

### `AND` - explicit (and redundant)

A space between two clauses already means AND, so `cat dog` and `cat AND dog` produce the same results. The explicit form exists for symmetry with `OR` - useful inside groups where the boolean intent is clearer when written out:

```
(cat AND dog) OR mouse          # equivalent to (cat dog) OR mouse
tag:work AND -is:completed      # equivalent to tag:work -is:completed
```

`AND` must be **uppercase** with surrounding whitespace, exactly like `OR`. Lowercase `and` and the quoted form `"AND"` are treated as the plain text word `and`. AND has the same precedence as the implicit space - i.e. tighter than OR - so `cat AND dog OR mouse` parses as `(cat AND dog) OR mouse`.

### Grouping with `(...)`

Parentheses override precedence and let you compose richer queries:

```
tag:work (is:starred OR modified:<7d)         # work items, either starred OR recently touched
(cat OR dog) -tag:archived                    # mentions cat or dog, not archived
(tag:reading AND has:link) OR is:starred      # reading items with a link, or anything starred
```

Empty groups `()` are ignored. Redundant nesting like `((cat))` collapses naturally.

### Negating a group with `-(...)`

A leading `-` before a group negates the entire group:

```
-(tag:archived OR tag:draft)    # neither archived nor draft
tag:work -(is:completed AND -has:link)  # active work tasks that have either an
                                        # incomplete state or a linked reference
```

This is distinct from leaf-level negation (`-tag:archived`, `-mouse`), which negates a single operator or word.

### Quoted boolean tokens

Quotes always preserve characters literally - `OR`, `AND`, `(`, and `)` inside quotes are treated as part of the value, not as boolean syntax:

```
"cat OR dog"     # plain phrase including the literal text "OR"
"cat AND dog"    # plain phrase including the literal text "AND"
tag:"or another" # tag value containing the substring "or another"
"(test)"         # plain phrase, parens are part of the title to search for
```

### Graceful fallback

If the parser hits a structural problem (an unmatched parenthesis, a dangling `OR` or `AND`), the whole query degrades to a flat plain-text parse - the offending characters become literal substring tokens. You'll never see a red error state mid-typing; the search just becomes less specific until the syntax is balanced again. Examples:

- `(cat OR ` - unmatched `(`. Searches for items literally containing `(`, `cat`, and `or`.
- `cat OR` - trailing `OR`. Searches for items literally containing `cat` and `or`.
- `cat AND` - trailing `AND`. Searches for items literally containing `cat` and `and`.

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

Format is always `YYYY-MM-DD`. Invalid dates (e.g. `2026-02-30`) silently fall back to plain-text search instead of erroring - you can keep typing without seeing red squiggles.

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

Dates are interpreted in your **local timezone**, not UTC - "today" matches your wall clock.

---

## Plain-text and the description/content toggle

Plain-text words (anything that's not an operator) match by substring against:

- **Titles** - always, instantly, no decryption.
- **Descriptions** (re/task) / **content** (re/notes) - only when the *Search in description / content* toggle is on. Decryption happens in-memory; the server never sees the query.

Operators that need note/task body - currently only `has:link` - automatically force the body-aware path even when the toggle is off.

Multiple plain-text words are AND-combined: `meeting prep` requires both *meeting* and *prep* to appear independently in the searched fields. To require the literal phrase including whitespace, wrap it in quotes: `"meeting prep"` matches only items where the two words appear next to each other in that order.

To exclude a substring, prefix it with `-`: `cat -mouse` keeps items mentioning *cat* and drops any that also mention *mouse*. Excludes work on phrases too: `cat -"angry mouse"`.

Quoting also works inside operator values: `tag:"side projects"`, `list:"Q2 planning"`.

---

## Saved searches (smart folders)

> **re/notes** (re/task follow-up planned)

Any query you can type, you can save as a named view. With a query in the search box, click **Save search** (next to the *Search in content* toggle), give it a name, and it appears in the search panel - open search with an empty box to see your saved views. Clicking one puts its query back into the search box **and restores the *Search in content* toggle** to the state it was saved with, so the view reproduces the exact result set - always **live**: a saved search is a stored query, not a snapshot.

Saving works from any view, not just the search panel. When you save while browsing a folder, a tag, or starred notes, the view's scope is composed into the query as a regular operator (`folder:"…"`, `tag:"…"`, `is:starred`) - the dialog previews the exact query being saved, so the saved view returns precisely what you were looking at. When saving from a folder, the dialog also offers to **pin the new view to that folder** right away. (The trash view has no save button: trash is a separate bucket with no query operator.)

Saved searches can also be **pinned to a folder** (context menu → *Pin to folder*). A pinned search shows up inside the folder tree as a leaf node - a "smart folder" sitting next to your real folders. Example: pin `folder:projects tag:urgent` to the *Projects* folder as **Urgent projects**. Pinning is purely presentational; it does not scope the query. Deleting a folder never deletes the searches pinned to it - they just unpin back to the search panel.

Renaming, re-pinning, and deleting are available from each saved search's context menu (deleting a saved view never touches your notes). Saved searches sync across your devices like folders and tags do.

Privacy note: the name, the query string, and the behavioral metadata (the content-toggle state) are end-to-end encrypted (`name_encrypted`, `query_encrypted`, `metadata_encrypted`). The server cannot see which operators, tags, or phrases your saved views filter by - nor which of them scan note bodies - it only stores opaque ciphertexts, and all evaluation happens on your device through the same parser as live search.

---

## Searching in trash

Both apps have a dedicated trash view, and the search box always scans the current bucket only - active items in normal views, trashed items in the trash view. There is no operator to mix the two; to browse deleted items, switch to the trash view directly. Search there works with all the operators above (tag, folder, list, dates, …) over the trashed set.

This is by design: cross-bucket search is rarely useful and would surface stale matches in everyday queries. A future version may introduce an explicit unified search mode.

---

## Graceful fallback

If the parser doesn't recognize a token (e.g. a typo like `taq:work` or an invalid date), it silently treats the whole token as plain text instead of failing. This is intentional - you can keep typing without ever seeing a red error state mid-query.

What this means in practice:

- `created:tomorrow` - there's no such keyword (we support `today` and `yesterday` only). The whole `created:tomorrow` becomes a plain-text search for the literal string `created:tomorrow`.
- `tag:` (no value) - falls back to plain text.
- Unknown operator names (`status:done`, `priority:high`, …) - treated as plain text. They may become real operators in a future Tier 2.

If a query "doesn't work as expected," the most common cause is a typo silently degrading to plain-text. Double-check the operator name and value format above.

---

## Privacy & architecture

All matching happens on your device:

1. Your encrypted database is decrypted in memory at unlock.
2. The search box parses your query into an **AST** (abstract syntax tree).
3. The AST is evaluated against an in-memory metadata index (titles, dates, tags, …).
4. If the query needs body content (`has:link` or the description/content toggle), only the candidate items are decrypted and re-evaluated.
5. Nothing is sent to the server.

There is no server-side search endpoint, no inverted index, and no query telemetry - the full Zero-Knowledge architecture is preserved. For the deep dive, see [Zero Knowledge Architecture](architecture/zero-knowledge-architecture.md).

---

## Acknowledgments

The operator vocabulary and tier-based rollout (essentials first, power-user features as fast-follows) were shaped by detailed feedback from [Travis Solin (@computrav)](https://github.com/computrav). See the project [Acknowledgments](../README.md#acknowledgments) for the full list of people who've helped shape Reborn Apps.
