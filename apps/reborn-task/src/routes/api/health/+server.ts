import { json } from '@sveltejs/kit';
import { prisma } from '@reborn/database';
import type { RequestHandler } from './$types';

declare const __APP_VERSION__: string;

export const GET: RequestHandler = async () => {
	let dbStatus = 'unknown';

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
