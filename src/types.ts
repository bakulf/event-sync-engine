/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  DEFAULT_BASELINE_THRESHOLD,
  DEFAULT_GC_FREQUENCY,
} from './constants.js'

/**
 * Core event structure
 */
export interface Event<TData = any> {
  increment: number
  hlc_time: number
  hlc_counter: number
  op: Operation<TData>
}

/**
 * Operation within an event
 * Note: data is serialized as JSON string internally, but typed as TData for type safety
 */
export interface Operation<TData = any> {
  type: string
  data?: TData         // Present if not chunked (deserialized for handlers, serialized internally)
  chunks?: number      // Number of chunks (if chunked)
  fromChunk?: number   // Starting chunk offset in shard (if chunked)
}

/**
 * Meta key structure (m_<UUID>)
 */
export interface Meta {
  version: number          // Protocol version (required for all new Meta)
  last_increment: number
  shards: number[]
}

/**
 * Baseline structure (b_<UUID>)
 * Note: state is serialized as JSON string internally, but typed as TState for type safety
 */
export interface Baseline<TState = any> {
  includes: Record<string, number>  // device_id -> last_increment
  chunks?: number  // Present if state is chunked
  state?: TState   // Present if not chunked (deserialized for handlers, serialized internally)
}

/**
 * Seen vector with activity tracking (s_<UUID>)
 */
export interface SeenVector {
  increments: Record<string, number>
  lastActive: number
}

/**
 * Storage adapter interface
 */
export interface StorageAdapter {
  get(key: string): Promise<any | undefined>
  set(items: Record<string, any>): Promise<void>
  remove(keys: string[]): Promise<void>
  getAll(pattern: string): Promise<Record<string, any>>
  onChange(callback: (changes: KeyChange[]) => void): void
  cleanup(): void
}

/**
 * Storage change notification
 */
export interface KeyChange {
  key: string
  oldValue?: any
  newValue?: any
}

/**
 * Sync engine configuration
 */
export interface SyncConfig {
  baselineThreshold?: number          // Events before baseline update (default: DEFAULT_BASELINE_THRESHOLD)
  gcFrequency?: number                 // Syncs between GC runs (default: DEFAULT_GC_FREQUENCY)
  debug?: boolean                      // Enable debug logging (default: false)
  removeInactiveDevices?: boolean      // Enable inactive device removal (default: DEFAULT_REMOVE_INACTIVE_DEVICES)
  inactiveDeviceTimeout?: number       // Milliseconds before device is inactive (default: DEFAULT_INACTIVE_DEVICE_TIMEOUT)
}

/**
 * Result of a sync operation
 */
export interface SyncResult {
  eventsApplied: number
}

/**
 * Debug information about sync engine state
 */
export interface DebugInfo {
  currentDevice: {
    deviceId: string
    lastIncrement: number
    hlc: { time: number; counter: number }
    currentShard: number
    eventsSinceBaseline: number
    syncsSinceGC: number
  }
  devices: Array<{
    deviceId: string
    lastIncrement: number
    shards: number[]
    hasBaseline: boolean
  }>
  events: Array<{
    deviceId: string
    increment: number
    type: string
    hlc: { time: number; counter: number }
    data: any
  }>
  totalEvents: number
  knownIncrements: Record<string, number>
}

/**
 * Event handler callback
 * Notifies application of remote events to apply
 * Can be sync or async
 */
export type EventHandler<TEventData> = (
  event: Event<TEventData>
) => void | Promise<void>

/**
 * Baseline snapshot callback
 * Returns baseline data (will be automatically serialized)
 * Can be sync or async
 */
export type BaselineHandler<TState> = () =>
  | TState
  | Promise<TState>

/**
 * Baseline load callback
 * Receives deserialized baseline state
 * Can be sync or async
 */
export type BaselineLoadHandler<TState> = (
  state: TState
) => void | Promise<void>

/**
 * Device state (in-memory, partially persisted to m_<UUID>)
 */
export interface DeviceState {
  device_id: string
  last_increment: number
  hlc_time: number
  hlc_counter: number
  current_shard: number
  events_since_baseline_update: number
  syncs_since_gc: number
}

/**
 * Known increments (in-memory, persisted to s_<UUID>)
 */
export type KnownIncrements = Record<string, number>
