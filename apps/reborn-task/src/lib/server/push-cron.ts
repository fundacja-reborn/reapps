/**
 * Server-side push delivery cron.
 *
 * Periodically scans `PushSchedule` for due rows and sends a generic wake-up
 * push (`{type:'task_reminder', task_id}`) via web-push. The SW receives the
 * push, opens local IndexedDB, decrypts the task with the in-memory master
 * key, and shows the real notification. The server NEVER sees the task title
 * or body - only `task_id` and a bucketed (5-min) `fire_at` value.
 *
 * Concurrency / multi-instance safety: every tick takes a Postgres advisory
 * lock (`pg_try_advisory_lock(LOCK_ID)`). Only the instance that grabs the
 * lock runs the scan; the rest no-op. The lock is released at the end of the
 * tick so any single instance can take it next time - no leader election, no
 * external coordinator. Picked over a dedicated worker per D1 decision
 * (2026-05-26).
 *
 * Lifecycle: started lazily on module import from hooks.server.ts. Each tick
 * uses setTimeout aligned to the next wall-clock 5-min boundary, re-scheduling
 * after the tick completes (see `scheduleNextTick`). That keeps the Node event
 * loop alive; that is intentional - the cron is part of the server's normal
 * operation, not a one-shot job.
 */

import webpush from 'web-push';
import { env } from '$env/dynamic/private';
import { createLogger } from '@reborn/utils';
import { prisma } from '@reborn/database';

const logger = createLogger('PushCron');

// Random-ish but constant so all instances share the same lock. Two int32 args
// give a much wider namespace than a single bigint, and this exact pair is
// reserved across the codebase only for this cron.
const ADVISORY_LOCK_CLASSID = 0x52455042; // 'REPB'
const ADVISORY_LOCK_OBJID = 0x50534348; // 'PSCH'

/**
 * How often we wake up to check for due schedules.
 *
 * Matched to the client-side bucket size (`SERVER_SCHEDULE_BUCKET_MS = 5 min`
 * in push-notification.service.ts). The cron also aligns its ticks to wall
 * clock so they fire at xx:00, xx:05, xx:10 ... instead of being phase-shifted
 * by the process boot time. With aligned 5-min ticks, a notification scheduled
 * at bucketed `fire_at = T` is delivered between T and T+small-jitter (just
 * the time taken to scan + dispatch) - never up to 5 min late as it would be
 * with an unaligned 5-min interval. End-to-end delivery window is therefore
 * "0 to ~5 min earlier than the user's intended reminder", never later.
 */
const TICK_MS = 5 * 60_000;

/** Maximum push attempts per schedule row before we give up. */
const MAX_FAILURE_COUNT = 3;

/** Maximum number of due rows we process per tick (bounds tail latency). */
const BATCH_SIZE = 200;

let started = false;
let tickTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
let vapidConfigured = false;

function configureVapid(): boolean {
	if (vapidConfigured) return true;
	const publicKey = env.VAPID_PUBLIC_KEY;
	const privateKey = env.VAPID_PRIVATE_KEY;
	const subject = env.VAPID_SUBJECT ?? 'mailto:noreply@reapps.eu';

	if (
		!publicKey ||
		!privateKey ||
		publicKey === 'your-vapid-public-key' ||
		privateKey === 'your-vapid-private-key'
	) {
		return false;
	}

	try {
		webpush.setVapidDetails(subject, publicKey, privateKey);
		vapidConfigured = true;
		return true;
	} catch (error) {
		logger.error('Failed to configure VAPID:', error);
		return false;
	}
}

interface DueRow {
	id: string;
	subscription_id: string;
	task_id: string;
	failure_count: number;
	endpoint: string;
	keys_encrypted: string;
}

async function fetchDueRows(): Promise<DueRow[]> {
	// Inline join to avoid n+1. We only need endpoint + keys for the push call.
	return prisma.$queryRaw<DueRow[]>`
		SELECT
			ps.id,
			ps.subscription_id,
			ps.task_id,
			ps.failure_count,
			s.endpoint,
			s.keys_encrypted
		FROM "PushSchedule" ps
		INNER JOIN "UserWebPushSubscription" s ON s.id = ps.subscription_id
		WHERE ps.sent_at IS NULL
			AND ps.fire_at <= NOW()
			AND ps.failure_count < ${MAX_FAILURE_COUNT}
			AND s.is_active = true
		ORDER BY ps.fire_at ASC
		LIMIT ${BATCH_SIZE}
	`;
}

