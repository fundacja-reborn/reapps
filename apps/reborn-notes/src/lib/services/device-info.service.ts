import { base } from '$app/paths';
import { cryptoManager } from '@reborn/crypto';
import { parseUserAgent, createLogger } from '@reborn/utils';

const logger = createLogger('Notes-DeviceInfoService');

/**
 * Encrypt the current browser's parsed User-Agent string and send it
 * to the server via PATCH /api/auth/sessions/current.
 *
 * Called once after E2E unlock (login, 2FA, or screen-lock unlock)
 * to fill in the device_info_encrypted field that was left null at session creation.
 *
 * Non-critical — failures are logged but never block the user flow.
 */
export async function sendEncryptedDeviceInfo(): Promise<void> {
  if (!cryptoManager.isInitialized()) {
    logger.warn('CryptoManager not initialized, skipping device info encryption');
    return;
  }

  try {
    const label = parseUserAgent(navigator.userAgent);
    const encrypted = await cryptoManager.encryptText(label);

    const accessToken = localStorage.getItem('access_token');
    if (!accessToken) {
      logger.warn('No access token, skipping device info PATCH');
      return;
    }

    const res = await fetch(`${base}/api/auth/sessions/current`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify({ device_info_encrypted: encrypted })
    });

    if (!res.ok) {
      logger.warn('Failed to PATCH device info:', res.status);
    }
  } catch (err: unknown) {
    logger.warn('sendEncryptedDeviceInfo error:', err);
  }
}
