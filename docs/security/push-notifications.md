# Push Notifications - Zero Knowledge Design

This document describes the design of the server-assisted push notification pipeline shipped in Reborn Task in November 2026 (release v0.26.0). It covers what the user gets, what the server learns, what the server still cannot see, and how to opt out.

Push notifications are the single feature in Reborn Apps where the server is given a small, deliberate window into user metadata. Every other feature is fully Zero Knowledge. This document explains the trade-off in full so that users with elevated threat models can make an informed choice.

---

## Part 1: The feature in plain terms

### What the feature does

In **Reborn Task**, a due date can have a reminder attached - for example "remind me 15 minutes before". For the reminder to fire when the application is closed (phone in your pocket, screen locked, browser tab gone), our server needs to wake the device at the right moment. Without server assistance, reminders only fire while the application is open in a foreground tab, which is rarely what a productivity user actually wants.

When server-assisted notifications are enabled (the default), the application:

1. Computes locally when each reminder should fire.
2. Sends a list of `(task_id, fire_at)` pairs to our server over an authenticated HTTPS connection.
3. The server stores those pairs and, at the right moment, sends a generic "wake up" push to the device through the browser's push service (Apple Push, Firebase Cloud Messaging, Mozilla autopush, depending on the browser).
4. The device wakes the service worker, which reads the encrypted task from local IndexedDB, decrypts it with the master key already present on the device, and renders a notification with the real task title.

The reminder content (title, body) is never sent to the server. The server's job is purely to nudge the device at the right time.

### What the server learns

When server-assisted notifications are on, the server sees:

- **That a reminder exists** for a given task. The `task_id` is already plaintext on the server (it is the primary key used for synchronisation), so this is not new information.
- **When that reminder will fire**, rounded down to the nearest 5-minute mark. This is new information. The exact due-date timestamp remains encrypted in the task metadata; what the server sees is only the bucket of the reminder fire time.

If you set a reminder for "15 minutes before a task due at 14:03", the server sees a fire-time bucket of `13:45` (the floor of `13:48` to the next 5-minute mark). It does not see "14:03", it does not see the lead-time you chose, and it does not see the task title.

### What the server still cannot see

Even with server-assisted notifications on:

- **The task title, description, list, tags, completion state, starred flag** - all of these stay encrypted client-side and are never transmitted in plaintext. The push payload sent over the wire is a generic wake-up packet; the rendered notification content is built inside the browser's service worker after decrypting the local IndexedDB copy of the task.
- **The exact due date** - only the reminder fire time (a derived value) is shared, bucketed to 5 minutes.
- **Which task was reminded about**, if you choose to encrypt the push schedule identifier (advanced setups; see Part 2).

### Why the 5-minute bucket

Rounding the fire time to 5-minute buckets reduces what behavioural fingerprinting can extract from the schedule table. A precise minute-by-minute schedule would reveal routines down to the minute ("user always schedules something for 7:03 every weekday"); a 5-minute bucket reveals them only to the bucket ("user has reminders around 7:00-7:05 most weekdays"). Bucketing rounds **down** (floor), so a reminder is never delivered later than promised - only ever a few minutes earlier.

5 minutes was chosen as the sweet spot between privacy (coarser buckets leak less) and user experience (a "15 minutes before" reminder that arrives 30 minutes early is jarring). The bucket size is the only tunable in the leakage story; we picked the smallest value that still gives a meaningful reduction in fingerprintability.

### How to turn it off

The toggle is in **Settings -> Notifications -> Background notifications (server-assisted)**. It is enabled by default for new accounts.

Turning it off:

- The server stops receiving any reminder fire times. Past schedules for your account are deleted from the server immediately.
- Notifications continue to work, but only while the app is open in a foreground tab. When the app is closed or the tab is in the background, no reminder is delivered.
- Recommended for users with elevated threat models (journalists, researchers, dissidents) who prefer the strictest Zero Knowledge posture over the convenience of background delivery.

The setting is part of your synced account settings, so toggling it on one device flips it on every signed-in device automatically. When you turn it off, all pending server-side schedules across every device are dropped in the same transaction.

---

## Part 2: Technical details

This part describes the server contract, what is stored where, and the defence-in-depth boundaries. It is aimed at readers who want to audit the design or reason about the threat model precisely.

### Server contract

When the user has the background-delivery toggle on, the client maintains a server-side schedule via two endpoints:

- `POST /api/notifications/schedule` - replace the pending schedule for the account. Body: `{ endpoint, items: [{ task_id, fire_at }, ...] }`. The `endpoint` identifies the caller's push subscription and must belong to the authenticated user (rejected otherwise). The server then fans the items out across **every** active subscription registered for that user so the dispatcher can wake every signed-in device, not only the one that authored the change. Idempotent: in one transaction the server drops every row where `user_id = caller AND sent_at IS NULL` and re-inserts `items × subscriptions`.
- `DELETE /api/notifications/schedule` - cancel the schedule for a specific task across every subscription the user has. Body: `{ task_id }`. Used when a task is completed, deleted, or has its reminder removed.

Why fan-out per user instead of per subscription: the local task store is synced across devices, so every device computes the same `(task_id, fire_at)` set. If only the device that authored a change wrote schedule rows, a phone left in your pocket would never be woken. With per-user fan-out, any device that opens the application and runs a re-sync writes schedules covering every device.

The client recomputes the schedule from the local task store whenever the task store changes, on `visibilitychange`, and on a 15-minute interval. The horizon is 7 days; reminders further than 7 days out are scheduled later, when they enter the window.

### What is stored on the server

A single table backs the feature:

