import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import { GeneratedQuery, CollectedQuery } from '../types';

/**
 * State information for tracking query generation progress
 * 
 * Used to persist and restore generation progress across interruptions,
 * enabling resumable builds for large query sets.
 */
export interface ProgressState {
  /** Total number of queries to generate */
  totalQueries: number;
  /** Successfully generated queries */
  completedQueries: GeneratedQuery[];
  /** IDs of queries that failed generation */
  failedQueries: string[];
  /** Queries remaining to be processed */
  remainingQueries: CollectedQuery[];
  /** Total tokens consumed so far */
  totalTokens: number;
  /** Timestamp when progress was saved */
  timestamp: number;
}

/**
 * Progress tracker for resumable query generation
 * 
 * Provides functionality to save and restore generation progress, enabling:
 * - Resumable builds after interruption
 * - Progress persistence across sessions
 * - Recovery from partial failures
 * 
 * Progress is stored in a JSON file and automatically expires after 1 hour
 * to prevent stale state from interfering with fresh builds.
 * 
 * Features:
 * - Automatic progress file management
 * - Timestamp-based expiration
 * - Graceful error handling
 * - Progress validation and cleanup
 */
export class ProgressTracker {
  private progressFile: string;

  /**
   * Create a new progress tracker
   * 
   * @param outputDir - Directory where progress file will be stored
   */
  constructor(outputDir: string) {
    this.progressFile = resolve(outputDir, '.drizzle-llm-progress.json');
  }

  /**
   * Save current generation progress to disk
   * 
   * Persists the current state including completed queries, failures,
   * and remaining work. This enables resuming generation after interruption.
   * 
   * @param state - Current progress state to save
   * 
   * @example
   * ```typescript
   * const state: ProgressState = {
   *   totalQueries: 100,
   *   completedQueries: generatedSoFar,
   *   failedQueries: ['q1', 'q5'],
   *   remainingQueries: stillToProcess,
   *   totalTokens: 15000,
   *   timestamp: Date.now()
   * };
   * tracker.saveProgress(state);
   * ```
   */
  saveProgress(state: ProgressState): void {
    try {
      writeFileSync(this.progressFile, JSON.stringify(state, null, 2), 'utf8');
    } catch (error) {
      console.warn('⚠️  Failed to save progress:', error);
    }
  }

  /**
   * Load previously saved progress from disk
   * 
   * Attempts to restore a previous generation session. Returns null if:
   * - No progress file exists
   * - Progress file is corrupted
   * - Progress is older than 1 hour (considered stale)
   * 
   * @returns Previous progress state or null if not available
   * 
   * @example
   * ```typescript
   * const progress = tracker.loadProgress();
   * if (progress) {
   *   console.log(`Resuming from ${progress.completedQueries.length} completed queries`);
   * } else {
   *   console.log('Starting fresh generation');
   * }
   * ```
   */
  loadProgress(): ProgressState | null {
    try {
      if (!existsSync(this.progressFile)) {
        return null;
      }

      const content = readFileSync(this.progressFile, 'utf8');
      const state = JSON.parse(content) as ProgressState;
      
      // Check if progress is recent (within last hour)
      const ageMinutes = (Date.now() - state.timestamp) / (1000 * 60);
      if (ageMinutes > 60) {
        console.log('⏰ Progress file is older than 1 hour, starting fresh...');
        this.clearProgress();
        return null;
      }

      return state;
    } catch (error) {
      console.warn('⚠️  Failed to load progress:', error);
      return null;
    }
  }

  /**
   * Clear saved progress by deleting the progress file
   * 
   * Used to start fresh generation or clean up after completion.
   * Handles file deletion errors gracefully.
   */
  clearProgress(): void {
    try {
      if (existsSync(this.progressFile)) {
        unlinkSync(this.progressFile);
      }
    } catch (error) {
      console.warn('⚠️  Failed to clear progress:', error);
    }
  }

  /**
   * Check if a progress file exists
   * 
   * Quick check to determine if there might be resumable progress available.
   * Note: This doesn't validate the progress file content or expiration.
   * 
   * @returns True if progress file exists, false otherwise
   */
  hasProgress(): boolean {
    return existsSync(this.progressFile);
  }
}