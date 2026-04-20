import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { prisma } from '@reborn/database';
import { createLogger } from '@reborn/utils';
import { validateBody, schemas } from '@reborn/types';
import { getUserFromToken } from '$lib/server/auth';

const logger = createLogger('TaskListAPI');

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

		const { id } = params;
		if (!id) {
			return json(
				{
					success: false,
					error: 'List ID is required'
				},
				{ status: 400 }
			);
		}

		const body = await request.json();
		const validation = validateBody(schemas.UpdateListRequestSchema, body);
		if (!validation.success) {
			return json(
				{ success: false, error: validation.error, details: validation.details },
				{ status: 400 }
			);
		}
		const data = validation.data;

		// Check if list exists and belongs to user
		const existingList = await prisma.taskList.findFirst({
			where: {
				id,
				user_id: userId
			}
		});

		if (!existingList) {
			return json(
				{
					success: false,
					error: 'List not found'
				},
				{ status: 404 }
			);
		}

		// If setting as default, unset other defaults
		if (data.is_default && !existingList.is_default) {
			await prisma.taskList.updateMany({
				where: {
					user_id: userId,
					is_default: true,
					id: { not: id }
				},
				data: {
					is_default: false
				}
			});
		}

		// Update the list
		const updatedList = await prisma.taskList.update({
			where: { id },
			data: {
				name_encrypted: data.name_encrypted ?? existingList.name_encrypted,
				metadata_encrypted: data.metadata_encrypted ?? existingList.metadata_encrypted,
				order_index: data.order_index ?? existingList.order_index,
				is_default: data.is_default ?? existingList.is_default
			}
		});

		logger.info(`Updated list ${id} for user ${userId}`);

		// Return in format expected by frontend
		const listResponse = {
			id: updatedList.id,
			user_id: updatedList.user_id,
			name_encrypted: updatedList.name_encrypted,
			metadata_encrypted: updatedList.metadata_encrypted || undefined,
			order_index: updatedList.order_index,
			is_default: updatedList.is_default,
			created_at: updatedList.created_at.toISOString(),
			updated_at: updatedList.updated_at.toISOString(),
			deleted_at: updatedList.deleted_at?.toISOString() || null,
			sync_version: updatedList.sync_version || 0,
			// Add fields expected by frontend types
			sync_status: 'synced' as const,
			last_sync_at: new Date().toISOString()
		};

		return json({
			success: true,
			data: listResponse
		});
	} catch (error: unknown) {
		logger.error('Update task list error:', error);
		return json(
			{
				success: false,
				error: 'Internal server error'
			},
			{ status: 500 }
		);
	}
};

/**
 * DELETE /api/tasklists/[id] - Delete task list (used only for sync operations)
 *
 * This endpoint is called by the sync service, not directly from the client.
 * The client performs delete operations locally via listDeleteOps and queues them for sync.
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

		const { id } = params;
		if (!id) {
			return json(
				{
					success: false,
					error: 'List ID is required'
				},
				{ status: 400 }
			);
		}

		// Get delete mode from request body (for sync operations that need special handling)
		let deleteMode: 'soft' | 'with-tasks' | 'move-tasks' = 'soft';
		let targetListId: string | undefined;

		try {
			const body = await request.json();
			const validation = validateBody(schemas.DeleteListRequestSchema, body);
			if (validation.success) {
				deleteMode = validation.data.deleteMode ?? 'soft';
				targetListId = validation.data.targetListId;
			}
		} catch {
			// If no body, use default soft delete
		}

		// Check if list exists and belongs to user
		const existingList = await prisma.taskList.findFirst({
			where: {
				id,
				user_id: userId
			}
		});

		if (!existingList) {
			return json(
				{
					success: false,
					error: 'List not found'
				},
				{ status: 404 }
			);
		}

		// Don't allow deleting the default list
		if (existingList.is_default) {
			return json(
				{
					success: false,
					error: 'Cannot delete the default list'
				},
				{ status: 400 }
			);
		}

		// Handle different delete modes
		if (deleteMode === 'with-tasks') {
			// Hard delete list and all its tasks
			await prisma.task.deleteMany({
				where: {
					task_list_id: id,
					user_id: userId
				}
			});

			await prisma.taskList.delete({
				where: { id }
			});

			logger.info(`Hard deleted list ${id} with all tasks for user ${userId}`);
		} else if (deleteMode === 'move-tasks' && targetListId) {
			// Verify target list exists and belongs to user
			const targetList = await prisma.taskList.findFirst({
				where: {
					id: targetListId,
					user_id: userId
				}
			});

			if (!targetList) {
				return json(
					{
						success: false,
						error: 'Target list not found'
					},
					{ status: 404 }
				);
			}

			// Move all tasks to target list
			await prisma.task.updateMany({
				where: {
					task_list_id: id,
					user_id: userId
				},
				data: {
					task_list_id: targetListId
				}
			});

			// Delete the list
			await prisma.taskList.delete({
				where: { id }
			});

			logger.info(`Deleted list ${id} and moved tasks to ${targetListId} for user ${userId}`);
		} else {
			// Default: Soft delete
			await prisma.taskList.update({
				where: { id },
				data: {
					deleted_at: new Date()
				}
			});

			logger.info(`Soft deleted list ${id} for user ${userId}`);

			// Also soft delete all tasks in this list
			await prisma.task.updateMany({
				where: {
					task_list_id: id,
					user_id: userId
				},
				data: {
					deleted_at: new Date()
				}
			});
		}

		return json({
			success: true,
			message: 'List deleted successfully'
		});
	} catch (error: unknown) {
		logger.error('Delete task list error:', error);
		return json(
			{
				success: false,
				error: 'Internal server error'
			},
			{ status: 500 }
		);
	}
};
