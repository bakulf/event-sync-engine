/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { HLC } from './HLC.js'
import { ShardManager } from './ShardManager.js'
import {
  DEFAULT_BASELINE_THRESHOLD,
  DEFAULT_GC_FREQUENCY,
  DEFAULT_INACTIVE_DEVICE_TIMEOUT,
  DEFAULT_REMOVE_INACTIVE_DEVICES,
  PROTOCOL_VERSION,
} from './constants.js'
import type {
  StorageAdapter,
  SyncConfig,
  SyncResult,
  DebugInfo,
  EventHandler,
  BaselineHandler,
  BaselineLoadHandler,
  Event,
  Meta,
  Baseline,
  SeenVector,
  DeviceState,
  KnownIncrements,
} from './types.js'

/**
 * Main sync engine
 * Orchestrates event recording, syncing, and state management
 */
export class SyncEngine<TState = any, TEventData = any> {
  private deviceId: string
  private storage: StorageAdapter
  private config: Required<SyncConfig>

  private hlc: HLC
  private shardManager: ShardManager
  private deviceState: DeviceState
  private knownIncrements: KnownIncrements = {}
  private lastActivityUpdate: number = 0

  private eventHandler: EventHandler<TEventData> | null = null
  private baselineHandler: BaselineHandler<TState> | null = null
  private baselineLoadHandler: BaselineLoadHandler<TState> | null = null

  private operationInProgress = false

  constructor(deviceId: string, storage: StorageAdapter, config: SyncConfig = {}) {
    this.deviceId = deviceId
    this.storage = storage
    this.config = {
      baselineThreshold: config.baselineThreshold ?? DEFAULT_BASELINE_THRESHOLD,
      gcFrequency: config.gcFrequency ?? DEFAULT_GC_FREQUENCY,
      debug: config.debug ?? false,
      removeInactiveDevices: config.removeInactiveDevices ?? DEFAULT_REMOVE_INACTIVE_DEVICES,
      inactiveDeviceTimeout: config.inactiveDeviceTimeout ?? DEFAULT_INACTIVE_DEVICE_TIMEOUT,
    }

    this.hlc = new HLC()
    this.shardManager = new ShardManager()
    this.deviceState = {
      device_id: deviceId,
      last_increment: 0,
      hlc_time: Date.now(),
      hlc_counter: 0,
      current_shard: 0,
      events_since_baseline_update: 0,
      syncs_since_gc: 0,
    }
  }

  /**
   * Check if a device ID already exists in sync storage
   * Useful for detecting if a device ID is being reused
   */
  static async deviceExists(
    deviceId: string,
    storage: StorageAdapter
  ): Promise<boolean> {
    const metaKey = `m_${deviceId}`
    const meta = await storage.get(metaKey)
    return !!meta
  }

  /**
   * Log helper that only logs when debug mode is enabled
   */
  private log(...args: any[]): void {
    if (this.config.debug) {
      console.log(...args)
    }
  }

  /**
   * Validate protocol version compatibility
   */
  private validateProtocolVersion(meta: Meta, deviceId: string): void {
    const version = meta.version ?? 1

    if (version < PROTOCOL_VERSION) {
      throw new Error(
        `Device ${deviceId} uses protocol version ${version}, ` +
        `which is older than the minimum supported version ${PROTOCOL_VERSION}`
      )
    }
  }

  /**
   * Storage set with automatic GC retry on quota errors
   */
  private async setWithGCRetry(items: Record<string, any>): Promise<void> {
    try {
      await this.storage.set(items)
    } catch (err: any) {
      if (err.message?.includes('Quota') || err.message?.includes('quota')) {
        this.log('[SyncEngine] Storage write failed: quota exceeded, running GC...')
        await this.performGC()
        this.log('[SyncEngine] Retrying write after GC...')
        await this.storage.set(items)
        this.log('[SyncEngine] Write succeeded after GC')
      } else {
        throw err
      }
    }
  }

