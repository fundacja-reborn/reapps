export type {
  BackButtonOutcome,
  NativeSecureStorage,
  NetworkState,
  NetworkStatus,
  Platform,
  PlatformBackButton,
  PlatformDeepLinks,
  PlatformLifecycle,
  PlatformNetwork,
  WebPlatformOptions
} from './types';
export { createWebPlatform } from './web';
export { copyTextWeb } from './clipboard';
export {
  defaultStoreUrl,
  desktopUpdatePlatform,
  evaluateUpdateSeverity,
  parseAppConfig,
  type NativePlatform,
  type NativeUpdateConfig,
  type UpdateSeverity
} from './app-update';
export { parseBackendVersion } from './app-version';
export { shareDeepLinkToRoute, shareViewExit, type ShareViewExit } from './deep-link';
