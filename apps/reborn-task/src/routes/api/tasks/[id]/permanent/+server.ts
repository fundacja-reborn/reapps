import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { prisma } from '@reborn/database';
import { createLogger } from '@reborn/utils';
import { getUserFromToken } from '$lib/server/auth';

const logger = createLogger('TaskPermanentDeleteAPI');

/**
 * DELETE /api/tasks/[id]/permanent - Permanently delete a task from the database
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

		// First try to find the task (regardless of deleted_at status)
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

		const isTemplate = existingTask.is_template === 1;

		// Store parent_task_id before deletion (if this is a recurring instance)
		const parentTaskId = existingTask.parent_task_id;

		// Log template deletion for debugging
		if (isTemplate) {
			logger.info(`Permanently deleting template ${taskId} - checking for instances`);

			// Check if there are any instances of this template
			const allInstances = await prisma.task.findMany({
				where: {
					parent_task_id: taskId,
					user_id: userId
				},
				select: { id: true, deleted_at: true }
			});

			type InstanceRow = { id: string; deleted_at: Date | null };
			const activeInstances = allInstances.filter((i: InstanceRow) => !i.deleted_at);
			const deletedInstances = allInstances.filter((i: InstanceRow) => i.deleted_at);

			if (activeInstances.length > 0) {
				logger.warn(
					`Cannot delete template ${taskId} - has ${activeInstances.length} active instances`
				);
				return json(
					{
						success: false,
						error: 'Cannot delete template with active instances',
						details: {
							activeInstanceIds: activeInstances.map((i: InstanceRow) => i.id),
							totalActiveInstances: activeInstances.length
						}
					},
					{ status: 400 }
				);
			}

			// If template has only deleted instances, we can safely delete them all
			if (deletedInstances.length > 0) {
				logger.info(
					`Template ${taskId} has ${deletedInstances.length} deleted instances, removing them as well`
				);

				// Delete all subtasks of deleted instances
				await prisma.subTask.deleteMany({
					where: {
						task_id: { in: deletedInstances.map((i: InstanceRow) => i.id) }
					}
				});

				// Delete all deleted instances
				await prisma.task.deleteMany({
					where: {
						id: { in: deletedInstances.map((i: InstanceRow) => i.id) }
					}
				});
			}

			// Log deletion of template
			logger.info(
				`Template ${taskId} and its ${deletedInstances.length} deleted instances will be permanently removed`
			);
		}

		// First, permanently delete all subtasks
		await prisma.subTask.deleteMany({
			where: {
				task_id: taskId
			}
		});

		// Then permanently delete the task
		await prisma.task.delete({
			where: { id: taskId }
		});

		logger.info(`Permanently deleted task ${taskId} for user ${userId}`);

		// After deleting a recurring instance, check if the template should be cleaned up
		if (parentTaskId && !isTemplate) {
			// Check if template has any remaining instances
			const remainingInstancesCount = await prisma.task.count({
				where: {
					parent_task_id: parentTaskId,
					user_id: userId
					// Count all instances, not just active ones
				}
			});

			if (remainingInstancesCount === 0) {
				// No instances left - delete the template
				logger.info(
					`Cleaning up template ${parentTaskId} - all instances have been permanently deleted`
				);

				try {
					await prisma.task.delete({
						where: { id: parentTaskId }
					});
					logger.info(`Successfully deleted orphaned template ${parentTaskId}`);
				} catch (error: unknown) {
					logger.error(`Failed to delete orphaned template ${parentTaskId}:`, error);
					// Don't fail the main operation if template cleanup fails
				}
			}
		}

		return json({
			success: true,
			message: 'Task permanently deleted'
		});
	} catch (error: unknown) {
		logger.error('Permanent delete task error:', error);
		return json(
			{
				success: false,
				error: 'Internal server error'
			},
			{ status: 500 }
		);
	}
};
