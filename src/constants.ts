/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Default configuration values for the sync engine
 */

/**
 * Number of events before triggering a baseline update
 * @default 15
 */
export const DEFAULT_BASELINE_THRESHOLD = 15

/**
 * Number of syncs between garbage collection runs
 * @default 10
 */
export const DEFAULT_GC_FREQUENCY = 10

/**
 * Maximum size for a shard in bytes (7KB to leave safety margin under 8KB limit)
 * @default 7168
 */
export const MAX_SHARD_SIZE = 7 * 1024

/**
 * Timeout for inactive devices in milliseconds
 * @default 5184000000 (60 days)
 */
export const DEFAULT_INACTIVE_DEVICE_TIMEOUT = 60 * 24 * 60 * 60 * 1000

/**
 * Enable automatic removal of inactive devices during GC
 * @default false
 */
export const DEFAULT_REMOVE_INACTIVE_DEVICES = false
