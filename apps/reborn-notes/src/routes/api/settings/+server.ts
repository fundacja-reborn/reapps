import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '@reborn/database';
import { handleGetSettings, type AppScope, type SettingsDbClient } from '@reborn/auth/server';
import { getUserFromToken } from '$lib/server/auth';

const APP_SCOPE: AppScope = 'app:reborn-notes';

export const GET: RequestHandler = async ({ request }) => {
  const userId = await getUserFromToken(request.headers.get('authorization'));
  if (!userId) {
    return json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const result = await handleGetSettings(userId, APP_SCOPE, prisma as unknown as SettingsDbClient);
  return json(result.body, { status: result.status });
};
