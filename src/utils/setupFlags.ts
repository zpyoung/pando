import type { LoadedPandoConfig } from '../config/loader.js'

export type SetupFlagWarn = (message: string) => void

/**
 * Apply the shared rsync / symlink / ports flag overrides onto a loaded config.
 * Used by both `pando add` and `pando adopt` so the two commands interpret the
 * same flags identically. Mutates `config` in place.
 *
 * @param config - Loaded, merged config to mutate
 * @param flags - Parsed command flags (erased to Record for cross-command reuse)
 * @param warn - Sink for non-fatal flag-coordination warnings
 */
export function applySetupFlagOverrides(
  config: LoadedPandoConfig,
  flags: Record<string, unknown>,
  warn: SetupFlagWarn
): void {
  if (flags['skip-rsync']) {
    config.rsync.enabled = false
    // Warn if rsync-specific flags were provided alongside --skip-rsync
    if (flags['rsync-flags'] || flags['rsync-exclude']) {
      warn('--rsync-flags and --rsync-exclude are ignored when --skip-rsync is set')
    }
  }
  if (flags['rsync-flags']) {
    const rsyncFlags = flags['rsync-flags'] as string[]
    config.rsync.flags = rsyncFlags.flatMap((f) => f.split(','))
  }
  if (flags['rsync-exclude']) {
    const rsyncExclude = flags['rsync-exclude'] as string[]
    config.rsync.exclude = [...config.rsync.exclude, ...rsyncExclude.flatMap((e) => e.split(','))]
  }
  if (flags['skip-symlink']) {
    config.symlink.patterns = []
  }
  if (flags.symlink) {
    const symlinkPatterns = flags.symlink as string[]
    config.symlink.patterns = symlinkPatterns.flatMap((s) => s.split(','))
  }
  if (flags['absolute-symlinks']) {
    config.symlink.relative = false
  }
  if (flags.ports) {
    config.ports.enabled = true
  }
}
