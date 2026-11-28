/**
 * `@reborn/platform/native` - the Capacitor side of the platform layer,
 * shared by the re/notes and re/task shells.
 *
 * Flag-free: nothing here reads `__REBORN_NATIVE__` / `__REBORN_DESKTOP__`.
 * Each app keeps thin `$lib` wrappers that pick the implementation for its
 * build (web, Capacitor, or - in re/notes - the desktop shell), so the
 * selection stays a constant the bundler folds and the web bundle drops this
 * entry. Plugin packages the functions load must also be dependencies of the
 * app itself: `cap sync` registers native plugins from the app's package.json.
 */
export { createCapacitorPlatform } from './platform';
export {
  BIOMETRY_TYPE,
  getCapacitorBiometryStatus,
  NO_BIOMETRY,
  promptCapacitorBiometric,
  toBiometryKind,
  type BiometricAuthResult,
  type BiometricPromptOptions,
  type BiometryKind,
  type BiometryStatus
} from './biometric-auth';
export {
  createCapacitorSecureStorage,
  KEYCHAIN_ACCESS_WHEN_UNLOCKED_THIS_DEVICE_ONLY
} from './secure-storage';
export {
  clearRefreshToken,
  createSecureStorageMasterKeyVault,
  persistRefreshToken,
  readRefreshToken,
  type SecureMasterKeyVault,
  type SecureStorageGetter
} from './secure-items';
export {
  applyCapacitorStatusBarStyle,
  blobToBase64,
  copyTextCapacitor,
  EXPORT_SUBDIR,
  getCapacitorAppInfo,
  hideCapacitorSplash,
  shareFileFromCache,
  shareLinkCapacitor,
  type CapacitorAppInfo,
  type ShareLinkOptions
} from './shell';
