import { describe, it, expect } from 'vitest';
import {
	MAX_PLANNED_REMINDERS,
	planTaskReminders,
	reminderIdForTask,
	type PlannableTask
} from './native-reminders';
import { formatReminderBody, type TranslateFn } from './reminder-schedule';

/**
 * The native shells plan task reminders on the device (`native-reminders.ts`).
 * Under vitest `__REBORN_NATIVE__` is false, so only the pure planner runs
 * here; the plugin calls are smoke-tested on the phones.
 */

const opts = { leadMinutes: 60, allDayTime: '09:00' };
const NOW = Date.parse('2026-11-28T10:00:00.000Z');
const HOUR = 60 * 60 * 1000;

function task(over: Partial<PlannableTask> & { id: string }): PlannableTask {
	return {
		title: `Task ${over.id}`,
		due_date: null,
		has_time: true,
		is_completed: false,
		is_template: false,
		deleted_at: null,
		...over
	};
}

const describeBody = (t: PlannableTask) => `body ${t.id}`;

describe('planTaskReminders', () => {
	it('plans open, dated, future tasks soonest first', () => {
		const tasks = [
			task({ id: 'b', due_date: new Date(NOW + 5 * HOUR).toISOString() }),
			task({ id: 'a', due_date: new Date(NOW + 3 * HOUR).toISOString() })
		];
		const plan = planTaskReminders(tasks, opts, NOW, describeBody);
		expect(plan.map((r) => r.taskId)).toEqual(['a', 'b']);
		// leadMinutes before the due time
		expect(plan[0].at).toBe(NOW + 2 * HOUR);
		expect(plan[0]).toMatchObject({ title: 'Task a', body: 'body a' });
	});

	it('skips completed, deleted, template, undated and past reminders', () => {
		const soon = new Date(NOW + 3 * HOUR).toISOString();
		const tasks = [
			task({ id: 'done', due_date: soon, is_completed: true }),
			task({ id: 'trash', due_date: soon, deleted_at: '2026-11-27T00:00:00.000Z' }),
			task({ id: 'template', due_date: soon, is_template: true }),
			task({ id: 'nodate' }),
			// due in 30 min with a 60 min lead: the reminder time has passed
			task({ id: 'passed', due_date: new Date(NOW + 30 * 60 * 1000).toISOString() }),
			task({ id: 'bad', due_date: 'not a date' }),
			task({ id: 'ok', due_date: soon })
		];
		expect(planTaskReminders(tasks, opts, NOW, describeBody).map((r) => r.taskId)).toEqual(['ok']);
	});

	it('keeps only the nearest MAX_PLANNED_REMINDERS (iOS allows 64 pending)', () => {
		const tasks = Array.from({ length: 80 }, (_, i) =>
			task({
				id: `t${String(i).padStart(2, '0')}`,
				due_date: new Date(NOW + (80 - i) * HOUR).toISOString()
			})
		);
		const plan = planTaskReminders(tasks, opts, NOW, describeBody);
		expect(plan).toHaveLength(MAX_PLANNED_REMINDERS);
		// the soonest is the last task created (due in 1 h + lead -> skipped as past),
		// so the window starts with the one due in 2 h
		expect(plan[0].taskId).toBe('t78');
		expect(plan.every((r, i) => i === 0 || r.at >= plan[i - 1].at)).toBe(true);
	});

	it('plans a date-only task on its calendar day at the all-day time', () => {
		const plan = planTaskReminders(
			[task({ id: 'd', due_date: '2026-12-03T00:00:00.000Z', has_time: false })],
			opts,
			NOW,
			describeBody
		);
		expect(plan[0].at).toBe(new Date(2026, 11, 3, 9, 0, 0, 0).getTime());
	});

	it('gives every reminder its own id, stable for the task', () => {
		const tasks = Array.from({ length: 50 }, (_, i) =>
			task({ id: crypto.randomUUID(), due_date: new Date(NOW + (i + 2) * HOUR).toISOString() })
		);
		const first = planTaskReminders(tasks, opts, NOW, describeBody);
		const again = planTaskReminders([...tasks].reverse(), opts, NOW, describeBody);
		expect(new Set(first.map((r) => r.id)).size).toBe(first.length);
		expect(again.map((r) => [r.taskId, r.id])).toEqual(first.map((r) => [r.taskId, r.id]));
	});

	it('passes the fire time to the body builder', () => {
		const seen: number[] = [];
		planTaskReminders(
			[task({ id: 'x', due_date: new Date(NOW + 4 * HOUR).toISOString() })],
			opts,
			NOW,
			(_t, fireAt) => {
				seen.push(fireAt);
				return '';
			}
		);
		expect(seen).toEqual([NOW + 3 * HOUR]);
	});
});

describe('reminderIdForTask', () => {
	it('is a positive 31-bit int above the test notification id, the same for the same task', () => {
		const id = reminderIdForTask('0d3b6c1e-8f7a-4f00-9d3c-5f1a2b3c4d5e');
		expect(Number.isInteger(id)).toBe(true);
		expect(id).toBeGreaterThan(1);
		expect(id).toBeLessThanOrEqual(0x7fffffff);
		expect(reminderIdForTask('0d3b6c1e-8f7a-4f00-9d3c-5f1a2b3c4d5e')).toBe(id);
		expect(reminderIdForTask('0d3b6c1e-8f7a-4f00-9d3c-5f1a2b3c4d5f')).not.toBe(id);
	});
});

describe('formatReminderBody with a reading day', () => {
	const translate: TranslateFn = (key, options) =>
		options?.values ? `${key}:${Object.values(options.values).join(',')}` : key;

	it('says "today" when the reminder fires on the due day, planned days ahead', () => {
		const due = { due_date: '2026-12-03T00:00:00.000Z', has_time: false };
		const fireDay = new Date(2026, 11, 3, 9, 0);
		expect(formatReminderBody(due, translate, 'en', '24h', fireDay)).toBe(
			'notifications.task_due.body_today'
		);
		const dayBefore = new Date(2026, 11, 2, 9, 0);
		expect(formatReminderBody(due, translate, 'en', '24h', dayBefore)).toMatch(
			/^notifications\.task_due\.body_date:/
		);
	});
});
