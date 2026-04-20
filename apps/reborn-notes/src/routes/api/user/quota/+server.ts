import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getUserFromToken } from '$lib/server/auth';
import { getQuotaInfo } from '$lib/server/storage-quota';

/** GET /api/user/quota — returns storage usage and limit for the authenticated user. */
export const GET: RequestHandler = async ({ request }) => {
  try {
    const userId = await getUserFromToken(request.headers.get('authorization'));
    if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const quota = await getQuotaInfo(userId);

    return json({
      success: true,
      data: {
        used_bytes: quota.used,
        limit_bytes: quota.limit,
        usage_percent: quota.percent
      }
    });
  } catch {
    return json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
};
