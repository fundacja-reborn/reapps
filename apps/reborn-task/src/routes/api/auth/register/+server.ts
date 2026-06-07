import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import {
	handleE2ERegister,
	createDefaultHandlerOptions,
	REFRESH_TOKEN_TTL_SECONDS
} from '@reborn/auth/server';
import { prisma } from '@reborn/database';
import { createLogger } from '@reborn/utils';

const logger = createLogger('AuthRegister');

/**
 * POST /api/auth/register
 * Handle E2E user registration with client-side hashed password
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	try {
		// Parse request body
		const data = await request.json();

		// Use default handler options with internal implementations
		const handlerOptions = createDefaultHandlerOptions({
			user: prisma.user,
			refreshToken: prisma.refreshToken,
			taskList: prisma.taskList
		});

		// Call the E2E-specific handler
		const result = await handleE2ERegister(data, handlerOptions);

		// Return appropriate response
		if (result.success && result.data) {
			// Set HTTP-only cookie for refresh token
			cookies.set('refresh_token', result.data.refreshToken!, {
				httpOnly: true,
				secure: process.env.NODE_ENV === 'production',
				sameSite: 'lax',
				maxAge: REFRESH_TOKEN_TTL_SECONDS,
				path: '/'
			});

			// Return response with proper field names for frontend compatibility
			const { refreshToken, accessToken, ...responseData } = result.data;
			return json(
				{
					success: true,
					data: {
						...responseData,
						access_token: accessToken
						// refresh_token is sent exclusively via httpOnly cookie — never in response body
					}
				},
				{ status: 201 }
			);
		} else {
			return json({ error: result.error }, { status: 400 });
		}
	} catch (error: unknown) {
		logger.error('Registration endpoint error:', error);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
