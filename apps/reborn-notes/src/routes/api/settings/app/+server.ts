import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '@reborn/database';
import {
  handleUpdateSettings,
  type AppScope,
  type SettingsDbClient
} from '@reborn/auth/server';
import { getUserFromToken } from '$lib/server/auth';

// Hardcoded server-side: a Notes client cannot write the Task scope even if
// it crafts a request to this endpoint (defence in depth).
const APP_SCOPE: AppScope = 'app:reborn-notes';

export const PUT: RequestHandler = async ({ request }) => {
  const userId = await getUserFromToken(request.headers.get('authorization'));
  if (!userId) {
    return json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const result = await handleUpdateSettings(
    userId,
    APP_SCOPE,
    body,
    prisma as unknown as SettingsDbClient
  );
  return json(result.body, { status: result.status });
};