```
PushSchedule {
  id              UUID PRIMARY KEY
  user_id         UUID NOT NULL  -- FK to User
  subscription_id UUID NOT NULL  -- FK to UserWebPushSubscription
  task_id         UUID NOT NULL  -- FK to Task (plaintext, already exists)
  fire_at         TIMESTAMPTZ NOT NULL  -- bucketed to 5-min marks client-side
  sent_at         TIMESTAMPTZ           -- nullable; set when push is dispatched
  failed_at       TIMESTAMPTZ           -- nullable; set on dispatch failure
  failure_count   INT NOT NULL DEFAULT 0
  created_at      TIMESTAMPTZ NOT NULL
}
```

Note the absence of any encrypted-content column. There is no `payload_encrypted`, no title hash, no lead-time field. The server has the minimum information needed to wake the device at the right moment and nothing else.

Pending rows (`sent_at IS NULL`) are hard-deleted when the toggle is turned off. Sent rows are retained for 7 days for delivery diagnostics and then hard-deleted.

For users with multiple signed-in devices, each scheduled reminder is materialised once per active push subscription (so a user with three devices, two pending reminders, will have six rows). The total leakage is unchanged - the server already knows how many active subscriptions you have from the `UserWebPushSubscription` table - but the row count in `PushSchedule` scales with `devices × pending_reminders`.

### Dispatch path

A scheduler process (held in-process for now, guarded by a Postgres advisory lock so multi-instance deployments never duplicate sends) scans `WHERE sent_at IS NULL AND fire_at <= now()` every 5 minutes, aligned to wall-clock 5-minute boundaries (xx:00, xx:05, xx:10 ...). For each due row it calls `webpush.sendNotification(subscription, JSON.stringify({ type: 'task_reminder', task_id }))`.

Wall-clock alignment matters because it locks down the delivery window. The client floors each `fire_at` down to the previous 5-minute mark before sending; the cron then dispatches at that same wall-clock mark with only the small jitter of scan + dispatch. Net result: a reminder configured for 14:48 (15 minutes before a 15:03 deadline) is bucketed to 14:45 and dispatched around 14:45 - up to 3 minutes earlier than the user's intended fire time, never later. Without the wall-clock alignment, a phase-shifted 5-minute interval could just as easily fire the same reminder at 14:49 (a minute late), which is exactly what we want to rule out for a productivity tool.

The dispatched push payload is encrypted by the `web-push` library using the subscription's `p256dh` key before it leaves our server. The browser's push service (FCM / Apple Push / Mozilla autopush) sees only opaque ciphertext. Even so, **our server briefly sees the cleartext payload** while building it - which is why that payload contains only the type tag and the task id, both already plaintext on the server. No new information is leaked at this layer.

### Service-worker side

The service worker's `push` event handler:

1. Decodes the payload `{ type, task_id }`.
2. Opens the task IndexedDB for the user.
3. Loads the master key if the account is unlocked; renders the real notification (title, body) after decrypting the local task copy.
4. If the account is locked (no master key in memory), falls back to a generic notification: "You have a task scheduled for now - tap to open." Tapping opens the unlock screen.

The encrypted local task store is the only place the title is decrypted. The cleartext title never leaves the device.

### Threat model summary

| Adversary capability | Result |
|---|---|
| Server compromise (database dump) | Attacker learns reminder fire times bucketed to 5 minutes, plus the existing plaintext `(task_id, user_id, updated_at)` triples. Attacker does **not** learn task titles, bodies, descriptions, list names, tag associations, completion state, starred state, or any non-reminder behavioural metadata. |
| Push service compromise (FCM / Apple Push / Mozilla autopush) | The push service sees ciphertext payloads (encrypted by `web-push` with the subscription's p256dh key). It learns only that a wake-up was sent to a device at a particular time. |
| Network observer (TLS-terminated) | Sees TLS-encrypted traffic. The HTTPS connection to our server is end-to-end at the TLS layer; nothing in the push pipeline weakens it. |
| User with elevated threat model | Turn the toggle off. The setting is account-wide (synced across devices), so flipping it on any device clears the server-side schedule for every device in the same transaction. The `PushSchedule` table holds no pending rows for the account, and no reminder timing data is sent to the server until the toggle is re-enabled. |

### What this trades, and why

This is the single feature in Reborn Apps where the server learns metadata that it does not strictly need for synchronisation. Every other feature is designed so that the server is a "dumb store" of ciphertext; here we deliberately admit a small leak (reminder fire times, 5-minute precision) in exchange for the ability to wake a device when the application is closed.

Three options were considered before settling on this design:

1. **Local-only delivery** (status quo before v0.26.0). Strictest Zero Knowledge, but reminders only fire while the app is in foreground. Most users perceived this as the feature being broken.
2. **Server stores encrypted push payloads** including title/body. Eliminates `task_id <-> fire_at` correlation but still leaks `fire_at`, costs more bandwidth (re-upload per title change), and the dominant leak (`fire_at`) is unchanged. Not selected.
3. **Server learns task title in plaintext to compose the push payload.** Trivial to implement but breaks the cardinal Zero Knowledge rule. Rejected outright.

The chosen design (server learns only `(task_id, fire_at)`, with `fire_at` bucketed to 5 minutes, behind an opt-in-by-default toggle) is the smallest deviation from full Zero Knowledge that still solves the user-facing problem. The bucket size, the toggle default, and the table retention policy are the three knobs that can be re-tuned in future without changing the architecture.

---

## Further reading

- [Security Overview](security-overview.md) - posture, primitives, and full table of known limitations
- [Zero Knowledge Architecture](../architecture/zero-knowledge-architecture.md) - end-to-end encryption model
- [Read-only Snapshot Sharing](read-only-snapshot-sharing.md) - companion design doc for the share-link feature
