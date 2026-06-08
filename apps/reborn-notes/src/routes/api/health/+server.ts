import { json } from '@sveltejs/kit';
import { prisma } from '@reborn/database';
import type { RequestHandler } from './$types';

declare const __APP_VERSION__: string;

// Lightweight reachability check. Skips the DB round-trip so the client-side
// connectivity probe stays fast and costs nothing beyond routing the request.
export const HEAD: RequestHandler = () => new Response(null, { status: 200 });

export const GET: RequestHandler = async () => {
	let dbStatus: 'ok' | 'error';

	try {
		await prisma.$queryRaw`SELECT 1`;
		dbStatus = 'ok';
	} catch {
		dbStatus = 'error';
	}

	return json({
		status: dbStatus === 'ok' ? 'ok' : 'degraded',
		version: __APP_VERSION__,
		timestamp: new Date().toISOString(),
		db: dbStatus
	});
};
