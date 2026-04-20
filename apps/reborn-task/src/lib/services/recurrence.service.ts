import { rrulestr } from 'rrule';
import { taskStore, taskQueries } from '@reborn/storage';
import { cryptoManager } from '@reborn/crypto';
import { createLogger } from '@reborn/utils';
import type { TaskDecrypted, TaskEncryptedBooleans, TaskSensitiveMetadata } from '@reborn/types';
import { taskOperationsService } from './task-operations.service';
import { get } from 'svelte/store';
import { user } from '$lib/stores/auth.store';

const logger = createLogger('RecurrenceService');

/**
 * localStorage key used to track whether the one-time migration from
 * multi-instance to single-instance model has already been performed.
 */
const MIGRATION_KEY = 'recurrence_single_instance_migrated';

export class RecurrenceService {
	/**
	 * Check interval in milliseconds (5 minutes)
	 */
	private readonly CHECK_INTERVAL = 5 * 60 * 1000;

	/**
	 * Interval timer reference
	 */
	private intervalId?: number;

	/**
	 * Start the recurrence service
	 */
	start() {
		logger.info('Starting recurrence service');

		// Run one-time migration then check for missing instances
		this.migrateToSingleInstance()
			.then(() => this.checkAndGenerateInstances())
			.catch((error) => logger.error('Startup migration/generation failed', error));

		// Set up periodic checks
		this.intervalId = window.setInterval(() => {
			this.checkAndGenerateInstances();
		}, this.CHECK_INTERVAL);
	}

	/**
	 * Stop the recurrence service
	 */
	stop() {
		if (this.intervalId) {
			window.clearInterval(this.intervalId);
			this.intervalId = undefined;
		}
		logger.info('Recurrence service stopped');
	}

	// ---------------------------------------------------------------------------
	//  Metadata helper
	// ---------------------------------------------------------------------------

	/**
	 * Decrypt TaskSensitiveMetadata from a task's metadata_encrypted field.
	 * Returns partial defaults on failure.
	 */
	private async decryptMeta(
		task: TaskEncryptedBooleans
	): Promise<Partial<TaskSensitiveMetadata>> {
		try {
			if (task.metadata_encrypted) {
				return await cryptoManager.decryptObject<TaskSensitiveMetadata>(
					task.metadata_encrypted
				);
			}
		} catch {
			logger.warn(`Failed to decrypt metadata for task ${task.id}`);
		}
		return {};
	}

	// ---------------------------------------------------------------------------
	//  One-time migration: multi-instance → single-instance
	// ---------------------------------------------------------------------------

	/**
	 * For each template keep only the earliest active (non-completed, non-deleted)
	 * instance and soft-delete all later active instances.
	 * Runs once per browser – guarded by localStorage flag.
	 */
	private async migrateToSingleInstance() {
		if (localStorage.getItem(MIGRATION_KEY)) return;

		try {
			logger.info('Running one-time single-instance migration');
			const templates = await taskQueries.templates();

			for (const template of templates) {
				if (!template.recurrence_rule_encrypted || template.deleted_at) continue;

				const instances = await taskQueries.instancesOfTemplate(template.id);
				const active = instances
					.filter((i) => !i.is_completed && !i.deleted_at)
					.sort((a, b) => {
						if (!a.due_date) return 1;
						if (!b.due_date) return -1;
						return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
					});

				// Keep the first (earliest) active instance, delete the rest
				for (let i = 1; i < active.length; i++) {
					await taskOperationsService.deleteTask(active[i].id);
					logger.info('Migration: deleted surplus instance', {
						templateId: template.id,
						instanceId: active[i].id,
						dueDate: active[i].due_date
					});
				}
			}

			localStorage.setItem(MIGRATION_KEY, new Date().toISOString());
			logger.info('Single-instance migration completed');
		} catch (error: unknown) {
			logger.error('Single-instance migration failed', error);
			// Don't set flag — will retry next start
		}
	}

	// ---------------------------------------------------------------------------
	//  Core: check all templates and ensure each has exactly 0 or 1 active instance
	// ---------------------------------------------------------------------------

	/**
	 * For every active template, ensure there is exactly one active instance.
	 * If an active instance already exists → skip.
	 * If none exists → compute next occurrence date and create one instance.
	 */
	async checkAndGenerateInstances() {
		try {
			logger.info('Checking recurring templates (single-instance model)');

			const templates = await taskQueries.templates();

			for (const template of templates) {
				if (!template.recurrence_rule_encrypted || template.deleted_at) continue;

				try {
					await this.generateNextInstanceIfNeeded(template);
				} catch (error: unknown) {
					logger.error('Failed to process template', {
						templateId: template.id,
						error
					});
				}
			}

			const { taskCounts } = await import('$lib/stores/task-counts.store');
			await taskCounts.refresh();
		} catch (error: unknown) {
			logger.error('Failed to check and generate instances', error);
		}
	}

