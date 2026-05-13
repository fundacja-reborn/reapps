import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createLogger } from '@reborn/utils';
import { handleRefreshToken, createDefaultHandlerOptions } from '@reborn/auth/server';
import { prisma } from '@reborn/database';

const logger = createLogger('NotesAuthRefresh');

// CONTRACT: `cookies.get('refresh_token')` returns the value after
// `cookie.parse()` (the override-pinned `cookie@0.7.2` package). That parser:
//   - strips a pair of surrounding `"` (RFC 6265 quoted-string), and
//   - runs `decodeURIComponent` on any value containing `%` (falling back to
//     the raw string if the decode throws).
// The returned value is passed 1:1 into `findUnique({ where: { token } })`,
// so the DB row must hold exactly the string that `cookies.set(name, value)`
// originally serialized. A parser regression (e.g. cookie@1.x stopped
// auto-unquoting) silently invalidates every existing session.
// Round-trip test: ./server.spec.ts (covers 4 variants - baseline, `=`
// padding, surrounding quotes, URL-encoded `%20`).
export const POST: RequestHandler = async ({ cookies }) => {
  try {
    // Read refresh token exclusively from httpOnly cookie - never from request body.
    // This ensures the token is not exposed to client-side JS (XSS protection).
    const refreshToken = cookies.get('refresh_token');

    if (!refreshToken) {
      return json({ success: false, error: 'No refresh token provided' }, { status: 401 });
    }

    const result = await handleRefreshToken(
      { refresh_token: refreshToken },
      createDefaultHandlerOptions({
        user: prisma.user,
        refreshToken: prisma.refreshToken
      })
    );

    if (result.success && result.data?.refreshToken) {
      cookies.set('refresh_token', result.data.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7,
        path: '/'
      });

      const { refreshToken: newRefreshToken, accessToken, ...responseData } = result.data;
      return json({
        success: true,
        data: {
          ...responseData,
          access_token: accessToken
          // refresh_token is sent exclusively via httpOnly cookie — never in response body
        }
      });
    } else {
      return json(
        { success: false, error: result.error || 'Token refresh failed' },
        { status: 401 }
      );
    }
  } catch (error: unknown) {
    logger.error('Token refresh error:', error);
    return json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
};
