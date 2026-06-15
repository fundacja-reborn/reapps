import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { prisma, type Task } from '@reborn/database';
import { createLogger } from '@reborn/utils';
import { validateBody, schemas } from '@reborn/types';
import { getUserFromToken } from '$lib/server/auth';
import { apiErrorResponse } from '$lib/server/api-error';

const logger = createLogger('TasksAPI');

export const GET: RequestHandler = async ({ request, url }) => {
	try {
		const userId = await getUserFromToken(request.headers.get('authorization'));

		if (!userId) {
			return json(
				{
					success: false,
					error: 'Unauthorized'
				},
				{ status: 401 }
			);
		}

		// Optional list filter
		const listId = url.searchParams.get('task_list_id');
		// Check if we should include deleted tasks (for trash view)
		const includeDeleted = url.searchParams.get('include_deleted') === 'true';

		// Build query
		const whereClause: {
			user_id: string;
			task_list_id?: string;
			deleted_at?: null | { not: null };
		} = {
			user_id: userId
		};

		if (listId) {
			whereClause.task_list_id = listId;
		}

		// By default, exclude deleted tasks unless specifically requested
		if (includeDeleted) {
			// Include only deleted tasks for trash view
			whereClause.deleted_at = { not: null };
		} else {
			// Exclude deleted tasks for normal view
			whereClause.deleted_at = null;
		}

		// Fetch tasks based on the filters
		const tasks = await prisma.task.findMany({
			where: whereClause,
			orderBy: [{ position: 'asc' }, { created_at: 'desc' }]
		});

		logger.info(`Fetched ${tasks.length} tasks for user ${userId}`);

		// Filter out orphaned recurring instances
		// (tasks with parent_task_id pointing to non-existent template)
		const filteredTasks: typeof tasks = [];
		const orphanedTaskIds: string[] = [];

		for (const task of tasks) {
			if (task.parent_task_id) {
				// Check if template exists
				const template = await prisma.task.findFirst({
					where: {
						id: task.parent_task_id,
						user_id: userId
					}
				});

				if (!template) {
					// Template doesn't exist - this is an orphaned instance
					logger.warn(
						`Found orphaned recurring instance ${task.id} - template ${task.parent_task_id} not found`
					);
					orphanedTaskIds.push(task.id);
					continue; // Skip this task
				}
			}

			filteredTasks.push(task);
		}

		// Clean up orphaned tasks and empty templates asynchronously (don't wait for it)
		if (orphanedTaskIds.length > 0 || !includeDeleted) {
			setImmediate(async () => {
				try {
					// Clean up orphaned instances
					if (orphanedTaskIds.length > 0) {
						logger.info(`Cleaning up ${orphanedTaskIds.length} orphaned recurring instances`);
						for (const taskId of orphanedTaskIds) {
							await prisma.task.delete({
								where: { id: taskId }
							});
						}
						logger.info('Orphaned instances cleanup completed');
					}

					// Clean up templates that have NO instances at all (neither active nor in trash)
					// This ensures templates are preserved while instances are in trash
					if (!includeDeleted) {
						const templates = await prisma.task.findMany({
							where: {
								user_id: userId,
								is_template: 1
							}
						});

						for (const template of templates) {
							// Count ALL instances (both active and in trash)
							const totalInstancesCount = await prisma.task.count({
								where: {
									parent_task_id: template.id,
									user_id: userId
									// No deleted_at filter - count all instances
								}
							});

							// Only delete template if it has NO instances at all
							if (totalInstancesCount === 0) {
								logger.info(
									`Cleaning up orphaned template ${template.id} - no instances exist (neither active nor in trash)`
								);
								await prisma.task.delete({
									where: { id: template.id }
								});
							}
						}
					}
				} catch (error: unknown) {
					logger.error('Failed to cleanup orphaned data:', error);
				}
			});
		}

		// Map to wire format — sensitive metadata is opaque (inside metadata_encrypted)
		const tasksResponse = filteredTasks.map((task: Task) => ({
			id: task.id,
			user_id: task.user_id,
			task_list_id: task.task_list_id,
			title_encrypted: task.title_encrypted,
			description_encrypted: task.description_encrypted || undefined,
			metadata_encrypted: task.metadata_encrypted,
			recurrence_rule_encrypted: task.recurrence_rule_encrypted || undefined,
			parent_task_id: task.parent_task_id || undefined,
			is_template: task.is_template as 0 | 1,
			position: task.position,
			created_at: task.created_at.toISOString(),
			updated_at: task.updated_at.toISOString(),
			deleted_at: task.deleted_at?.toISOString() || null,
			sync_version: task.sync_version || 0,
			sync_status: 'synced' as const,
			last_sync_at: new Date().toISOString()
		}));

		return json({
			success: true,
			data: tasksResponse
		});
	} catch (error: unknown) {
		return apiErrorResponse(error, logger, 'GET /api/tasks');
	}
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const userId = await getUserFromToken(request.headers.get('authorization'));

		if (!userId) {
			return json(
				{
					success: false,
					error: 'Unauthorized'
				},
				{ status: 401 }
			);
		}

		const body = await request.json();
		const validation = validateBody(schemas.CreateTaskRequestSchema, body);
		if (!validation.success) {
			return json(
				{ success: false, error: validation.error, details: validation.details },
				{ status: 400 }
			);
		}
		const data = validation.data;

		// Verify list belongs to user
		const list = await prisma.taskList.findFirst({
			where: {
				id: data.task_list_id,
				user_id: userId
			}
		});

		if (!list) {
			return json(
				{
					success: false,
					error: 'List not found'
				},
				{ status: 404 }
			);
		}

		// Get the highest position for the list
		const maxPositionTask = await prisma.task.findFirst({
			where: {
				task_list_id: data.task_list_id,
				user_id: userId
			},
			orderBy: { position: 'desc' }
		});

		const nextPosition = maxPositionTask ? maxPositionTask.position + 10000 : 10000;

		// Create the task — sensitive metadata is opaque (metadata_encrypted)
		const task = await prisma.task.create({
			data: {
				id: data.id || undefined,
				user_id: userId,
				task_list_id: data.task_list_id,
				title_encrypted: data.title_encrypted,
				description_encrypted: data.description_encrypted || null,
				metadata_encrypted: data.metadata_encrypted,
				position: data.position ?? nextPosition,
				recurrence_rule_encrypted: data.recurrence_rule_encrypted || null,
				parent_task_id: data.parent_task_id || null,
				is_template: (data.is_template ?? 0) as number
			}
		});

		logger.info(`Created task ${task.id} for user ${userId}`);

		// Return wire format
		const taskResponse = {
			id: task.id,
			user_id: task.user_id,
			task_list_id: task.task_list_id,
			title_encrypted: task.title_encrypted,
			description_encrypted: task.description_encrypted || undefined,
			metadata_encrypted: task.metadata_encrypted,
			recurrence_rule_encrypted: task.recurrence_rule_encrypted || undefined,
			parent_task_id: task.parent_task_id || undefined,
			is_template: task.is_template as 0 | 1,
			position: task.position,
			created_at: task.created_at.toISOString(),
			updated_at: task.updated_at.toISOString(),
			deleted_at: task.deleted_at?.toISOString() || null,
			sync_version: task.sync_version || 0,
			sync_status: 'synced' as const,
			last_sync_at: new Date().toISOString()
		};

		return json(
			{
				success: true,
				data: taskResponse
			},
			{ status: 201 }
		);
	} catch (error: unknown) {
		return apiErrorResponse(error, logger, 'POST /api/tasks');
	}
};
