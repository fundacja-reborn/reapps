import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { prisma, type Prisma } from '@reborn/database';
import { createLogger } from '@reborn/utils';
import { validateBody, schemas, type SubtaskEncrypted } from '@reborn/types';
import { getUserFromToken } from '$lib/server/auth';

const logger = createLogger('SubtaskAPI');

/**
 * PUT /api/subtasks/[id] - Update a specific subtask
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

		const subtaskId = params.id;
		if (!subtaskId) {
			return json(
				{
					success: false,
					error: 'Subtask ID is required'
				},
				{ status: 400 }
			);
		}

		// Verify subtask exists and belongs to user through task ownership
		const existingSubtask = await prisma.subTask.findFirst({
			where: {
				id: subtaskId,
				deleted_at: null // Only find non-deleted subtasks
			},
			include: {
				task: {
					select: {
						user_id: true
					}
				}
			}
		});

		if (!existingSubtask || existingSubtask.task.user_id !== userId) {
			return json(
				{
					success: false,
					error: 'Subtask not found'
				},
				{ status: 404 }
			);
		}

		// Parse and validate request body
		const body = await request.json();
		const validation = validateBody(schemas.UpdateSubtaskRequestSchema, body);
		if (!validation.success) {
			return json(
				{ success: false, error: validation.error, details: validation.details },
				{ status: 400 }
			);
		}
		const data = validation.data;

		// Prepare update data
		const updateData: Prisma.SubTaskUncheckedUpdateInput = {
			updated_at: new Date(),
			sync_version: existingSubtask.sync_version + 1
		};

		// Copy over allowed fields
		if (data.name_encrypted !== undefined) updateData.name_encrypted = data.name_encrypted;
		if (data.metadata_encrypted !== undefined)
			updateData.metadata_encrypted = data.metadata_encrypted;
		if (data.position !== undefined) updateData.position = data.position;
		if (data.deleted_at !== undefined)
			updateData.deleted_at = data.deleted_at ? new Date(data.deleted_at) : null;

		// Update the subtask
		const updatedSubtask = await prisma.subTask.update({
			where: { id: subtaskId },
			data: updateData
		});

		logger.info(`Updated subtask ${subtaskId} for user ${userId}`);

		// Return in format expected by frontend
		const subtaskResponse: SubtaskEncrypted = {
			id: updatedSubtask.id,
			task_id: updatedSubtask.task_id,
			name_encrypted: updatedSubtask.name_encrypted,
			metadata_encrypted: updatedSubtask.metadata_encrypted ?? undefined,
			position: updatedSubtask.position,
			user_id: userId,
			created_at: updatedSubtask.created_at.toISOString(),
			updated_at: updatedSubtask.updated_at.toISOString(),
			deleted_at: updatedSubtask.deleted_at?.toISOString() ?? null,
			sync_status: 'synced' as const,
			last_sync_at: new Date().toISOString(),
			sync_version: updatedSubtask.sync_version
		};

		return json({
			success: true,
			data: subtaskResponse
		});
	} catch (error: unknown) {
		logger.error('Update subtask error:', error);
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
 * DELETE /api/subtasks/[id] - Soft delete a subtask
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

		const subtaskId = params.id;
		if (!subtaskId) {
			return json(
				{
					success: false,
					error: 'Subtask ID is required'
				},
				{ status: 400 }
			);
		}

		// Verify subtask exists and belongs to user through task ownership
		const existingSubtask = await prisma.subTask.findFirst({
			where: {
				id: subtaskId,
				deleted_at: null // Only find non-deleted subtasks
			},
			include: {
				task: {
					select: {
						user_id: true
					}
				}
			}
		});

		if (!existingSubtask || existingSubtask.task.user_id !== userId) {
			return json(
				{
					success: false,
					error: 'Subtask not found'
				},
				{ status: 404 }
			);
		}

		// Soft delete the subtask by setting deleted_at
		await prisma.subTask.update({
			where: { id: subtaskId },
			data: {
				deleted_at: new Date()
			}
		});

		logger.info(`Soft deleted subtask ${subtaskId} for user ${userId}`);

		return json({
			success: true,
			message: 'Subtask deleted successfully'
		});
	} catch (error: unknown) {
		logger.error('Delete subtask error:', error);
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
 * GET /api/subtasks/[id] - Get a specific subtask
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

		const subtaskId = params.id;
		if (!subtaskId) {
			return json(
				{
					success: false,
					error: 'Subtask ID is required'
				},
				{ status: 400 }
			);
		}

		// Get subtask and verify ownership through task
		const subtask = await prisma.subTask.findFirst({
			where: {
				id: subtaskId,
				deleted_at: null // Only find non-deleted subtasks
			},
			include: {
				task: {
					select: {
						user_id: true
					}
				}
			}
		});

		if (!subtask || subtask.task.user_id !== userId) {
			return json(
				{
					success: false,
					error: 'Subtask not found'
				},
				{ status: 404 }
			);
		}

		// Return in format expected by frontend
		const subtaskResponse: SubtaskEncrypted = {
			id: subtask.id,
			task_id: subtask.task_id,
			name_encrypted: subtask.name_encrypted,
			metadata_encrypted: subtask.metadata_encrypted ?? undefined,
			position: subtask.position,
			user_id: userId,
			created_at: subtask.created_at.toISOString(),
			updated_at: subtask.updated_at.toISOString(),
			deleted_at: subtask.deleted_at?.toISOString() ?? null,
			sync_status: 'synced' as const,
			last_sync_at: new Date().toISOString(),
			sync_version: subtask.sync_version
		};

		return json({
			success: true,
			data: subtaskResponse
		});
	} catch (error: unknown) {
		logger.error('Get subtask error:', error);
		return json(
			{
				success: false,
				error: 'Internal server error'
			},
			{ status: 500 }
		);
	}
};
