/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

export { SyncEngine } from './SyncEngine.js'
export { HLC } from './HLC.js'
export { ShardManager } from './ShardManager.js'

export { MemoryStorage } from './MemoryStorage.js'
export { WebExtStorageAdapter } from './WebExtStorageAdapter.js'

export {
  DEFAULT_BASELINE_THRESHOLD,
  DEFAULT_GC_FREQUENCY,
  MAX_SHARD_SIZE,
} from './constants.js'

export type {
  StorageAdapter,
  Event,
  Operation,
  Meta,
  Baseline,
  SeenVector,
  SyncConfig,
  SyncResult,
  DebugInfo,
  EventHandler,
  BaselineHandler,
  BaselineLoadHandler,
  KeyChange,
  DeviceState,
  KnownIncrements,
} from './types.js'
