/**
 * Framework-agnostic handlers for E2E synced user settings.
 *
 * Server only ever sees ciphertext + scope + updated_at. Bundle values are
 * decrypted client-side with the user's master key. Conflict resolution is
 * last-write-wins on `updated_at` per scope.
 *
 * Scopes:
 *   - 'shared'           — cross-app preferences (language, dateFormat, …)
 *   - 'app:reborn-task'  — Task-only preferences
 *   - 'app:reborn-notes' — Notes-only preferences
 */

import { createLogger } from '@reborn/utils';
import { isValidEncryptedFormat } from '@reborn/crypto';
import { schemas, validateBody } from '@reborn/types';

interface SettingsBundleBody {
  settings_encrypted: string;
  updated_at: string;
}

const logger = createLogger('SettingsHandlers');

export const SCOPE_SHARED = 'shared' as const;
export type AppScope = `app:${string}`;
export type SettingsScope = typeof SCOPE_SHARED | AppScope;

export interface SettingsBundleRow {
  settings_encrypted: string;
  updated_at: string;
}

export interface SettingsGetResponse {
  shared: SettingsBundleRow | null;
  app: SettingsBundleRow | null;
}

/**
 * Minimal Prisma client interface needed by the handlers — abstracts over
 * `prisma.userSettings` so this module does not depend on `@reborn/database`.
 */
export interface SettingsDbClient {
  userSettings: {
    findFirst: (args: {
      where: { user_id: string; scope: string };
    }) => Promise<{ settings_encrypted: string; updated_at: Date } | null>;
    findMany: (args: {
      where: { user_id: string; scope: { in: string[] } };
    }) => Promise<Array<{ scope: string; settings_encrypted: string; updated_at: Date }>>;
    upsert: (args: {
      where: { user_id_scope: { user_id: string; scope: string } };
      create: {
        user_id: string;
        scope: string;
        settings_encrypted: string;
        updated_at: Date;
      };
      update: { settings_encrypted: string; updated_at: Date };
    }) => Promise<{ settings_encrypted: string; updated_at: Date }>;
  };
}

export type SettingsHandlerResult<T> =
  | { status: number; body: { success: true; data: T } }
  | { status: number; body: { success: false; error: string; code?: string; current?: SettingsBundleRow } };

/**
 * GET /api/settings handler — returns current shared + per-app bundles.
 *
 * Response shape: `{ shared: SettingsBundleRow | null, app: SettingsBundleRow | null }`.
 * `null` means "no row yet for this scope" — the client should bootstrap with
 * its local IndexedDB state.
 */
export async function handleGetSettings(
  userId: string,
  appScope: AppScope,
  db: SettingsDbClient
): Promise<SettingsHandlerResult<SettingsGetResponse>> {
  try {
    const rows = await db.userSettings.findMany({
      where: { user_id: userId, scope: { in: [SCOPE_SHARED, appScope] } }
    });

    let shared: SettingsBundleRow | null = null;
    let app: SettingsBundleRow | null = null;
    for (const row of rows) {
      const wire: SettingsBundleRow = {
        settings_encrypted: row.settings_encrypted,
        updated_at: row.updated_at.toISOString()
      };
      if (row.scope === SCOPE_SHARED) shared = wire;
      else if (row.scope === appScope) app = wire;
    }

    return { status: 200, body: { success: true, data: { shared, app } } };
  } catch (err: unknown) {
    logger.error('Get settings failed', err);
    return { status: 500, body: { success: false, error: 'Internal server error' } };
  }
}

/**
 * Validate and normalize the PUT body. Encryption Guard runs here — values
 * not matching `iv:ciphertext` base64 format are rejected before any DB write.
 */
function validateBundleBody(body: unknown):
  | { ok: true; data: SettingsBundleBody }
  | { ok: false; status: number; error: string } {
  const parsed = validateBody(schemas.SettingsBundleBodySchema, body);
  if (!parsed.success) {
    return { ok: false, status: 400, error: 'Invalid request body' };
  }
  if (!isValidEncryptedFormat(parsed.data.settings_encrypted)) {
    return {
      ok: false,
      status: 400,
      error: 'Invalid encrypted format (expected iv:ciphertext base64)'
    };
  }
  return { ok: true, data: parsed.data };
}

/**
 * PUT /api/settings/{shared|app} handler — last-write-wins upsert by `updated_at`.
 *
 * On stale write (server's `updated_at` is newer than client's), returns 409
 * with the current server bundle so the client can pull, merge, and retry.
 */
export async function handleUpdateSettings(
  userId: string,
  scope: SettingsScope,
  body: unknown,
  db: SettingsDbClient
): Promise<SettingsHandlerResult<SettingsBundleRow>> {
  const validation = validateBundleBody(body);
  if (!validation.ok) {
    return { status: validation.status, body: { success: false, error: validation.error } };
  }

  const clientUpdatedAt = new Date(validation.data.updated_at);
  if (Number.isNaN(clientUpdatedAt.getTime())) {
    return { status: 400, body: { success: false, error: 'Invalid updated_at' } };
  }

  try {
    const existing = await db.userSettings.findFirst({
      where: { user_id: userId, scope }
    });

    if (existing && existing.updated_at.getTime() > clientUpdatedAt.getTime()) {
      return {
        status: 409,
        body: {
          success: false,
          error: 'Conflict: server has a newer version',
          code: 'CONFLICT',
          current: {
            settings_encrypted: existing.settings_encrypted,
            updated_at: existing.updated_at.toISOString()
          }
        }
      };
    }

    const saved = await db.userSettings.upsert({
      where: { user_id_scope: { user_id: userId, scope } },
      create: {
        user_id: userId,
        scope,
        settings_encrypted: validation.data.settings_encrypted,
        updated_at: clientUpdatedAt
      },
      update: {
        settings_encrypted: validation.data.settings_encrypted,
        updated_at: clientUpdatedAt
      }
    });

    return {
      status: 200,
      body: {
        success: true,
        data: {
          settings_encrypted: saved.settings_encrypted,
          updated_at: saved.updated_at.toISOString()
        }
      }
    };
  } catch (err: unknown) {
    logger.error('Update settings failed', { scope, err });
    return { status: 500, body: { success: false, error: 'Internal server error' } };
  }
}
