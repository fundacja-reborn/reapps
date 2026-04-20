import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { prisma } from '@reborn/database';
import { createLogger } from '@reborn/utils';
import { validateBody, schemas, type SubtaskEncrypted } from '@reborn/types';
import { getUserFromToken } from '$lib/server/auth';

const logger = createLogger('SubtasksAPI');

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

		// Optional task filter for subtasks
		const taskId = url.searchParams.get('task_id');

		let subtasks: Array<{
			id: string;
			task_id: string;
			name_encrypted: string;
			metadata_encrypted: string | null;
			position: number;
			sync_version: number;
			created_at: Date;
			updated_at: Date;
			deleted_at: Date | null;
		}>;

		if (taskId) {
			// Get subtasks for specific task
			// Verify task belongs to user
			const task = await prisma.task.findFirst({
				where: {
					id: taskId,
					user_id: userId
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

			// Fetch all non-deleted subtasks for the task
			subtasks = await prisma.subTask.findMany({
				where: {
					task_id: taskId,
					deleted_at: null
				},
				orderBy: { position: 'asc' }
			});

			logger.info(`Fetched ${subtasks.length} subtasks for task ${taskId}`);
		} else {
			// Get all subtasks for user (for sync)
			// First get all user's tasks
			const userTasks = await prisma.task.findMany({
				where: {
					user_id: userId,
					deleted_at: null
				},
				select: { id: true }
			});

			const taskIds = userTasks.map((t: { id: string }) => t.id);

			// If user has no tasks, return empty array
			if (taskIds.length === 0) {
				logger.info(`No tasks found for user ${userId}, returning empty subtasks`);
				subtasks = [];
			} else {
				// Then get all non-deleted subtasks for those tasks
				subtasks = await prisma.subTask.findMany({
					where: {
						task_id: { in: taskIds },
						deleted_at: null
					},
					orderBy: [{ task_id: 'asc' }, { position: 'asc' }]
				});

				logger.info(`Fetched ${subtasks.length} subtasks for user ${userId}`);
			}
		}

		// Map to wire format — is_completed is inside metadata_encrypted
		const subtasksResponse: SubtaskEncrypted[] = subtasks.map((subtask) => ({
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
		}));

		return json({
			success: true,
			data: subtasksResponse
		});
	} catch (error: unknown) {
		logger.error('Get subtasks error:', error);
		return json(
			{
				success: false,
				error: 'Internal server error'
			},
			{ status: 500 }
		);
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
		const validation = validateBody(schemas.CreateSubtaskRequestSchema, body);
		if (!validation.success) {
			return json(
				{ success: false, error: validation.error, details: validation.details },
				{ status: 400 }
			);
		}
		const data = validation.data;

		// Verify task belongs to user
		const task = await prisma.task.findFirst({
			where: {
				id: data.task_id,
				user_id: userId
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

		// Get the highest order_index for the task
		const maxOrderSubtask = await prisma.subTask.findFirst({
			where: {
				task_id: data.task_id
			},
			orderBy: { position: 'desc' }
		});

		const nextPosition = maxOrderSubtask ? maxOrderSubtask.position + 1000 : 1000;

		// Create the subtask — is_completed inside metadata_encrypted
		const subtask = await prisma.subTask.create({
			data: {
				id: data.id || undefined,
				task_id: data.task_id,
				name_encrypted: data.name_encrypted,
				metadata_encrypted: data.metadata_encrypted || null,
				position: data.position ?? nextPosition
			}
		});

		logger.info(`Created subtask ${subtask.id} for task ${data.task_id}`);

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

		return json(
			{
				success: true,
				data: subtaskResponse
			},
			{ status: 201 }
		);
	} catch (error: unknown) {
		logger.error('Create subtask error:', error);
		return json(
			{
				success: false,
				error: 'Internal server error'
			},
			{ status: 500 }
		);
	}
};
