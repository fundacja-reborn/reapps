/**
 * @reborn/backup - automated Zero-Knowledge backup logic.
 *
 * Platform-agnostic, dependency-light core for the auto-backup feature (see
 * reapps-docs `planning/auto-backup-zk.md`): scheduling cadence, GFS retention,
 * content-free filenames and a fully dependency-injected orchestrator. Kept as
 * its own package - rather than buried in @reborn/utils - so this
 * security-relevant subsystem has a clear, auditable boundary. Crypto lives in
 * @reborn/crypto; this package stays crypto / store / platform free and the apps
 * inject those adapters.
 */
export * from './auto-backup';
export * from './auto-backup-runner';