  /**
   * Execute operation with exclusive lock
   */
  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    if (this.operationInProgress) {
      throw new Error('Operation already in progress')
    }
    this.operationInProgress = true
    try {
      return await operation()
    } finally {
      this.operationInProgress = false
    }
  }

  /**
   * Register event application handler
   * Called when remote events need to be applied to application state
   */
  onApplyEvent(handler: EventHandler<TEventData>): void {
    this.eventHandler = handler
  }

  /**
   * Register baseline creation handler
   */
  onCreateBaseline(handler: BaselineHandler<TState>): void {
    this.baselineHandler = handler
  }

  /**
   * Register baseline load handler
   */
  onApplyBaseline(handler: BaselineLoadHandler<TState>): void {
    this.baselineLoadHandler = handler
  }

  /**
   * Initialize the sync engine
   * Detects if this is first device ever, or needs to bootstrap
   */
  async initialize(): Promise<void> {
    await this.withLock(async () => {
      const allMeta = await this.storage.getAll('^m_')
      const metaKeys = Object.keys(allMeta)

      if (metaKeys.length === 0) {
        await this.initializeFirstDevice()
      } else {
        const ourMetaKey = `m_${this.deviceId}`
        const ourMeta = await this.storage.get(ourMetaKey)

        if (ourMeta) {
          await this.loadSyncMetadata(ourMeta)
        } else {
          await this.bootstrap(allMeta)
        }
      }
    })

    this.storage.onChange((changes) => this.onStorageChange(changes))
  }

  /**
   * Stop the sync engine and clean up resources
   * Removes storage change listeners
   */
  stop(): void {
    this.log('[SyncEngine] Stopping engine and cleaning up listeners')
    this.storage.cleanup()
  }

  /**
   * First device ever - create initial sync network
   * Creates only meta (m_X) and baseline (b_X), no events yet
   */
  private async initializeFirstDevice(): Promise<void> {
    this.log('[SyncEngine] First device ever, initializing...')

    const meta: Meta = {
      version: PROTOCOL_VERSION,
      last_increment: 0,
      shards: [0],
    }

    const baseline: Baseline<TState> = {
      includes: {},
      state: this.baselineHandler ? await this.baselineHandler() : {} as TState,
    }

    const now = Date.now()
    const seenVector: SeenVector = {
      increments: {},
      lastActive: now,
    }
    this.lastActivityUpdate = now

    await this.setWithGCRetry({
      [`m_${this.deviceId}`]: meta,
      [`b_${this.deviceId}`]: baseline,
      [`s_${this.deviceId}`]: seenVector,
    })

    this.log('[SyncEngine] First device initialized')
  }

  /**
   * Bootstrap from existing sync network
   */
  private async bootstrap(allMeta: Record<string, Meta>): Promise<void> {
    this.log('[SyncEngine] Bootstrapping from existing network...')

    // Validate all remote device versions first
    for (const [key, meta] of Object.entries(allMeta)) {
      const deviceId = key.replace('m_', '')
      this.validateProtocolVersion(meta, deviceId)
    }

    const deviceIds = Object.keys(allMeta).map((k) => k.replace('m_', ''))

    let baselineDevice: string | null = null
    for (const deviceId of deviceIds) {
      const baseline = await this.storage.get(`b_${deviceId}`)
      if (baseline) {
        baselineDevice = deviceId
        break
      }
    }

    let baseline: Baseline<TState> | null = null
    if (baselineDevice) {
      baseline = await this.storage.get(`b_${baselineDevice}`)
      if (baseline && this.baselineLoadHandler) {
        await this.baselineLoadHandler(baseline.state)
      }
    } else {
      this.log('[SyncEngine] No baseline found, will apply all events from scratch')
    }

    const allEvents: Array<Event<TEventData> & { deviceId: string }> = []

    for (const remoteDeviceId of deviceIds) {
      const meta: Meta = allMeta[`m_${remoteDeviceId}`]
      const shards = meta.shards || [0]
      const includesIncrement = baseline?.includes[remoteDeviceId] ?? 0

      for (const shardIdx of shards) {
        const events: Event<TEventData>[] = (await this.storage.get(`e_${remoteDeviceId}_${shardIdx}`)) || []

        for (const event of events) {
          if (event.increment > includesIncrement) {
            allEvents.push({ ...event, deviceId: remoteDeviceId })
          }
        }
      }

      this.knownIncrements[remoteDeviceId] = meta.last_increment
    }

    allEvents.sort((a, b) =>
      HLC.compare(a.hlc_time, a.hlc_counter, a.deviceId, b.hlc_time, b.hlc_counter, b.deviceId)
    )

    for (const event of allEvents) {
      await this.applyEvent(event)
    }

    const ourMeta: Meta = {
      version: PROTOCOL_VERSION,
      last_increment: 0,
      shards: [0],
    }

    const now = Date.now()
    const seenVector: SeenVector = {
      increments: this.knownIncrements,
      lastActive: now,
    }
    this.lastActivityUpdate = now

    const items: Record<string, any> = {
      [`m_${this.deviceId}`]: ourMeta,
      [`s_${this.deviceId}`]: seenVector,
    }

    if (this.baselineHandler) {
      const ourBaseline: Baseline<TState> = {
        includes: { ...this.knownIncrements },
        state: await this.baselineHandler(),
      }
      items[`b_${this.deviceId}`] = ourBaseline
    }

    await this.setWithGCRetry(items)

    this.log(`[SyncEngine] Bootstrapped with ${allEvents.length} events`)
  }

  /**
   * Load sync metadata for existing device
   * Restores internal sync state (increments, shards, seen vector)
   */
  private async loadSyncMetadata(meta: Meta): Promise<void> {
    this.log('[SyncEngine] Loading sync metadata...')

    // Validate our own Meta version
    this.validateProtocolVersion(meta, this.deviceId)

    this.deviceState.last_increment = meta.last_increment

    this.shardManager = new ShardManager(meta.shards)
    this.deviceState.current_shard = this.shardManager.getCurrentShard()

    const seen: SeenVector | undefined = await this.storage.get(`s_${this.deviceId}`)
    if (seen) {
      this.knownIncrements = seen.increments
      this.lastActivityUpdate = seen.lastActive
    } else {
      this.knownIncrements = {}
      this.lastActivityUpdate = 0
    }

    this.log('[SyncEngine] Sync metadata restored')
  }

  /**
   * Record a new event for synchronization
   */
  async recordEvent(type: string, data: TEventData): Promise<void> {
    return this.withLock(async () => {
      const { time, counter } = this.hlc.advance()

      const increment = this.deviceState.last_increment + 1
      const event: Event<TEventData> = {
        increment,
        hlc_time: time,
        hlc_counter: counter,
        op: { type, data },
      }

      this.shardManager.validateEventSize(event)

      const currentShard = this.shardManager.getCurrentShard()
      const shardKey = `e_${this.deviceId}_${currentShard}`
      const existingEvents: Event<TEventData>[] = (await this.storage.get(shardKey)) || []

      const itemsToWrite: Record<string, any> = {}

      if (existingEvents.length > 0 && this.shardManager.shouldCreateNewShard([...existingEvents, event])) {
        const newShard = this.shardManager.createNewShard()
        const newShardKey = `e_${this.deviceId}_${newShard}`
        itemsToWrite[newShardKey] = [event]
        this.deviceState.current_shard = newShard
      } else {
        existingEvents.push(event)
        itemsToWrite[shardKey] = existingEvents
      }

      this.deviceState.last_increment = increment
      this.deviceState.hlc_time = time
      this.deviceState.hlc_counter = counter
      this.deviceState.events_since_baseline_update++

      const meta: Meta = {
        version: PROTOCOL_VERSION,
        last_increment: increment,
        shards: this.shardManager.getActiveShards(),
      }
      itemsToWrite[`m_${this.deviceId}`] = meta

      await this.setWithGCRetry(itemsToWrite)

      if (this.deviceState.events_since_baseline_update >= this.config.baselineThreshold) {
        await this.updateBaseline()
      }

      this.log(`[SyncEngine] Recorded event: ${type} (increment: ${increment})`)
    })
  }

  /**
   * Perform sync with remote devices
   */
  async sync(): Promise<SyncResult> {
    return this.withLock(async () => {
      this.log('[SyncEngine] Starting sync...')

      const allData = await this.storage.getAll('^(m_|e_)')

      const allEvents: Array<Event<TEventData> & { deviceId: string }> = []

      for (const [key, value] of Object.entries(allData)) {
        if (!key.startsWith('m_')) continue

        const meta = value as Meta
        const remoteDeviceId = key.replace('m_', '')

        if (remoteDeviceId === this.deviceId) continue

        // Validate version when discovering new devices
        if (!(remoteDeviceId in this.knownIncrements)) {
          this.validateProtocolVersion(meta, remoteDeviceId)
          this.knownIncrements[remoteDeviceId] = 0
        }

        const knownIncrement = this.knownIncrements[remoteDeviceId]
        const lastIncrement = meta.last_increment

        if (lastIncrement > knownIncrement) {
          const shards = meta.shards || [0]

          for (const shardIdx of shards) {
            const shardKey = `e_${remoteDeviceId}_${shardIdx}`
            const events: Event<TEventData>[] = allData[shardKey] || []

            for (const event of events) {
              if (event.increment > knownIncrement) {
                allEvents.push({ ...event, deviceId: remoteDeviceId })
              }
            }
          }

          this.knownIncrements[remoteDeviceId] = lastIncrement
        }
      }

      allEvents.sort((a, b) =>
        HLC.compare(a.hlc_time, a.hlc_counter, a.deviceId, b.hlc_time, b.hlc_counter, b.deviceId)
      )

      let eventsApplied = 0
      for (const event of allEvents) {
        await this.applyEvent(event)
        this.hlc.update(event.hlc_time, event.hlc_counter)
        eventsApplied++
      }

      const now = Date.now()
      const oneDayInMs = 24 * 60 * 60 * 1000
      const shouldUpdateActivity = (now - this.lastActivityUpdate) > oneDayInMs

      if (eventsApplied > 0 || shouldUpdateActivity) {
        if (shouldUpdateActivity) {
          this.lastActivityUpdate = now
        }

        const seenVector: SeenVector = {
          increments: this.knownIncrements,
          lastActive: this.lastActivityUpdate,
        }

        await this.setWithGCRetry({
          [`s_${this.deviceId}`]: seenVector,
        })
      }

      this.log(`[SyncEngine] Sync complete: ${eventsApplied} events applied`)

      this.deviceState.syncs_since_gc++
      if (this.deviceState.syncs_since_gc >= this.config.gcFrequency) {
        await this.performGC()
        this.deviceState.syncs_since_gc = 0
      }

      return { eventsApplied }
    })
  }

  /**
   * Get debug information about sync engine state
   * Useful for inspecting devices, events, and sync status
   */
  async getDebugInfo(): Promise<DebugInfo> {
    // Get all metadata
    const allMeta = await this.storage.getAll('^m_')
    const allBaselines = await this.storage.getAll('^b_')

    const hlcState = this.hlc.get()
    const currentDevice = {
      deviceId: this.deviceId,
      lastIncrement: this.deviceState.last_increment,
      hlc: { time: hlcState.time, counter: hlcState.counter },
      currentShard: this.deviceState.current_shard,
      eventsSinceBaseline: this.deviceState.events_since_baseline_update,
      syncsSinceGC: this.deviceState.syncs_since_gc,
    }

    const devices = Object.entries(allMeta).map(([key, meta]) => {
      const deviceId = key.replace('m_', '')
      const typedMeta = meta as Meta
      return {
        deviceId,
        lastIncrement: typedMeta.last_increment,
        shards: typedMeta.shards,
        hasBaseline: `b_${deviceId}` in allBaselines,
      }
    })

    const allEvents: Array<{
      deviceId: string
      increment: number
      type: string
      hlc: { time: number; counter: number }
      data: any
    }> = []

    for (const [key, meta] of Object.entries(allMeta)) {
      const deviceId = key.replace('m_', '')
      const typedMeta = meta as Meta

      for (const shardIdx of typedMeta.shards) {
        const shardKey = `e_${deviceId}_${shardIdx}`
        const events = (await this.storage.get(shardKey)) as Event<TEventData>[] | undefined

        if (events) {
          for (const event of events) {
            allEvents.push({
              deviceId,
              increment: event.increment,
              type: event.op.type,
              hlc: { time: event.hlc_time, counter: event.hlc_counter },
              data: event.op.data,
            })
          }
        }
      }
    }

    return {
      currentDevice,
      devices,
      events: allEvents,
      totalEvents: allEvents.length,
      knownIncrements: { ...this.knownIncrements },
    }
  }

  /**
   * Notify application of remote event to apply
   */
  private async applyEvent(event: Event<TEventData>): Promise<void> {
    if (!this.eventHandler) return

    await this.eventHandler(event)
  }

  /**
   * Update baseline with current state
   */
  private async updateBaseline(): Promise<void> {
    if (!this.baselineHandler) return

    const baseline: Baseline<TState> = {
      includes: {
        [this.deviceId]: this.deviceState.last_increment,
        ...this.knownIncrements,
      },
      state: await this.baselineHandler(),
    }

    await this.setWithGCRetry({
      [`b_${this.deviceId}`]: baseline,
    })
    this.deviceState.events_since_baseline_update = 0
    this.log('[SyncEngine] Baseline updated')
  }

  /**
   * Remove inactive devices and their data
   */
  private async removeInactiveDevices(): Promise<void> {
    this.log('[SyncEngine] Checking for inactive devices...')

    const allMeta = await this.storage.getAll('^m_')
    const allSeen = await this.storage.getAll('^s_')

    const now = Date.now()
    const timeout = this.config.inactiveDeviceTimeout
    const keysToRemove: string[] = []
    const devicesToRemove: string[] = []

    for (const [metaKey, meta] of Object.entries(allMeta)) {
      const deviceId = metaKey.replace('m_', '')
      if (deviceId === this.deviceId) continue

      const seenKey = `s_${deviceId}`
      const seen = allSeen[seenKey] as SeenVector | undefined

      if (!seen) {
        continue
      }

      const lastActive = seen.lastActive || 0
      if (lastActive === 0) {
        continue
      }

      if (now - lastActive > timeout) {
        this.log(`[SyncEngine] Device ${deviceId} inactive for ${Math.floor((now - lastActive) / (24 * 60 * 60 * 1000))} days, removing...`)

        keysToRemove.push(`m_${deviceId}`)
        keysToRemove.push(`b_${deviceId}`)
        keysToRemove.push(`s_${deviceId}`)

        const shards = (meta as Meta).shards || [0]
        for (const shard of shards) {
          keysToRemove.push(`e_${deviceId}_${shard}`)
        }

        delete this.knownIncrements[deviceId]
        devicesToRemove.push(deviceId)
      }
    }

    if (keysToRemove.length > 0) {
      await this.storage.remove(keysToRemove)

      const seenVector: SeenVector = {
        increments: this.knownIncrements,
        lastActive: Date.now(),
      }
      await this.storage.set({
        [`s_${this.deviceId}`]: seenVector,
      })

      this.log(`[SyncEngine] Removed ${devicesToRemove.length} inactive devices`)
    }
  }

  /**
   * Perform garbage collection
   * Removes old events that are included in all device baselines
   */
  private async performGC(): Promise<void> {
    this.log('[SyncEngine] Starting garbage collection...')

    if (this.config.removeInactiveDevices) {
      await this.removeInactiveDevices()
    }

    const allBaselines = await this.storage.getAll('^b_')

    let safeToRemove: number

    if (Object.keys(allBaselines).length === 0) {
      this.log('[SyncEngine] No baselines found, can remove all events')
      safeToRemove = this.deviceState.last_increment
    } else {
      const minIncludes: number[] = []
      for (const [key, baseline] of Object.entries(allBaselines)) {
        const included = (baseline as Baseline<TState>).includes[this.deviceId] ?? 0
        minIncludes.push(included)
      }

      safeToRemove = Math.min(...minIncludes)

      if (safeToRemove === 0) {
        this.log('[SyncEngine] No events safe to remove, skipping GC')
        return
      }

      this.log(`[SyncEngine] Safe to remove events up to increment ${safeToRemove}`)
    }

    const shards = this.shardManager.getActiveShards()
    const itemsToWrite: Record<string, any> = {}
    const shardsToDelete: string[] = []
    const remainingShards: number[] = []
    let totalEventsRemoved = 0

    for (const shardIdx of shards) {
      const shardKey = `e_${this.deviceId}_${shardIdx}`
      const events: Event<TEventData>[] = (await this.storage.get(shardKey)) || []

      const remainingEvents = events.filter((event) => event.increment > safeToRemove)
      const eventsRemoved = events.length - remainingEvents.length
      totalEventsRemoved += eventsRemoved

      if (remainingEvents.length === 0) {
        shardsToDelete.push(shardKey)
      } else if (eventsRemoved > 0) {
        itemsToWrite[shardKey] = remainingEvents
        remainingShards.push(shardIdx)
      } else {
        remainingShards.push(shardIdx)
      }
    }

    if (totalEventsRemoved === 0) {
      this.log('[SyncEngine] No events removed by GC')
      return
    }

    this.shardManager = new ShardManager(remainingShards)
    this.deviceState.current_shard = this.shardManager.getCurrentShard()

    const meta: Meta = {
      version: PROTOCOL_VERSION,
      last_increment: this.deviceState.last_increment,
      shards: remainingShards,
    }
    itemsToWrite[`m_${this.deviceId}`] = meta

    await this.storage.set(itemsToWrite)

    if (shardsToDelete.length > 0) {
      await this.storage.remove(shardsToDelete)
    }

    this.log(`[SyncEngine] GC complete: removed ${totalEventsRemoved} events, ${remainingShards.length} shards remaining`)
  }

  /**
   * Handle storage change notifications
   */
  private onStorageChange(changes: Array<{ key: string }>): void {
    for (const change of changes) {
      if (change.key.startsWith('m_') && change.key !== `m_${this.deviceId}`) {
        setTimeout(() => this.sync(), 0)
        break
      }
    }
  }

}
