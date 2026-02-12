/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { MAX_SHARD_SIZE } from './constants.js'
import type { Event } from './types.js'

/**
 * Manages event sharding to respect storage.sync 8KB per-key limit
 */
export class ShardManager {
  private currentShard: number
  private activeShards: Set<number>

  constructor(existingShards: number[] = [0]) {
    // Current shard is always the maximum of existing shards
    this.currentShard = Math.max(...existingShards)
    this.activeShards = new Set(existingShards)
  }

  /**
   * Get current shard index for writing
   */
  getCurrentShard(): number {
    return this.currentShard
  }

  /**
   * Get all active shard indices
   */
  getActiveShards(): number[] {
    return Array.from(this.activeShards).sort((a, b) => a - b)
  }

  /**
   * Check if events array should be moved to a new shard
   * Returns true if a new shard should be created
   */
  shouldCreateNewShard<T>(events: Event<T>[]): boolean {
    const estimatedSize = this.estimateSize(events)
    return estimatedSize >= MAX_SHARD_SIZE
  }

  /**
   * Check if a single event exceeds maximum shard size
   * Throws error if event is too large to ever fit in a shard
   */
  validateEventSize<T>(event: Event<T>): void {
    const eventSize = this.estimateSize([event])
    if (eventSize >= MAX_SHARD_SIZE) {
      throw new Error(`Event size (${eventSize} bytes) exceeds maximum shard size (${MAX_SHARD_SIZE} bytes)`)
    }
  }

  /**
   * Create a new shard and return its index
   */
  createNewShard(): number {
    this.currentShard++
    this.activeShards.add(this.currentShard)
    return this.currentShard
  }

  /**
   * Estimate the serialized size of events array in bytes
   * Uses JSON serialization as approximation
   */
  private estimateSize<T>(events: Event<T>[]): number {
    try {
      const json = JSON.stringify(events)
      // UTF-16 strings use 2 bytes per character in worst case
      return json.length * 2
    } catch (e) {
      // If serialization fails, assume it's large
      return MAX_SHARD_SIZE
    }
  }
}
