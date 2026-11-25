import { describe, expect, it, vi } from 'vitest';
import { parseAppConfig } from '@reborn/platform';

const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));

async function getConfig(): Promise<{ success: boolean; data: Record<string, unknown> }> {
	const { GET } = await import('./+server');
	const response = await (GET as unknown as () => Response)();
	return response.json();
}

describe('GET /api/app-config (reborn-task)', () => {
	it('enforces nothing when no TASK_NATIVE_* variable is set', async () => {
		const body = await getConfig();
		expect(body.success).toBe(true);
		expect(body.data.native).toEqual({
			android: { min_build: 0, recommended_build: 0, store_url: null },
			ios: { min_build: 0, recommended_build: 0, store_url: null }
		});
		expect(typeof body.data.version).toBe('string');
	});

	it('reads the task-prefixed thresholds, not the re/notes ones', async () => {
		env.NATIVE_MIN_BUILD_ANDROID = '99';
		env.TASK_NATIVE_MIN_BUILD_ANDROID = '3';
		env.TASK_NATIVE_RECOMMENDED_BUILD_IOS = '7';
		env.TASK_NATIVE_STORE_URL_IOS = 'https://apps.apple.com/app/id1';
		const body = await getConfig();
		expect(parseAppConfig(body, 'android')).toEqual({
			minBuild: 3,
			recommendedBuild: 0,
			storeUrl: null
		});
		expect(parseAppConfig(body, 'ios')).toEqual({
			minBuild: 0,
			recommendedBuild: 7,
			storeUrl: 'https://apps.apple.com/app/id1'
		});
	});
});
