import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { prisma, type Prisma } from '@reborn/database';
import { createLogger } from '@reborn/utils';
import { validateBody, schemas } from '@reborn/types';
import { getUserFromToken } from '$lib/server/auth';
import { apiErrorResponse } from '$lib/server/api-error';

const logger = createLogger('TaskAPI');

/**
 * PUT /api/tasks/[id] - Update a specific task
 */
export const PUT: RequestHandler = async ({ request, params }) => {
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

		const taskId = params.id;
		if (!taskId) {
			return json(
				{
					success: false,
					error: 'Task ID is required'
				},
				{ status: 400 }
			);
		}

		// Verify task exists and belongs to user
		// Allow updating tasks in trash (for restore functionality)
		const existingTask = await prisma.task.findFirst({
			where: {
				id: taskId,
				user_id: userId
			}
		});

		if (!existingTask) {
			return json(
				{
					success: false,
					error: 'Task not found'
				},
				{ status: 404 }
			);
		}

		// Parse and validate request body
		const body = await request.json();
		const validation = validateBody(schemas.UpdateTaskRequestSchema, body);
		if (!validation.success) {
			return json(
				{ success: false, error: validation.error, details: validation.details },
				{ status: 400 }
			);
		}
		const data = validation.data;

		// If changing task list, verify new list belongs to user
		if (data.task_list_id && data.task_list_id !== existingTask.task_list_id) {
			const newList = await prisma.taskList.findFirst({
				where: {
					id: data.task_list_id,
					user_id: userId
				}
			});

			if (!newList) {
				return json(
					{
						success: false,
						error: 'Target list not found'
					},
					{ status: 404 }
				);
			}
		}

		// Prepare update data — only non-sensitive fields + opaque metadata_encrypted
		const updateData: Prisma.TaskUncheckedUpdateInput = {
			updated_at: new Date(),
			sync_version: existingTask.sync_version + 1
		};

		if (data.title_encrypted !== undefined) updateData.title_encrypted = data.title_encrypted;
		if (data.description_encrypted !== undefined)
			updateData.description_encrypted = data.description_encrypted;
		if (data.metadata_encrypted !== undefined)
			updateData.metadata_encrypted = data.metadata_encrypted;
		if (data.task_list_id !== undefined) updateData.task_list_id = data.task_list_id;
		if (data.position !== undefined) updateData.position = data.position;
		if (data.is_template !== undefined) updateData.is_template = data.is_template;
		if ('recurrence_rule_encrypted' in data)
			updateData.recurrence_rule_encrypted = data.recurrence_rule_encrypted;
		if ('parent_task_id' in data) {
			if (data.parent_task_id) {
				const parentTask = await prisma.task.findFirst({
					where: { id: data.parent_task_id, user_id: userId }
				});
				if (!parentTask) {
					return json(
						{ success: false, error: 'Parent task not found' },
						{ status: 404 }
					);
				}
			}
			updateData.parent_task_id = data.parent_task_id;
		}
		if ('deleted_at' in data)
			updateData.deleted_at = data.deleted_at ? new Date(data.deleted_at) : null;

		// Update the task
		const updatedTask = await prisma.task.update({
			where: { id: taskId },
			data: updateData
		});

		logger.info(`Updated task ${taskId} for user ${userId}`);

		const taskResponse = {
			id: updatedTask.id,
			user_id: updatedTask.user_id,
			task_list_id: updatedTask.task_list_id,
			title_encrypted: updatedTask.title_encrypted,
			description_encrypted: updatedTask.description_encrypted || undefined,
			metadata_encrypted: updatedTask.metadata_encrypted,
			recurrence_rule_encrypted: updatedTask.recurrence_rule_encrypted || undefined,
			parent_task_id: updatedTask.parent_task_id || undefined,
			is_template: updatedTask.is_template as 0 | 1,
			position: updatedTask.position,
			created_at: updatedTask.created_at.toISOString(),
			updated_at: updatedTask.updated_at.toISOString(),
			deleted_at: updatedTask.deleted_at?.toISOString() || null,
			sync_version: updatedTask.sync_version || 0,
			sync_status: 'synced' as const,
			last_sync_at: new Date().toISOString()
		};

		return json({
			success: true,
			data: taskResponse
		});
	} catch (error: unknown) {
		return apiErrorResponse(error, logger, 'PUT /api/tasks/[id]');
	}
};

/**
 * DELETE /api/tasks/[id] - Soft delete a task
 */
export const DELETE: RequestHandler = async ({ request, params }) => {
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

		const taskId = params.id;
		if (!taskId) {
			return json(
				{
					success: false,
					error: 'Task ID is required'
				},
				{ status: 400 }
			);
		}

		// Verify task exists and belongs to user
		const existingTask = await prisma.task.findFirst({
			where: {
				id: taskId,
				user_id: userId,
				deleted_at: null
			}
		});

		if (!existingTask) {
			return json(
				{
					success: false,
					error: 'Task not found'
				},
				{ status: 404 }
			);
		}

		// Soft delete the task
		await prisma.task.update({
			where: { id: taskId },
			data: {
				deleted_at: new Date(),
				updated_at: new Date(),
				sync_version: existingTask.sync_version + 1
			}
		});

		// Also soft delete any subtasks
		await prisma.subTask.updateMany({
			where: {
				task_id: taskId,
				deleted_at: null
			},
			data: {
				deleted_at: new Date(),
				updated_at: new Date()
			}
		});

		logger.info(`Soft deleted task ${taskId} for user ${userId}`);

		return json({
			success: true,
			message: 'Task deleted successfully'
		});
	} catch (error: unknown) {
		return apiErrorResponse(error, logger, 'DELETE /api/tasks/[id]');
	}
};

/**
 * GET /api/tasks/[id] - Get a specific task
 */
export const GET: RequestHandler = async ({ request, params }) => {
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

		const taskId = params.id;
		if (!taskId) {
			return json(
				{
					success: false,
					error: 'Task ID is required'
				},
				{ status: 400 }
			);
		}

		// Get task
		const task = await prisma.task.findFirst({
			where: {
				id: taskId,
				user_id: userId,
				deleted_at: null
			}
		});

		if (!task) {
			return json(
				{
					success: false,
					error: 'Task not found'
				},
				{ status: 404 }
			);
		}

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

		return json({
			success: true,
			data: taskResponse
		});
	} catch (error: unknown) {
		return apiErrorResponse(error, logger, 'GET /api/tasks/[id]');
	}
};