	/**
	 * Public entry-point to generate the next instance for a single template
	 * (called after completion / skip / rule change).
	 */
	async generateNextInstanceForTemplate(templateId: string) {
		const template = await taskStore.get(templateId);
		if (!template || !template.recurrence_rule_encrypted || template.deleted_at) return;
		await this.generateNextInstanceIfNeeded(template);

		const { taskCounts } = await import('$lib/stores/task-counts.store');
		await taskCounts.refresh();
	}

	// ---------------------------------------------------------------------------
	//  Single-instance generation
	// ---------------------------------------------------------------------------

	/**
	 * Ensure exactly one active instance exists for a template.
	 * - If an active (non-completed, non-deleted) instance exists → do nothing.
	 * - Otherwise compute the next occurrence date and create one instance.
	 */
	private async generateNextInstanceIfNeeded(template: TaskEncryptedBooleans) {
		const instances = await taskQueries.instancesOfTemplate(template.id);
		const hasActiveInstance = instances.some((i) => !i.is_completed && !i.deleted_at);

		if (hasActiveInstance) {
			logger.debug('Template already has an active instance, skipping', {
				templateId: template.id
			});
			return;
		}

		// Decrypt RRULE
		const rruleString = await cryptoManager.decryptText(template.recurrence_rule_encrypted!);

		// Decrypt metadata for fields like has_time, completed_occurrences_count
		const meta = await this.decryptMeta(template);

		// Check COUNT limit
		const countLimit = this.getCountFromRRule(rruleString);
		if (countLimit !== Infinity && (meta.completed_occurrences_count || 0) >= countLimit) {
			logger.info('COUNT limit reached, no more instances', {
				templateId: template.id,
				completed: meta.completed_occurrences_count,
				limit: countLimit
			});
			return;
		}

		// Compute next occurrence date
		const nextDate = this.getNextOccurrenceDate(template, instances, rruleString, meta);
		if (!nextDate) {
			logger.info('No more occurrences for template (UNTIL/end of rule)', {
				templateId: template.id
			});
			return;
		}

		// Create one instance
		const decryptedTitle = await cryptoManager.decryptText(template.title_encrypted);
		const decryptedDescription = template.description_encrypted
			? await cryptoManager.decryptText(template.description_encrypted)
			: undefined;

		const instanceDueDate = this.normalizeDueDate(nextDate, !!meta.has_time);

		await this.createInstance(template, {
			title: decryptedTitle,
			description: decryptedDescription,
			due_date: instanceDueDate,
			has_time: meta.has_time || false
		});

		logger.info('Generated next single instance', {
			templateId: template.id,
			dueDate: instanceDueDate
		});
	}

	/**
	 * Compute the next occurrence date for a template using RRULE.
	 * Finds the first date **strictly after** the latest completed/deleted instance.
	 * If no history exists, returns the first occurrence from the base date.
	 */
	private getNextOccurrenceDate(
		template: TaskEncryptedBooleans,
		allInstances: TaskEncryptedBooleans[],
		rruleString: string,
		meta?: Partial<TaskSensitiveMetadata>
	): Date | null {
		const baseDate = meta?.recurrence_base_date
			? new Date(meta.recurrence_base_date)
			: new Date(template.created_at);

		const rrule = rrulestr(rruleString, { dtstart: baseDate });

		// Find the latest completed or deleted instance date to know "where we are"
		const resolvedInstances = allInstances
			.filter((i) => (i.is_completed || i.deleted_at) && i.due_date)
			.map((i) => new Date(i.due_date!))
			.sort((a, b) => b.getTime() - a.getTime()); // newest first

		if (resolvedInstances.length > 0) {
			// Get first occurrence strictly after the latest resolved instance
			const after = resolvedInstances[0];
			const next = rrule.after(after, false); // false = strictly after
			return next;
		}

		// No history — return first occurrence (from base date, inclusive)
		const all = rrule.all((_, i) => i < 1); // get just the first one
		return all.length > 0 ? all[0] : null;
	}

