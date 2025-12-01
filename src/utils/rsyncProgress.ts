/**
 * Rsync Progress Tracking Types
 *
 * Provides typed interfaces for real-time rsync progress reporting.
 */

/**
 * Progress data passed to callbacks during rsync operations
 */
export interface RsyncProgressData {
  /** Number of files transferred so far */
  filesTransferred: number
  /** Total estimated files (0 if estimation failed) */
  totalFiles: number
  /**
   * Percentage complete (0-100 with one decimal place, or undefined if no total)
   * Example: 45.5 means 45.5% complete
   */
  percentage?: number
}

/**
 * Callback signature for rsync progress updates
 */
export type RsyncProgressCallback = (progress: RsyncProgressData) => void
