import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import {
  handleE2ERegister,
  createDefaultHandlerOptions,
  REFRESH_TOKEN_TTL_SECONDS
} from '@reborn/auth/server';
import { prisma } from '@reborn/database';
import { isNativeClient } from '$lib/utils/native-client';
import { createLogger } from '@reborn/utils';

const logger = createLogger('Notes-Register');

/**
 * POST /api/auth/register
 * Handle E2E user registration with client-side hashed password.
 * Identical to reborn-task — both apps share the same PostgreSQL database and user table.
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
  try {
    const data = await request.json();

    const handlerOptions = createDefaultHandlerOptions({
      user: prisma.user,
      refreshToken: prisma.refreshToken,
      taskList: prisma.taskList
    });

    const result = await handleE2ERegister(data, handlerOptions);

    if (result.success && result.data) {
      if (result.data.refreshToken) {
        cookies.set('refresh_token', result.data.refreshToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: REFRESH_TOKEN_TTL_SECONDS,
          path: '/'
        });
      }

      const { refreshToken, accessToken, ...responseData } = result.data;
      const responseBody: Record<string, unknown> = {
        ...responseData,
        access_token: accessToken
        // Web: refresh_token is sent exclusively via httpOnly cookie, never in the body.
      };
      // Native client persists the refresh token in secure storage (cross-origin
      // cannot use the httpOnly cookie). Gated by the native header -> web stays
      // byte-identical. See $lib/utils/native-client.
      if (isNativeClient(request)) {
        responseBody.refresh_token = refreshToken;
      }
      return json({ success: true, data: responseBody }, { status: 201 });
    } else {
      return json({ error: result.error }, { status: 400 });
    }
  } catch (error: unknown) {
    logger.error('Registration endpoint error:', error);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
};