async function deliverOne(row: DueRow): Promise<void> {
	let keys: { p256dh?: string; auth?: string };
	try {
		keys = JSON.parse(row.keys_encrypted) as { p256dh?: string; auth?: string };
	} catch {
		logger.error('Invalid keys_encrypted JSON, marking failed:', { id: row.id });
		await prisma.pushSchedule.update({
			where: { id: row.id },
			data: { failed_at: new Date(), failure_count: { increment: 1 } }
		});
		return;
	}

	if (!keys.p256dh || !keys.auth) {
		await prisma.pushSchedule.update({
			where: { id: row.id },
			data: { failed_at: new Date(), failure_count: { increment: 1 } }
		});
		return;
	}

	const payload = JSON.stringify({ type: 'task_reminder', task_id: row.task_id });

	try {
		await webpush.sendNotification(
			{
				endpoint: row.endpoint,
				keys: { p256dh: keys.p256dh, auth: keys.auth }
			},
			payload,
			{ TTL: 24 * 60 * 60 }
		);
		await prisma.pushSchedule.update({
			where: { id: row.id },
			data: { sent_at: new Date() }
		});
	} catch (error: unknown) {
		const status =
			typeof error === 'object' && error !== null && 'statusCode' in error
				? (error as { statusCode: number }).statusCode
				: undefined;

		if (status === 404 || status === 410) {
			// Push service permanently rejected the subscription - deactivate it
			// and mark all of its pending schedules as failed so we stop retrying.
			logger.warn('Subscription expired/gone, deactivating:', {
				subscription_id: row.subscription_id,
				status
			});
			await prisma.$transaction([
				prisma.userWebPushSubscription.update({
					where: { id: row.subscription_id },
					data: { is_active: false }
				}),
				prisma.pushSchedule.updateMany({
					where: { subscription_id: row.subscription_id, sent_at: null },
					data: { failed_at: new Date(), failure_count: MAX_FAILURE_COUNT }
				})
			]);
		} else {
			logger.error('web-push send failed:', { id: row.id, status, error });
			await prisma.pushSchedule.update({
				where: { id: row.id },
				data: { failed_at: new Date(), failure_count: { increment: 1 } }
			});
		}
	}
}

async function runTick(): Promise<void> {
	if (!configureVapid()) return;

	// Postgres advisory locks need a single connection for the lock to be held.
	// $queryRaw uses a pool connection per query, so try-lock + release in the
	// same statement to keep things simple. If another instance holds it we skip
	// this tick - the next instance picks up due rows at its own cadence.
	const lockResult = await prisma.$queryRaw<{ pg_try_advisory_lock: boolean }[]>`
		SELECT pg_try_advisory_lock(${ADVISORY_LOCK_CLASSID}::int, ${ADVISORY_LOCK_OBJID}::int)
	`;
	const acquired = lockResult[0]?.pg_try_advisory_lock === true;
	if (!acquired) return;

	try {
		const rows = await fetchDueRows();
		if (rows.length === 0) return;

		logger.info(`Delivering ${rows.length} due push notifications`);
		// Sequential delivery: web-push is I/O bound but bounded batch + per-row
		// error handling is simpler than chasing concurrency bugs. Tail latency
		// stays under TICK_MS for realistic batch sizes.
		for (const row of rows) {
			try {
				await deliverOne(row);
			} catch (error) {
				logger.error('Unhandled delivery error:', { id: row.id, error });
			}
		}
	} finally {
		await prisma.$queryRaw`
			SELECT pg_advisory_unlock(${ADVISORY_LOCK_CLASSID}::int, ${ADVISORY_LOCK_OBJID}::int)
		`.catch(() => {
			/* best-effort unlock - if connection died Postgres releases it for us */
		});
	}
}

/**
 * Schedule the next tick aligned to the wall-clock 5-min boundary.
 *
 * `Math.ceil(now / TICK_MS) * TICK_MS` picks the next multiple of TICK_MS in
 * the epoch timeline; because TICK_MS = 300_000 ms divides evenly into the day,
 * the boundary lands on wall-clock xx:00, xx:05, xx:10 ... regardless of the
 * server's timezone. Re-scheduling after each tick (rather than `setInterval`)
 * lets the alignment self-correct if a tick runs long; without this, a single
 * slow tick would phase-shift every subsequent one.
 */
function scheduleNextTick(): void {
	if (!started) return;
	const now = Date.now();
	const nextTickAt = Math.ceil(now / TICK_MS) * TICK_MS;
	const delayMs = nextTickAt - now;
	tickTimeoutHandle = setTimeout(async () => {
		try {
			await runTick();
		} catch (error) {
			logger.error('Push cron tick threw:', error);
		}
		scheduleNextTick();
	}, delayMs);
}

/** Idempotent start - safe to call multiple times (HMR, test setup). */
export function startPushCron(): void {
	if (started) return;
	started = true;

	// Only schedule the tick chain if VAPID is configured to avoid spinning
	// up a no-op cron on dev environments where VAPID is left at the placeholder.
	if (!configureVapid()) {
		logger.info('VAPID not configured - push cron disabled');
		return;
	}

	logger.info(`Push cron started (wall-clock aligned, tick every ${TICK_MS / 1000}s)`);
	scheduleNextTick();
}

/** For tests - clears the pending tick. */
export function stopPushCron(): void {
	if (tickTimeoutHandle !== null) {
		clearTimeout(tickTimeoutHandle);
		tickTimeoutHandle = null;
	}
	started = false;
}