	/**
	 * Normalize a Date to an ISO string. If has_time is false, truncate to
	 * beginning-of-day UTC.
	 */
	private normalizeDueDate(date: Date, hasTime: boolean): string {
		if (hasTime) return date.toISOString();
		const normalized = new Date(
			Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0)
		);
		return normalized.toISOString();
	}

	// ---------------------------------------------------------------------------
	//  Instance creation
	// ---------------------------------------------------------------------------

	/**
	 * Create a new instance of a recurring task
	 */
	private async createInstance(
		template: TaskEncryptedBooleans,
		data: {
			title: string;
			description?: string;
			due_date: string;
			has_time: boolean;
		}
	) {
		try {
			const currentUser = get(user);
			if (!currentUser?.id) {
				throw new Error('User not logged in');
			}

			const taskData: Partial<TaskDecrypted> = {
				title: data.title,
				description: data.description,
				task_list_id: template.task_list_id,
				due_date: data.due_date,
				has_time: data.has_time,
				is_completed: false,
				is_starred: template.is_starred,
				is_recurring: false,
				parent_task_id: template.id,
				is_template: false,
				position: template.position
			};

			await taskOperationsService.createTask(taskData, template.task_list_id);

			logger.info('Created recurring task instance', {
				templateId: template.id,
				dueDate: data.due_date
			});
		} catch (error: unknown) {
			logger.error('Failed to create instance', { templateId: template.id, error });
			throw error;
		}
	}

	// ---------------------------------------------------------------------------
	//  Completion & skip
	// ---------------------------------------------------------------------------

	/**
	 * Handle completion of a recurring task instance.
	 * Increments completed count on template, then immediately generates the
	 * next single instance.
	 */
	async handleInstanceCompletion(taskId: string) {
		try {
			const task = await taskStore.get(taskId);
			if (!task || !task.parent_task_id) return;

			const template = await taskStore.get(task.parent_task_id);
			if (!template || !template.is_template) return;

			// Decrypt metadata to get current completed count
			const meta = await this.decryptMeta(template);

			// Increment completed count
			await taskOperationsService.updateTask(template.id, {
				completed_occurrences_count: (meta.completed_occurrences_count || 0) + 1
			});

			// Generate next single instance for this template only
			await this.generateNextInstanceForTemplate(template.id);
		} catch (error: unknown) {
			logger.error('Failed to handle instance completion', { taskId, error });
		}
	}

	/**
	 * Skip a recurring instance: soft-delete it, increment completed count
	 * (skip counts towards COUNT limit), then generate the next instance.
	 */
	async skipInstance(instanceId: string): Promise<void> {
		try {
			const instance = await taskStore.get(instanceId);
			if (!instance || !instance.parent_task_id) {
				throw new Error('Task is not a recurring instance');
			}

			const templateId = instance.parent_task_id;
			await taskOperationsService.deleteTask(instanceId);

			// Increment completed count so skip counts towards COUNT limit
			const template = await taskStore.get(templateId);
			if (template && template.is_template) {
				const meta = await this.decryptMeta(template);
				await taskOperationsService.updateTask(templateId, {
					completed_occurrences_count: (meta.completed_occurrences_count || 0) + 1
				});
			}

			// Generate next instance immediately
			await this.generateNextInstanceForTemplate(templateId);
			logger.info('Skipped recurring instance', { instanceId });
		} catch (error: unknown) {
			logger.error('Failed to skip instance', { instanceId, error });
			throw error;
		}
	}

	// ---------------------------------------------------------------------------
	//  Recurrence rule management
	// ---------------------------------------------------------------------------

	/**
	 * Update recurrence rule for a template.
	 * In single-instance model: delete any active instance, then generate one
	 * new instance with the new rule.
	 */
	async updateRecurrenceRule(templateId: string, newRRule: string | null) {
		try {
			const template = await taskStore.get(templateId);
			if (!template || !template.is_template) {
				throw new Error('Task is not a template');
			}

			// Delete active (non-completed, non-deleted) instances
			const instances = await taskQueries.instancesOfTemplate(templateId);
			for (const instance of instances) {
				if (!instance.is_completed && !instance.deleted_at) {
					await taskOperationsService.deleteTask(instance.id);
				}
			}

			if (newRRule === null) {
				// Remove recurrence entirely
				await taskOperationsService.updateTask(templateId, {
					is_recurring: false,
					recurrence_rule: undefined
				});
			} else {
				// Update rule and regenerate one instance
				await taskOperationsService.updateTask(templateId, {
					is_recurring: true,
					recurrence_rule: newRRule
				});
				await this.generateNextInstanceForTemplate(templateId);
			}
		} catch (error: unknown) {
			logger.error('Failed to update recurrence rule', { templateId, error });
			throw error;
		}
	}

	/**
	 * Stop recurrence from this instance onwards.
	 * In single-instance model there is at most one active instance — just
	 * remove the recurrence rule from the template.
	 */
	async stopRecurrence(instanceId: string): Promise<void> {
		try {
			const instance = await taskStore.get(instanceId);
			if (!instance || !instance.parent_task_id || !instance.due_date) {
				throw new Error('Task is not a recurring instance');
			}

			const templateId = instance.parent_task_id;

			// Remove recurrence rule so no new instances are generated
			await taskOperationsService.updateTask(templateId, {
				is_recurring: false,
				recurrence_rule: undefined
			});

			logger.info('Stopped recurrence from instance', { instanceId, templateId });
		} catch (error: unknown) {
			logger.error('Failed to stop recurrence', { instanceId, error });
			throw error;
		}
	}

	// ---------------------------------------------------------------------------
	//  History / query helpers
	// ---------------------------------------------------------------------------

	/**
	 * Get all non-deleted instances of a template, decrypted, sorted by due_date
	 */
	async getTemplateInstances(templateId: string): Promise<
		Array<{
			id: string;
			due_date: string | null | undefined;
			is_completed: boolean;
			title: string;
		}>
	> {
		try {
			const instances = await taskQueries.instancesOfTemplate(templateId);
			const decrypted = await Promise.all(
				instances
					.filter((i) => !i.deleted_at)
					.map(async (i) => ({
						id: i.id,
						due_date: i.due_date,
						is_completed: i.is_completed,
						title: await cryptoManager.decryptText(i.title_encrypted)
					}))
			);
			return decrypted.sort((a, b) => {
				if (!a.due_date) return 1;
				if (!b.due_date) return -1;
				return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
			});
		} catch (error: unknown) {
			logger.error('Failed to get template instances', { templateId, error });
			throw error;
		}
	}

	// ---------------------------------------------------------------------------
	//  Edit recurrence from instance
	// ---------------------------------------------------------------------------

	/**
	 * Edit recurrence rule from an instance with scope option
	 */
	async editRecurrenceFromInstance(
		instanceId: string,
		newRRule: string | null,
		option: 'this_and_future' | 'all'
	): Promise<void> {
		try {
			const instance = await taskStore.get(instanceId);
			if (!instance || !instance.parent_task_id) {
				throw new Error('Task is not a recurring instance');
			}

			const instanceTitle = await cryptoManager.decryptText(instance.title_encrypted);

			if (option === 'all') {
				await taskOperationsService.updateTask(instance.parent_task_id, { title: instanceTitle });
				await this.updateRecurrenceRule(instance.parent_task_id, newRRule);
			} else {
				await this.updateThisAndFutureFromInstance(instance, newRRule, instanceTitle);
			}
		} catch (error: unknown) {
			logger.error('Failed to edit recurrence from instance', { instanceId, error });
			throw error;
		}
	}

	/**
	 * Update the recurrence rule starting from this instance's date onwards.
	 * Deletes active instance, updates template base date and rule, then
	 * generates one new instance.
	 */
	private async updateThisAndFutureFromInstance(
		instance: TaskEncryptedBooleans,
		newRRule: string | null,
		instanceTitle?: string
	): Promise<void> {
		try {
			if (!instance.parent_task_id || !instance.due_date) {
				throw new Error('Invalid recurring instance');
			}

			const templateId = instance.parent_task_id;

			// Delete active (non-completed, non-deleted) instances
			const allInstances = await taskQueries.instancesOfTemplate(templateId);
			for (const inst of allInstances) {
				if (!inst.deleted_at && !inst.is_completed) {
					await taskOperationsService.deleteTask(inst.id);
				}
			}

			if (newRRule === null) {
				await taskOperationsService.updateTask(templateId, {
					is_recurring: false,
					recurrence_rule: undefined
				});
				logger.info('Stopped recurrence for this_and_future', { templateId });
				return;
			}

			// Move base date to this instance's date, update rule & title
			await taskOperationsService.updateTask(templateId, {
				...(instanceTitle !== undefined ? { title: instanceTitle } : {}),
				recurrence_rule: newRRule,
				recurrence_base_date: instance.due_date,
				is_recurring: true
			});

			// Generate one new instance with updated rule
			await this.generateNextInstanceForTemplate(templateId);
		} catch (error: unknown) {
			logger.error('Failed to update this and future instances', error);
			throw error;
		}
	}

	/**
	 * Handle recurrence option selection from UI
	 */
	async handleRecurrenceEditOption(
		instanceId: string,
		option: 'this_only' | 'this_and_future' | 'all'
	) {
		try {
			const instance = await taskStore.get(instanceId);
			if (!instance || !instance.parent_task_id) {
				throw new Error('Task is not a recurring instance');
			}

			switch (option) {
				case 'this_only':
					break;
				case 'this_and_future':
					await this.updateThisAndFutureFromInstance(instance, null);
					break;
				case 'all':
					await this.updateRecurrenceRule(instance.parent_task_id, null);
					break;
			}
		} catch (error: unknown) {
			logger.error('Failed to handle recurrence edit option', { instanceId, option, error });
			throw error;
		}
	}

	// ---------------------------------------------------------------------------
	//  Utilities
	// ---------------------------------------------------------------------------

	/**
	 * Extract COUNT value from RRULE string
	 */
	private getCountFromRRule(rruleString: string): number {
		const match = rruleString.match(/COUNT=(\d+)/);
		return match ? parseInt(match[1], 10) : Infinity;
	}
}

// Export singleton instance
export const recurrenceService = new RecurrenceService();
