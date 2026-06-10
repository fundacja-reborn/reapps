import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createLogger } from '@reborn/utils';
import { handleRefreshToken, createDefaultHandlerOptions } from '@reborn/auth/server';
import { prisma } from '@reborn/database';

const logger = createLogger('NotesAuthRefreshNative');

/**
 * POST /api/auth/refresh-native - access-token refresh for the native (Capacitor) client.
 *
 * The native shell cannot use the httpOnly `refresh_token` cookie the web client
 * relies on: it loads cross-origin, where a `SameSite=Lax` cookie is never sent.
 * Instead the native client holds the refresh token in device secure storage
 * (Keychain / Keystore) and presents it in the request BODY here; on success the
 * rotated token comes back in the body for the client to re-persist. Rotation
 * and token-family reuse detection are identical to the web `/auth/refresh`
 * (same `handleRefreshToken`) - only the transport differs.
 *
 * Security model (see native-faza2-plan.md "sekcja bezpieczeństwa"):
 *  - The token is read ONLY from the body, never from a cookie. A web-origin XSS
 *    attacker cannot read the httpOnly cookie, so it cannot supply a valid token
 *    here - the cookie-based web session stays protected and this endpoint adds
 *    no exfiltration path for web.
 *  - No cookie is set. Native auth state lives entirely in the body round-trip +
 *    secure storage; nothing is parked in the native HTTP cookie jar.
 *  - The web `/auth/refresh` endpoint is a SEPARATE handler and is left untouched,
 *    so there is zero regression risk to the web refresh path (B1 - osobny endpoint).
 */
export const POST: RequestHandler = async ({ request }) => {
  try {
    let body: { refresh_token?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ success: false, error: 'Invalid request body' }, { status: 400 });
    }

    const refreshToken = body?.refresh_token;
    if (!refreshToken || typeof refreshToken !== 'string') {
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
      const { refreshToken: newRefreshToken, accessToken, ...responseData } = result.data;
      return json({
        success: true,
        data: {
          ...responseData,
          access_token: accessToken,
          // Unlike the web endpoint, the rotated refresh token IS returned here -
          // the native client persists it in secure storage for the next refresh.
          refresh_token: newRefreshToken
        }
      });
    }

    return json(
      { success: false, error: result.error || 'Token refresh failed' },
      { status: 401 }
    );
  } catch (error: unknown) {
    logger.error('Native token refresh error:', error);
    return json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
};
