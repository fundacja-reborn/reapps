import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { prisma, type TaskList } from '@reborn/database';
import { createLogger } from '@reborn/utils';
import { validateBody, schemas } from '@reborn/types';
import { getUserFromToken } from '$lib/server/auth';
import { apiErrorResponse } from '$lib/server/api-error';

const logger = createLogger('TaskListsAPI');

export const GET: RequestHandler = async ({ request }) => {
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

		// Fetch active (non-deleted) lists for the user
		const taskLists = await prisma.taskList.findMany({
			where: {
				user_id: userId,
				deleted_at: null
			},
			orderBy: [{ is_default: 'desc' }, { order_index: 'asc' }]
		});

		logger.info(`Fetched ${taskLists.length} lists for user ${userId}`);

		// Map to format expected by frontend
		const listsResponse = taskLists.map((list: TaskList) => ({
			id: list.id,
			user_id: list.user_id,
			name_encrypted: list.name_encrypted,
			metadata_encrypted: list.metadata_encrypted || undefined,
			order_index: list.order_index,
			is_default: list.is_default,
			created_at: list.created_at.toISOString(),
			updated_at: list.updated_at.toISOString(),
			deleted_at: list.deleted_at?.toISOString() || null,
			sync_version: list.sync_version || 0,
			// Add fields expected by frontend types
			sync_status: 'synced' as const,
			last_sync_at: new Date().toISOString()
		}));

		return json({
			success: true,
			data: listsResponse
		});
	} catch (error: unknown) {
		return apiErrorResponse(error, logger, 'GET /api/tasklists');
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
		const validation = validateBody(schemas.CreateListRequestSchema, body);
		if (!validation.success) {
			return json(
				{ success: false, error: validation.error, details: validation.details },
				{ status: 400 }
			);
		}
		const data = validation.data;

		// If this is the first list, make it default
		const existingListsCount = await prisma.taskList.count({
			where: {
				user_id: userId
			}
		});

		// Defense-in-depth: if user already has a default list and this one also
		// claims is_default, demote the incoming one to prevent duplicates
		let isDefault = data.is_default ?? existingListsCount === 0;
		if (isDefault && existingListsCount > 0) {
			const existingDefault = await prisma.taskList.findFirst({
				where: { user_id: userId, is_default: true }
			});
			if (existingDefault) {
				logger.warn(
					`User ${userId} already has default list ${existingDefault.id}, demoting new list`
				);
				isDefault = false;
			}
		}

		// If setting as default, unset other defaults
		if (isDefault && existingListsCount > 0) {
			await prisma.taskList.updateMany({
				where: {
					user_id: userId,
					is_default: true
				},
				data: {
					is_default: false
				}
			});
		}

		// Create the task list
		const taskList = await prisma.taskList.create({
			data: {
				id: data.id || undefined, // Let DB generate if not provided
				user_id: userId,
				name_encrypted: data.name_encrypted,
				metadata_encrypted: data.metadata_encrypted,
				is_default: isDefault,
				order_index: data.order_index ?? existingListsCount
			}
		});

		logger.info(`Created list ${taskList.id} for user ${userId}`);

		// Return in format expected by frontend
		const listResponse = {
			id: taskList.id,
			user_id: taskList.user_id,
			name_encrypted: taskList.name_encrypted,
			metadata_encrypted: taskList.metadata_encrypted || undefined,
			order_index: taskList.order_index,
			is_default: taskList.is_default,
			created_at: taskList.created_at.toISOString(),
			updated_at: taskList.updated_at.toISOString(),
			deleted_at: taskList.deleted_at?.toISOString() || null,
			sync_version: taskList.sync_version || 0,
			// Add fields expected by frontend types
			sync_status: 'synced' as const,
			last_sync_at: new Date().toISOString()
		};

		return json(
			{
				success: true,
				data: listResponse
			},
			{ status: 201 }
		);
	} catch (error: unknown) {
		return apiErrorResponse(error, logger, 'POST /api/tasklists');
	}
};
