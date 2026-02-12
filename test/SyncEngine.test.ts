/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { test } from 'node:test'
import assert from 'node:assert'
import { SyncEngine } from '../src/SyncEngine.js'
import { MemoryStorage } from '../src/MemoryStorage.js'
import type { Event, Baseline, Meta, StorageAdapter } from '../src/types.js'

interface TestState {
  items: Record<string, { name: string }>
}

interface TestEventData {
  id: string
  name?: string
}

// Helper: Track handler calls with order
interface HandlerTracking {
  callOrder: string[]
  waitForCall: (callName: string, timeout?: number) => Promise<void>
}

// Helper: Create engine with tracking
function createTrackedEngine(
  deviceId: string,
  storage: StorageAdapter,
  state: TestState,
  config: any = {}
): { engine: SyncEngine<TestState, TestEventData>; tracking: HandlerTracking } {
  const engine = new SyncEngine<TestState, TestEventData>(deviceId, storage, { debug: true, ...config })

  // Promise resolvers for each call type
  const waiters = new Map<string, Array<() => void>>()

  const tracking: HandlerTracking = {
    callOrder: [],
    waitForCall: (callName: string, timeout = 1000) => {
      return new Promise<void>((resolve, reject) => {
        // Setup timeout
        const timeoutId = setTimeout(() => {
          reject(new Error(`Timeout waiting for ${callName}`))
        }, timeout)

        // Register waiter
        if (!waiters.has(callName)) {
          waiters.set(callName, [])
        }
        waiters.get(callName)!.push(() => {
          clearTimeout(timeoutId)
          resolve()
        })
      })
    },
  }

  const notifyWaiters = (callName: string) => {
    const callWaiters = waiters.get(callName)
    if (callWaiters) {
      callWaiters.forEach(resolve => resolve())
      waiters.set(callName, [])
    }
  }

  engine.onApplyEvent((event) => {
    tracking.callOrder.push('applyEvent')
    notifyWaiters('applyEvent')
    if (event.op.type === 'create') {
      state.items[event.op.data.id] = { name: event.op.data.name! }
    }
  })

  engine.onCreateBaseline(() => {
    tracking.callOrder.push('createBaseline')
    notifyWaiters('createBaseline')
    return state
  })

  engine.onApplyBaseline((newState) => {
    tracking.callOrder.push('applyBaseline')
    notifyWaiters('applyBaseline')
    Object.assign(state, newState)
    return
  })

  return { engine, tracking }
}

// Helper: Count specific calls
function countCalls(tracking: HandlerTracking, callName: string): number {
  return tracking.callOrder.filter(c => c === callName).length
}

// Helper: Pre-populate storage for existing device
async function setupExistingDevice(
  storage: StorageAdapter,
  deviceId: string,
  lastIncrement = 0,
  shards = [0]
) {
  await storage.set({
    [`m_${deviceId}`]: { last_increment: lastIncrement, shards },
    [`b_${deviceId}`]: { includes: {}, state: { items: {} } },
  })
}

// =============================================================================
// A. BOOTSTRAP SCENARIOS
// =============================================================================

test('A0. First device (no bootstrap)', async () => {
  const storage = new MemoryStorage()
  const stateA: TestState = { items: {} }
  const { engine, tracking } = createTrackedEngine('device-A', storage, stateA)

  await engine.initialize()

  // Verify meta was created
  const meta = await storage.get('m_device-A')
  assert.ok(meta, 'Meta should be created')
  assert.strictEqual(meta.last_increment, 0, 'Initial increment should be 0')
  assert.deepStrictEqual(meta.shards, [0], 'Initial shards should be [0]')

  // Verify baseline was created
  const baseline = await storage.get('b_device-A')
  assert.ok(baseline, 'Baseline should be created')
  assert.ok(baseline.state, 'Baseline should have state')
  assert.ok(baseline.includes, 'Baseline should have includes')
  assert.deepStrictEqual(baseline.includes, {}, 'First device baseline includes should be empty')

  // First device should never apply events or baseline, but create baseline once
  assert.deepStrictEqual(tracking.callOrder, ['createBaseline'], 'Should only call createBaseline once')

  console.log('✓ A0. First device (no bootstrap) passed')
})

test('A1. Bootstrap from baseline with multiple devices', async () => {
  const storage = new MemoryStorage()

  // Setup: Device A and C already exist with events
  await storage.set({
    'm_device-A': { last_increment: 2, shards: [0] },
    'e_device-A_0': [
      { increment: 1, hlc_time: 1000, hlc_counter: 0, op: { type: 'create', data: { id: 'a1', name: 'A1' } } },
      { increment: 2, hlc_time: 1001, hlc_counter: 0, op: { type: 'create', data: { id: 'a2', name: 'A2' } } },
    ],
    'b_device-A': {
      includes: { 'device-A': 2, 'device-C': 1 },
      state: { items: { a1: { name: 'A1' }, a2: { name: 'A2' }, c1: { name: 'C1' } } },
    },
    'm_device-C': { last_increment: 1, shards: [0] },
    'e_device-C_0': [
      { increment: 1, hlc_time: 1000, hlc_counter: 1, op: { type: 'create', data: { id: 'c1', name: 'C1' } } },
    ],
  })

  // Device B bootstraps
  const stateB: TestState = { items: {} }
  const { engine: engineB, tracking: trackingB } = createTrackedEngine('device-B', storage, stateB)
  await engineB.initialize()

  // Verify bootstrap loaded baseline from A
  assert.strictEqual(Object.keys(stateB.items).length, 3)
  assert.deepStrictEqual(trackingB.callOrder, ['applyBaseline', 'createBaseline'],
    'Should applyBaseline, then createBaseline (no events after baseline)')

  console.log('✓ A1. Bootstrap from baseline with multiple devices passed')
})

test('A2. Bootstrap with events in multiple shards', async () => {
  const storage = new MemoryStorage()

  // Setup: Device A has events in 3 shards
  await storage.set({
    'm_device-A': { last_increment: 6, shards: [0, 1, 2] },
    'e_device-A_0': [
      { increment: 1, hlc_time: 1000, hlc_counter: 0, op: { type: 'create', data: { id: 'a1', name: 'A1' } } },
      { increment: 2, hlc_time: 1001, hlc_counter: 0, op: { type: 'create', data: { id: 'a2', name: 'A2' } } },
    ],
    'e_device-A_1': [
      { increment: 3, hlc_time: 1002, hlc_counter: 0, op: { type: 'create', data: { id: 'a3', name: 'A3' } } },
      { increment: 4, hlc_time: 1003, hlc_counter: 0, op: { type: 'create', data: { id: 'a4', name: 'A4' } } },
    ],
    'e_device-A_2': [
      { increment: 5, hlc_time: 1004, hlc_counter: 0, op: { type: 'create', data: { id: 'a5', name: 'A5' } } },
      { increment: 6, hlc_time: 1005, hlc_counter: 0, op: { type: 'create', data: { id: 'a6', name: 'A6' } } },
    ],
    'b_device-A': {
      includes: { 'device-A': 2 }, // Baseline includes first 2 events
      state: { items: { a1: { name: 'A1' }, a2: { name: 'A2' } } },
    },
  })

  // Device B bootstraps
  const stateB: TestState = { items: {} }
  const { engine: engineB, tracking: trackingB } = createTrackedEngine('device-B', storage, stateB)
  await engineB.initialize()

  // Verify all events after baseline were applied
  assert.strictEqual(Object.keys(stateB.items).length, 6)
  assert.deepStrictEqual(trackingB.callOrder, ['applyBaseline', 'applyEvent', 'applyEvent', 'applyEvent', 'applyEvent', 'createBaseline'],
    'Should applyBaseline, then 4 applyEvents (3-6), then createBaseline')

  console.log('✓ A2. Bootstrap with events in multiple shards passed')
})

test('A3. Bootstrap without baseline available', async () => {
  const storage = new MemoryStorage()

  // Setup: Device A exists but has NO baseline
  await storage.set({
    'm_device-A': { last_increment: 2, shards: [0] },
    'e_device-A_0': [
      { increment: 1, hlc_time: 1000, hlc_counter: 0, op: { type: 'create', data: { id: 'a1', name: 'A1' } } },
      { increment: 2, hlc_time: 1001, hlc_counter: 0, op: { type: 'create', data: { id: 'a2', name: 'A2' } } },
    ],
    // No b_device-A
  })

  const stateB: TestState = { items: {} }
  const { engine: engineB, tracking: trackingB } = createTrackedEngine('device-B', storage, stateB)

  // Should NOT fail - instead apply all events from scratch
  await engineB.initialize()

  // Should have applied all events from A
  assert.strictEqual(Object.keys(stateB.items).length, 2, 'Should have 2 items from A')
  assert.ok(stateB.items['a1'], 'Should have a1')
  assert.ok(stateB.items['a2'], 'Should have a2')

  // Should apply all events (no baseline), then create own baseline
  assert.deepStrictEqual(trackingB.callOrder,
    ['applyEvent', 'applyEvent', 'createBaseline'],
    'Should apply all events from A, then create own baseline (no applyBaseline since none exists)')

  console.log('✓ A3. Bootstrap without baseline available passed')
})

test('A4. Bootstrap with device not in baseline', async () => {
  const storage = new MemoryStorage()

  // Device A exists with baseline that does NOT include device C
  await storage.set({
    'm_device-A': { last_increment: 2, shards: [0] },
    'e_device-A_0': [
      { increment: 1, hlc_time: 1000, hlc_counter: 0, op: { type: 'create', data: { id: 'a1', name: 'A1' } } },
      { increment: 2, hlc_time: 1001, hlc_counter: 0, op: { type: 'create', data: { id: 'a2', name: 'A2' } } },
    ],
    'b_device-A': {
      includes: { 'device-A': 2 }, // Only includes device A, NOT device C
      state: { items: { a1: { name: 'A1' }, a2: { name: 'A2' } } },
    },
  })

  // Device C exists with events (but not in baseline)
  await storage.set({
    'm_device-C': { last_increment: 3, shards: [0] },
    'e_device-C_0': [
      { increment: 1, hlc_time: 1002, hlc_counter: 0, op: { type: 'create', data: { id: 'c1', name: 'C1' } } },
      { increment: 2, hlc_time: 1003, hlc_counter: 0, op: { type: 'create', data: { id: 'c2', name: 'C2' } } },
      { increment: 3, hlc_time: 1004, hlc_counter: 0, op: { type: 'create', data: { id: 'c3', name: 'C3' } } },
    ],
  })

  // Device B bootstraps
  const stateB: TestState = { items: {} }
  const { engine: engineB, tracking: trackingB } = createTrackedEngine('device-B', storage, stateB)
  await engineB.initialize()

  // Should have loaded baseline from A (2 items) + all events from C (3 items)
  assert.strictEqual(Object.keys(stateB.items).length, 5, 'Should have 5 items total')
  assert.ok(stateB.items['a1'], 'Should have a1 from baseline')
  assert.ok(stateB.items['a2'], 'Should have a2 from baseline')
  assert.ok(stateB.items['c1'], 'Should have c1 from C')
  assert.ok(stateB.items['c2'], 'Should have c2 from C')
  assert.ok(stateB.items['c3'], 'Should have c3 from C')

  // Verify order: baseline first, then all 3 events from C, then create own baseline
  assert.deepStrictEqual(trackingB.callOrder,
    ['applyBaseline', 'applyEvent', 'applyEvent', 'applyEvent', 'createBaseline'],
    'Should apply baseline, then all 3 C events, then create own baseline')

  console.log('✓ A4. Bootstrap with device not in baseline passed')
})

// =============================================================================
// B. SYNC NORMAL
// =============================================================================

test('B0. Basic two-device sync', async () => {
  const storage = new MemoryStorage()

  // Device A
  const stateA: TestState = { items: {} }
  const { engine: engineA, tracking: trackingA } = createTrackedEngine('device-A', storage, stateA)
  await engineA.initialize()

  // Device A creates an item: apply locally then record
  stateA.items['item-1'] = { name: 'From Device A' }
  await engineA.recordEvent('create', { id: 'item-1', name: 'From Device A' })

  // Device B joins
  const stateB: TestState = { items: {} }
  const { engine: engineB, tracking: trackingB } = createTrackedEngine('device-B', storage, stateB)
  await engineB.initialize()

  // Device B should have bootstrapped with device A's item
  assert.strictEqual(Object.keys(stateB.items).length, 1, 'Device B should have 1 item after bootstrap')
  assert.strictEqual(stateB.items['item-1'].name, 'From Device A')

  // Device B creates an item: apply locally then record
  stateB.items['item-2'] = { name: 'From Device B' }
  await engineB.recordEvent('create', { id: 'item-2', name: 'From Device B' })

  // Device A syncs
  await engineA.sync()

  // Device A should now have both items
  assert.strictEqual(Object.keys(stateA.items).length, 2, 'Device A should have 2 items after sync')
  assert.strictEqual(stateA.items['item-1'].name, 'From Device A')
  assert.strictEqual(stateA.items['item-2'].name, 'From Device B')

  // Both devices should have same state
  assert.deepStrictEqual(stateA.items, stateB.items, 'Both devices should have same state')

  // Verify handler calls for Device A (first device)
  assert.deepStrictEqual(trackingA.callOrder, ['createBaseline', 'applyEvent'],
    'Device A: createBaseline during init, then applyEvent when syncing from B')

  // Verify handler calls for Device B (bootstrap device)
  assert.deepStrictEqual(trackingB.callOrder, ['applyBaseline', 'applyEvent', 'createBaseline'],
    'Device B: applyBaseline, applyEvent during bootstrap, then createBaseline')

  console.log('✓ B0. Basic two-device sync passed')
})

test('B1. Sync with no new events (noop)', async () => {
  const storage = new MemoryStorage()
  await setupExistingDevice(storage, 'device-A', 2)

  const stateA: TestState = { items: {} }
  const { engine: engineA, tracking: trackingA } = createTrackedEngine('device-A', storage, stateA)
  await engineA.initialize()

  // Sync when nothing new
  const result = await engineA.sync()

  assert.strictEqual(result.eventsApplied, 0)
  assert.deepStrictEqual(trackingA.callOrder, [], 'Should not call any handlers when no new events')

  console.log('✓ B1. Sync with no new events passed')
})

test('B2. Sync with events from multiple devices', async () => {
  const storage = new MemoryStorage()

  // Setup 3 devices: A, B, C all with events
  await storage.set({
    'm_device-A': { last_increment: 1, shards: [0] },
    'e_device-A_0': [
      { increment: 1, hlc_time: 1000, hlc_counter: 0, op: { type: 'create', data: { id: 'a1', name: 'A1' } } },
    ],
    'b_device-A': { includes: {}, state: { items: {} } },
    'm_device-B': { last_increment: 1, shards: [0] },
    'e_device-B_0': [
      { increment: 1, hlc_time: 1001, hlc_counter: 0, op: { type: 'create', data: { id: 'b1', name: 'B1' } } },
    ],
    'b_device-B': { includes: {}, state: { items: {} } },
    'm_device-C': { last_increment: 1, shards: [0] },
    'e_device-C_0': [
      { increment: 1, hlc_time: 1002, hlc_counter: 0, op: { type: 'create', data: { id: 'c1', name: 'C1' } } },
    ],
    'b_device-C': { includes: {}, state: { items: {} } },
  })

  // Device D joins and syncs
  const stateD: TestState = { items: {} }
  const { engine: engineD, tracking: trackingD } = createTrackedEngine('device-D', storage, stateD)
  await engineD.initialize()

  // Should have synced events from A, B, C
  assert.strictEqual(Object.keys(stateD.items).length, 3)
  assert.strictEqual(countCalls(trackingD, 'applyEvent'), 3, 'Should apply 3 events during bootstrap')

  console.log('✓ B2. Sync with events from multiple devices passed')
})

test('B3. Sync with HLC ordering', async () => {
  const storage = new MemoryStorage()

  // Setup: Events with same time but different counters
  await storage.set({
    'm_device-A': { last_increment: 2, shards: [0] },
    'e_device-A_0': [
      { increment: 1, hlc_time: 1000, hlc_counter: 0, op: { type: 'create', data: { id: 'a1', name: 'A1' } } },
      { increment: 2, hlc_time: 1000, hlc_counter: 5, op: { type: 'create', data: { id: 'a2', name: 'A2' } } },
    ],
    'b_device-A': { includes: {}, state: { items: {} } },
    'm_device-B': { last_increment: 1, shards: [0] },
    'e_device-B_0': [
      { increment: 1, hlc_time: 1000, hlc_counter: 2, op: { type: 'create', data: { id: 'b1', name: 'B1' } } },
    ],
    'b_device-B': { includes: {}, state: { items: {} } },
  })

  const stateC: TestState = { items: {} }
  const eventsApplied: string[] = []
  const engineC = new SyncEngine<TestState, TestEventData>('device-C', storage)

  engineC.onApplyEvent((event) => {
    eventsApplied.push(event.op.data.id)
    stateC.items[event.op.data.id] = { name: event.op.data.name! }
  })
  engineC.onCreateBaseline(() => stateC)
  engineC.onApplyBaseline((newState) => {
    Object.assign(stateC, newState)
  })

  await engineC.initialize()

  // Verify HLC ordering: counter 0, 2, 5
  assert.deepStrictEqual(eventsApplied, ['a1', 'b1', 'a2'])

  console.log('✓ B3. Sync with HLC ordering passed')
})

test('B4. Multiple syncs in sequence', async () => {
  const storage = new MemoryStorage()
  await setupExistingDevice(storage, 'device-A')

  const stateA: TestState = { items: {} }
  const { engine: engineA, tracking: trackingA } = createTrackedEngine('device-A', storage, stateA)
  await engineA.initialize()

  // First sync - nothing
  let result = await engineA.sync()
  assert.strictEqual(result.eventsApplied, 0)

  // Add event from device B
  await storage.set({
    'm_device-B': { last_increment: 1, shards: [0] },
    'e_device-B_0': [
      { increment: 1, hlc_time: 1000, hlc_counter: 0, op: { type: 'create', data: { id: 'b1', name: 'B1' } } },
    ],
  })

  // Second sync - 1 event
  result = await engineA.sync()
  assert.strictEqual(result.eventsApplied, 1)

  // Third sync - nothing new
  result = await engineA.sync()
  assert.strictEqual(result.eventsApplied, 0)

  assert.strictEqual(countCalls(trackingA, 'applyEvent'), 1, 'Should have applied 1 event total')

  console.log('✓ B4. Multiple syncs in sequence passed')
})

// =============================================================================
// C. BASELINE
// =============================================================================

test('C0. Record events below threshold', async () => {
  const storage = new MemoryStorage()
  await setupExistingDevice(storage, 'device-A')

  const stateA: TestState = { items: {} }
  const { engine, tracking } = createTrackedEngine('device-A', storage, stateA)

  await engine.initialize()

  // Records events
  await engine.recordEvent('create1', { id: 'item-1', name: 'First Item' })
  await engine.recordEvent('create2', { id: 'item-2', name: 'Second Item' })

  // Verify meta was updated
  const meta = await storage.get('m_device-A')
  assert.strictEqual(meta.last_increment, 2, 'Increment should be 2')

  // Verify events were stored
  const events: Event<TestEventData>[] = await storage.get('e_device-A_0')
  assert.strictEqual(events.length, 2, 'Should have 2 events stored')
  assert.strictEqual(events[0].op.type, 'create1')
  assert.strictEqual(events[1].op.type, 'create2')

  // Verify handler calls - recording local events should not trigger any handlers
  assert.deepStrictEqual(tracking.callOrder, [], 'Should not call any handlers when recording events')

  console.log('✓ C0. Record events below threshold passed')
})

test('C1. Baseline update after threshold', async () => {
  const storage = new MemoryStorage()
  await setupExistingDevice(storage, 'device-A')

  const stateA: TestState = { items: {} }
  const { engine: engineA, tracking: trackingA } = createTrackedEngine(
    'device-A',
    storage,
    stateA,
    { baselineThreshold: 3 } // Lower threshold for testing
  )
  await engineA.initialize()

  // Record 3 events to reach threshold
  await engineA.recordEvent('create', { id: 'a1', name: 'A1' })
  await engineA.recordEvent('create', { id: 'a2', name: 'A2' })
  await engineA.recordEvent('create', { id: 'a3', name: 'A3' })

  // Baseline should be created once (threshold reached)
  assert.strictEqual(countCalls(trackingA, 'createBaseline'), 1, 'Should create baseline once after threshold')

  // Verify baseline in storage
  const baseline: Baseline<TestState> = await storage.get('b_device-A')
  assert.ok(baseline)
  assert.strictEqual(baseline.includes['device-A'], 3)

  console.log('✓ C1. Baseline update after threshold passed')
})

test('C2. Baseline includes correct devices', async () => {
  const storage = new MemoryStorage()

  // Setup: Device A with events from B and C already synced
  await storage.set({
    'm_device-A': { last_increment: 2, shards: [0] },
    'e_device-A_0': [
      { increment: 1, hlc_time: 1000, hlc_counter: 0, op: { type: 'create', data: { id: 'a1', name: 'A1' } } },
      { increment: 2, hlc_time: 1001, hlc_counter: 0, op: { type: 'create', data: { id: 'a2', name: 'A2' } } },
    ],
    'b_device-A': { includes: {}, state: { items: {} } },
    's_device-A': { 'device-B': 5, 'device-C': 3 }, // A has seen B up to 5, C up to 3
    'm_device-B': { last_increment: 5, shards: [0] },
    'm_device-C': { last_increment: 3, shards: [0] },
  })

  const stateA: TestState = { items: {} }
  const { engine: engineA } = createTrackedEngine(
    'device-A',
    storage,
    stateA,
    { baselineThreshold: 2 }
  )
  await engineA.initialize()

  // Record 2 more events to trigger baseline update
  await engineA.recordEvent('create', { id: 'a3', name: 'A3' })
  await engineA.recordEvent('create', { id: 'a4', name: 'A4' })

  // Verify baseline includes all known devices
  const baseline: Baseline<TestState> = await storage.get('b_device-A')
  assert.deepStrictEqual(baseline.includes, {
    'device-A': 4,
    'device-B': 5,
    'device-C': 3,
  })

  console.log('✓ C2. Baseline includes correct devices passed')
})

test('C3. Bootstrap skips events included in baseline', async () => {
  const storage = new MemoryStorage()

  // Setup: Device A with 5 events, baseline includes first 3
  await storage.set({
    'm_device-A': { last_increment: 5, shards: [0] },
    'e_device-A_0': [
      { increment: 1, hlc_time: 1000, hlc_counter: 0, op: { type: 'create', data: { id: 'a1', name: 'A1' } } },
      { increment: 2, hlc_time: 1001, hlc_counter: 0, op: { type: 'create', data: { id: 'a2', name: 'A2' } } },
      { increment: 3, hlc_time: 1002, hlc_counter: 0, op: { type: 'create', data: { id: 'a3', name: 'A3' } } },
      { increment: 4, hlc_time: 1003, hlc_counter: 0, op: { type: 'create', data: { id: 'a4', name: 'A4' } } },
      { increment: 5, hlc_time: 1004, hlc_counter: 0, op: { type: 'create', data: { id: 'a5', name: 'A5' } } },
    ],
    'b_device-A': {
      includes: { 'device-A': 3 },
      state: { items: { a1: { name: 'A1' }, a2: { name: 'A2' }, a3: { name: 'A3' } } },
    },
  })

  const stateB: TestState = { items: {} }
  const { engine: engineB, tracking: trackingB } = createTrackedEngine('device-B', storage, stateB)
  await engineB.initialize()

  // Should only apply events 4 and 5
  assert.strictEqual(countCalls(trackingB, 'applyEvent'), 2, 'Should apply only 2 events (4 and 5)')
  assert.strictEqual(Object.keys(stateB.items).length, 5)

  console.log('✓ C3. Bootstrap skips events included in baseline passed')
})

// =============================================================================
// D. SHARDING
// =============================================================================

test('D0. Create new shard when size exceeded', async () => {
  const storage = new MemoryStorage()
  await setupExistingDevice(storage, 'device-A')

  const stateA: TestState = { items: {} }
  const { engine: engineA } = createTrackedEngine('device-A', storage, stateA)
  await engineA.initialize()

  // Create large event data to exceed shard size when combined
  // Each event ~3000 chars = ~6KB, two together exceed 7KB limit
  const largeData = 'x'.repeat(3000)
  await engineA.recordEvent('create', { id: '1', name: largeData })
  await engineA.recordEvent('create', { id: '2', name: largeData })

  // Should have created shard 1
  const meta: Meta = await storage.get('m_device-A')
  assert.ok(meta.shards.includes(0), 'Should have shard 0')
  assert.ok(meta.shards.includes(1), 'Should have created shard 1')

  // Verify shard 0 exists and contains first event
  const shard0: Event<TestEventData>[] = await storage.get('e_device-A_0')
  assert.ok(shard0, 'Shard 0 should exist')
  assert.strictEqual(shard0.length, 1, 'Shard 0 should contain 1 event')
  assert.strictEqual(shard0[0].increment, 1, 'Shard 0 should contain increment 1')

  // Verify shard 1 exists and contains second event
  const shard1: Event<TestEventData>[] = await storage.get('e_device-A_1')
  assert.ok(shard1, 'Shard 1 should exist')
  assert.strictEqual(shard1.length, 1, 'Shard 1 should contain 1 event')
  assert.strictEqual(shard1[0].increment, 2, 'Shard 1 should contain increment 2')

  console.log('✓ D0. Create new shard when size exceeded passed')
})

test('D1. Read events from multiple shards', async () => {
  const storage = new MemoryStorage()

  // Setup: Device A with events in 2 shards
  await storage.set({
    'm_device-A': { last_increment: 4, shards: [0, 1] },
    'e_device-A_0': [
      { increment: 1, hlc_time: 1000, hlc_counter: 0, op: { type: 'create', data: { id: 'a1', name: 'A1' } } },
      { increment: 2, hlc_time: 1001, hlc_counter: 0, op: { type: 'create', data: { id: 'a2', name: 'A2' } } },
    ],
    'e_device-A_1': [
      { increment: 3, hlc_time: 1002, hlc_counter: 0, op: { type: 'create', data: { id: 'a3', name: 'A3' } } },
      { increment: 4, hlc_time: 1003, hlc_counter: 0, op: { type: 'create', data: { id: 'a4', name: 'A4' } } },
    ],
    'b_device-A': { includes: {}, state: { items: {} } },
  })

  const stateB: TestState = { items: {} }
  const { engine: engineB, tracking: trackingB } = createTrackedEngine('device-B', storage, stateB)
  await engineB.initialize()

  // Should read all events from both shards
  assert.strictEqual(countCalls(trackingB, 'applyEvent'), 4, 'Should apply all 4 events from both shards')
  assert.strictEqual(Object.keys(stateB.items).length, 4)

  console.log('✓ D1. Read events from multiple shards passed')
})

// =============================================================================
// E. HLC
// =============================================================================

test('E0. HLC advance during recordEvent', async () => {
  const storage = new MemoryStorage()
  await setupExistingDevice(storage, 'device-A')

  const stateA: TestState = { items: {} }
  const { engine: engineA } = createTrackedEngine('device-A', storage, stateA)
  await engineA.initialize()

  await engineA.recordEvent('create', { id: 'a1', name: 'A1' })

  const events: Event<TestEventData>[] = await storage.get('e_device-A_0')
  assert.ok(events, 'Events shard should exist')
  assert.ok(events.length >= 1, 'Should have at least 1 event')
  const lastEvent = events[events.length - 1]
  assert.ok(lastEvent.hlc_time > 0)
  assert.ok(typeof lastEvent.hlc_counter === 'number')

  console.log('✓ E0. HLC advance during recordEvent passed')
})

test('E1. HLC update during sync', async () => {
  const storage = new MemoryStorage()
  await setupExistingDevice(storage, 'device-A')

  const futureTime = Date.now() + 10000
  // Device B with future HLC
  await storage.set({
    'm_device-B': { last_increment: 1, shards: [0] },
    'e_device-B_0': [
      { increment: 1, hlc_time: futureTime, hlc_counter: 5, op: { type: 'create', data: { id: 'b1', name: 'B1' } } },
    ],
  })

  const stateA: TestState = { items: {} }
  const { engine: engineA } = createTrackedEngine('device-A', storage, stateA)
  await engineA.initialize()

  await engineA.sync()

  // Record new event - should have updated HLC from B's event
  await engineA.recordEvent('create', { id: 'a1', name: 'A1' })

  const events: Event<TestEventData>[] = await storage.get('e_device-A_0')
  const lastEvent = events[events.length - 1]
  // HLC should be updated to be >= remote time (or very close to current time if HLC advanced naturally)
  assert.ok(lastEvent.hlc_time >= futureTime || lastEvent.hlc_time >= Date.now())

  console.log('✓ E1. HLC update during sync passed')
})

// =============================================================================
// F. STORAGE CHANGE NOTIFICATION
// =============================================================================

test('F0. onChange triggers sync', async () => {
  const storage = new MemoryStorage()
  await setupExistingDevice(storage, 'device-A')

  const stateA: TestState = { items: {} }
  const { engine: engineA, tracking: trackingA } = createTrackedEngine('device-A', storage, stateA)
  await engineA.initialize()

  // Setup promise to wait for sync
  const syncPromise = trackingA.waitForCall('applyEvent')

  // Simulate remote device B adding event
  await storage.set({
    'm_device-B': { last_increment: 1, shards: [0] },
    'e_device-B_0': [
      { increment: 1, hlc_time: 1000, hlc_counter: 0, op: { type: 'create', data: { id: 'b1', name: 'B1' } } },
    ],
  })

  // Wait for change notification to trigger sync
  await syncPromise

  // Should have synced automatically
  assert.strictEqual(countCalls(trackingA, 'applyEvent'), 1, 'Should have synced 1 event automatically')

  console.log('✓ F0. onChange triggers sync passed')
})

test('F1. onChange ignores own device', async () => {
  const storage = new MemoryStorage()
  await setupExistingDevice(storage, 'device-A')

  const stateA: TestState = { items: {} }
  const { engine: engineA, tracking: trackingA } = createTrackedEngine('device-A', storage, stateA)
  await engineA.initialize()

  // Record event on same device
  await engineA.recordEvent('create', { id: 'a1', name: 'A1' })

  // Wait to ensure no auto-sync triggered (should timeout if handler called)
  await assert.rejects(
    async () => await trackingA.waitForCall('applyEvent', 50),
    /Timeout waiting for applyEvent/,
    'Should timeout because no sync should be triggered'
  )

  // Should not have triggered sync (no handlers called)
  assert.deepStrictEqual(trackingA.callOrder, [], 'Should not trigger any handlers for own device changes')

  console.log('✓ F1. onChange ignores own device passed')
})

// =============================================================================
// G. EDGE CASES
// =============================================================================

test('G0. Device without baselineHandler', async () => {
  const storage = new MemoryStorage()
  await storage.set({
    'm_device-A': { last_increment: 1, shards: [0] },
    'e_device-A_0': [
      { increment: 1, hlc_time: 1000, hlc_counter: 0, op: { type: 'create', data: { id: 'a1', name: 'A1' } } },
    ],
    'b_device-A': { includes: {}, state: { items: {} } },
  })

  const stateB: TestState = { items: {} }
  const engineB = new SyncEngine<TestState, TestEventData>('device-B', storage)

  engineB.onApplyEvent((event) => {
    if (event.op.type === 'create') {
      stateB.items[event.op.data.id] = { name: event.op.data.name! }
    }
  })
  // No onCreateBaseline handler
  engineB.onApplyBaseline((newState) => {
    Object.assign(stateB, newState)
  })

  await engineB.initialize()

  // Should still work, just won't create baseline
  assert.strictEqual(Object.keys(stateB.items).length, 1)

  console.log('✓ G0. Device without baselineHandler passed')
})

test('G1. Events with gaps in increments', async () => {
  const storage = new MemoryStorage()

  // Setup: Device A with gaps (missing 3, 4, 6)
  await storage.set({
    'm_device-A': { last_increment: 7, shards: [0] },
    'e_device-A_0': [
      { increment: 1, hlc_time: 1000, hlc_counter: 0, op: { type: 'create', data: { id: 'a1', name: 'A1' } } },
      { increment: 2, hlc_time: 1001, hlc_counter: 0, op: { type: 'create', data: { id: 'a2', name: 'A2' } } },
      { increment: 5, hlc_time: 1004, hlc_counter: 0, op: { type: 'create', data: { id: 'a5', name: 'A5' } } },
      { increment: 7, hlc_time: 1006, hlc_counter: 0, op: { type: 'create', data: { id: 'a7', name: 'A7' } } },
    ],
    'b_device-A': { includes: {}, state: { items: {} } },
  })

  const stateB: TestState = { items: {} }
  const { engine: engineB, tracking: trackingB } = createTrackedEngine('device-B', storage, stateB)
  await engineB.initialize()

  // Should apply available events and update known_increments to 7
  assert.strictEqual(countCalls(trackingB, 'applyEvent'), 4, 'Should apply 4 available events despite gaps')
  assert.strictEqual(Object.keys(stateB.items).length, 4)

  console.log('✓ G1. Events with gaps in increments passed')
})

test('G2. SyncResult values', async () => {
  const storage = new MemoryStorage()
  await setupExistingDevice(storage, 'device-A')

  const stateA: TestState = { items: {} }
  const { engine: engineA } = createTrackedEngine('device-A', storage, stateA)
  await engineA.initialize()

  // Add 3 events from device B
  await storage.set({
    'm_device-B': { last_increment: 3, shards: [0] },
    'e_device-B_0': [
      { increment: 1, hlc_time: 1000, hlc_counter: 0, op: { type: 'create', data: { id: 'b1', name: 'B1' } } },
      { increment: 2, hlc_time: 1001, hlc_counter: 0, op: { type: 'create', data: { id: 'b2', name: 'B2' } } },
      { increment: 3, hlc_time: 1002, hlc_counter: 0, op: { type: 'create', data: { id: 'b3', name: 'B3' } } },
    ],
  })

  const result = await engineA.sync()
  assert.strictEqual(result.eventsApplied, 3)

  console.log('✓ G2. SyncResult values passed')
})

test('G3. recordEvent during initialize throws', async () => {
  const storage = new MemoryStorage()
  const stateA: TestState = { items: {} }
  const { engine: engineA } = createTrackedEngine('device-A', storage, stateA)

  // Trigger initialize without awaiting
  const initPromise = engineA.initialize()

  // Immediately try to record event (while initialize is still running)
  await assert.rejects(
    async () => await engineA.recordEvent('create', { id: 'a1', name: 'A1' }),
    /Operation already in progress/,
    'Should throw when recordEvent called during initialize'
  )

  // Wait for initialize to complete
  await initPromise

  console.log('✓ G3. recordEvent during initialize throws passed')
})

test('G4. recordEvent during sync throws', async () => {
  const storage = new MemoryStorage()
  await setupExistingDevice(storage, 'device-A')

  const stateA: TestState = { items: {} }
  const { engine: engineA } = createTrackedEngine('device-A', storage, stateA)
  await engineA.initialize()

  // Add some remote data to make sync take time
  await storage.set({
    'm_device-B': { last_increment: 1, shards: [0] },
    'e_device-B_0': [
      { increment: 1, hlc_time: 1000, hlc_counter: 0, op: { type: 'create', data: { id: 'b1', name: 'B1' } } },
    ],
  })

  // Trigger sync without awaiting
  const syncPromise = engineA.sync()

  // Immediately try to record event (while sync is still running)
  await assert.rejects(
    async () => await engineA.recordEvent('create', { id: 'a1', name: 'A1' }),
    /Operation already in progress/,
    'Should throw when recordEvent called during sync'
  )

  // Wait for sync to complete
  await syncPromise

  console.log('✓ G4. recordEvent during sync throws passed')
})

test('G5. sync during initialize throws', async () => {
  const storage = new MemoryStorage()
  const stateA: TestState = { items: {} }
  const { engine: engineA } = createTrackedEngine('device-A', storage, stateA)

  // Trigger initialize without awaiting
  const initPromise = engineA.initialize()

  // Immediately try to sync (while initialize is still running)
  await assert.rejects(
    async () => await engineA.sync(),
    /Operation already in progress/,
    'Should throw when sync called during initialize'
  )

  // Wait for initialize to complete
  await initPromise

  console.log('✓ G5. sync during initialize throws passed')
})

test('G6. initialize during recordEvent throws', async () => {
  const storage = new MemoryStorage()
  await setupExistingDevice(storage, 'device-A')

  const stateA: TestState = { items: {} }
  const { engine: engineA } = createTrackedEngine('device-A', storage, stateA)
  await engineA.initialize()

  // Trigger recordEvent without awaiting
  const recordPromise = engineA.recordEvent('create', { id: 'a1', name: 'A1' })

  // Immediately try to initialize (while recordEvent is still running)
  await assert.rejects(
    async () => await engineA.initialize(),
    /Operation already in progress/,
    'Should throw when initialize called during recordEvent'
  )

  // Wait for recordEvent to complete
  await recordPromise

  console.log('✓ G6. initialize during recordEvent throws passed')
})

test('G7. Multiple concurrent recordEvent throws', async () => {
  const storage = new MemoryStorage()
  await setupExistingDevice(storage, 'device-A')

  const stateA: TestState = { items: {} }
  const { engine: engineA } = createTrackedEngine('device-A', storage, stateA)
  await engineA.initialize()

  // Try to record two events concurrently
  const record1 = engineA.recordEvent('create', { id: 'a1', name: 'A1' })
  const record2 = engineA.recordEvent('create', { id: 'a2', name: 'A2' })

  // One should succeed, one should throw
  const results = await Promise.allSettled([record1, record2])

  const succeeded = results.filter((r) => r.status === 'fulfilled')
  const failed = results.filter((r) => r.status === 'rejected')

  assert.strictEqual(succeeded.length, 1, 'Exactly one operation should succeed')
  assert.strictEqual(failed.length, 1, 'Exactly one operation should fail')

  if (failed[0].status === 'rejected') {
    assert.match(failed[0].reason.message, /Operation already in progress/, 'Should throw correct error')
  }

  console.log('✓ G7. Multiple concurrent recordEvent throws passed')
})

test('G8. Multiple concurrent sync throws', async () => {
  const storage = new MemoryStorage()
  await setupExistingDevice(storage, 'device-A')

  const stateA: TestState = { items: {} }
  const { engine: engineA } = createTrackedEngine('device-A', storage, stateA)
  await engineA.initialize()

  // Add event to sync
  await storage.set({
    'm_device-B': { last_increment: 1, shards: [0] },
    'e_device-B_0': [
      { increment: 1, hlc_time: 1000, hlc_counter: 0, op: { type: 'create', data: { id: 'b1', name: 'B1' } } },
    ],
  })

  // Try to sync twice concurrently
  const sync1 = engineA.sync()
  const sync2 = engineA.sync()

  const results = await Promise.allSettled([sync1, sync2])

  // One should succeed, one should throw
  const succeeded = results.filter((r) => r.status === 'fulfilled')
  const failed = results.filter((r) => r.status === 'rejected')

  assert.strictEqual(succeeded.length, 1, 'Exactly one sync should succeed')
  assert.strictEqual(failed.length, 1, 'Exactly one sync should fail')

  if (failed[0].status === 'rejected') {
    assert.match(failed[0].reason.message, /Operation already in progress/, 'Should throw correct error')
  }

  // The successful one should have applied the event
  if (succeeded[0].status === 'fulfilled') {
    assert.strictEqual(succeeded[0].value.eventsApplied, 1, 'Successful sync should apply 1 event')
  }

  console.log('✓ G8. Multiple concurrent sync throws passed')
})

test('G9. Event exceeds maximum shard size throws', async () => {
  const storage = new MemoryStorage()
  await setupExistingDevice(storage, 'device-A')

  const stateA: TestState = { items: {} }
  const { engine: engineA } = createTrackedEngine('device-A', storage, stateA)
  await engineA.initialize()

  // Create event that exceeds MAX_SHARD_SIZE (7KB)
  // 4000 chars * 2 bytes/char + JSON overhead = ~8KB+
  const tooLargeData = 'x'.repeat(4000)

  await assert.rejects(
    async () => await engineA.recordEvent('create', { id: '1', name: tooLargeData }),
    /Event size .* exceeds maximum shard size/,
    'Should throw when single event exceeds MAX_SHARD_SIZE'
  )

  console.log('✓ G9. Event exceeds maximum shard size throws passed')
})

// =============================================================================
// H. MULTI-DEVICE (3+)
// =============================================================================

test('H0. Three devices sync', async () => {
  const storage = new MemoryStorage()

  // Device A initializes first
  const stateA: TestState = { items: {} }
  const { engine: engineA } = createTrackedEngine('device-A', storage, stateA)
  await engineA.initialize()
  stateA.items['a1'] = { name: 'A1' }
  await engineA.recordEvent('create', { id: 'a1', name: 'A1' })

  // Device B joins
  const stateB: TestState = { items: {} }
  const { engine: engineB } = createTrackedEngine('device-B', storage, stateB)
  await engineB.initialize()
  stateB.items['b1'] = { name: 'B1' }
  await engineB.recordEvent('create', { id: 'b1', name: 'B1' })

  // Device C joins
  const stateC: TestState = { items: {} }
  const { engine: engineC } = createTrackedEngine('device-C', storage, stateC)
  await engineC.initialize()
  stateC.items['c1'] = { name: 'C1' }
  await engineC.recordEvent('create', { id: 'c1', name: 'C1' })

  // All devices sync
  await engineA.sync()
  await engineB.sync()
  await engineC.sync()

  // All should have all items
  assert.strictEqual(Object.keys(stateA.items).length, 3)
  assert.strictEqual(Object.keys(stateB.items).length, 3)
  assert.strictEqual(Object.keys(stateC.items).length, 3)

  console.log('✓ H0. Three devices sync passed')
})

test('H1. Device offline comes back online', async () => {
  const storage = new MemoryStorage()

  // Device A and B start syncing
  const stateA: TestState = { items: {} }
  const { engine: engineA } = createTrackedEngine('device-A', storage, stateA)
  await engineA.initialize()

  const stateB: TestState = { items: {} }
  const { engine: engineB } = createTrackedEngine('device-B', storage, stateB)
  await engineB.initialize()

  // A and B create events
  stateA.items['a1'] = { name: 'A1' }
  await engineA.recordEvent('create', { id: 'a1', name: 'A1' })
  stateB.items['b1'] = { name: 'B1' }
  await engineB.recordEvent('create', { id: 'b1', name: 'B1' })

  await engineA.sync()
  await engineB.sync()

  // Device C "offline" - bootstraps now but won't sync
  const stateC: TestState = { items: {} }
  const { engine: engineC } = createTrackedEngine('device-C', storage, stateC)
  await engineC.initialize()

  // A and B continue creating events while C is "offline"
  stateA.items['a2'] = { name: 'A2' }
  await engineA.recordEvent('create', { id: 'a2', name: 'A2' })
  stateB.items['b2'] = { name: 'B2' }
  await engineB.recordEvent('create', { id: 'b2', name: 'B2' })

  await engineA.sync()
  await engineB.sync()

  // C comes back online and syncs
  await engineC.sync()

  // C should have all events
  assert.strictEqual(Object.keys(stateC.items).length, 4)

  console.log('✓ H1. Device offline comes back online passed')
})

// =============================================================================
// I. GARBAGE COLLECTION
// =============================================================================

test('I0. GC triggered after gcFrequency syncs', async () => {
  const storage = new MemoryStorage()

  const stateA: TestState = { items: {} }
  const { engine: engineA } = createTrackedEngine('device-A', storage, stateA, {
    gcFrequency: 3,
    baselineThreshold: 2,
  })
  await engineA.initialize()

  // Create 4 events (will trigger baseline at 2, then at 4)
  for (let i = 1; i <= 4; i++) {
    stateA.items[`a${i}`] = { name: `A${i}` }
    await engineA.recordEvent('create', { id: `a${i}`, name: `A${i}` })
  }

  // Device B creates baseline including all A events
  const stateB: TestState = { items: {} }
  const { engine: engineB } = createTrackedEngine('device-B', storage, stateB, {
    baselineThreshold: 1,
  })
  await engineB.initialize()

  // Both sync to create and update baselines
  await engineA.sync() // 1
  await engineB.sync()

  // Verify baselines include all events
  const baselineA = await storage.get('b_device-A')
  const baselineB = await storage.get('b_device-B')
  assert.strictEqual(baselineA.includes['device-A'], 4, 'Baseline A should include all A events')
  assert.strictEqual(baselineB.includes['device-A'], 4, 'Baseline B should include all A events')

  // Verify events exist before GC
  const shardBefore = await storage.get('e_device-A_0')
  assert.strictEqual(shardBefore.length, 4, 'Should have 4 events before GC')

  // Sync 2 more times to trigger GC at 3
  await engineA.sync() // 2
  await engineA.sync() // 3 - should trigger GC

  // Verify GC ran and removed events
  const shardAfter = await storage.get('e_device-A_0')
  assert.strictEqual(shardAfter, undefined, 'Should have removed all events after GC')

  console.log('✓ I0. GC triggered after gcFrequency syncs passed')
})

test('I1. GC removes events included in all baselines', async () => {
  const storage = new MemoryStorage()

  // Device A creates events 1-10 with low baseline threshold
  const stateA: TestState = { items: {} }
  const { engine: engineA } = createTrackedEngine('device-A', storage, stateA, {
    gcFrequency: 1,
    baselineThreshold: 5, // Force baseline update after 5 events
  })
  await engineA.initialize()

  for (let i = 1; i <= 10; i++) {
    stateA.items[`a${i}`] = { name: `A${i}` }
    await engineA.recordEvent('create', { id: `a${i}`, name: `A${i}` })
  }

  // Device B bootstraps and creates baseline (includes A:10)
  const stateB: TestState = { items: {} }
  const { engine: engineB } = createTrackedEngine('device-B', storage, stateB, {
    baselineThreshold: 1, // Force baseline update
  })
  await engineB.initialize()

  // Both devices sync and create baselines
  await engineA.sync()
  await engineB.sync()

  // Verify baselines were created
  const baselineA = await storage.get('b_device-A')
  const baselineB = await storage.get('b_device-B')
  assert.ok(baselineA, 'Baseline A should exist')
  assert.ok(baselineB, 'Baseline B should exist')
  assert.strictEqual(baselineA.includes['device-A'], 10, 'Baseline A should include all A events')
  assert.strictEqual(baselineB.includes['device-A'], 10, 'Baseline B should include all A events')

  // A does GC - should remove ALL events (all included in baselines)
  await engineA.sync() // Triggers GC

  // Check that ALL events were removed
  const shard0 = await storage.get('e_device-A_0')
  assert.strictEqual(shard0, undefined, 'Shard should be deleted (all events removed)')

  console.log('✓ I1. GC removes events included in all baselines passed')
})

test('I2. GC respects incomplete baselines', async () => {
  const storage = new MemoryStorage()

  // Device A creates 10 events
  const stateA: TestState = { items: {} }
  const { engine: engineA } = createTrackedEngine('device-A', storage, stateA, {
    gcFrequency: 1,
    baselineThreshold: 5, // Force baseline update
  })
  await engineA.initialize()

  for (let i = 1; i <= 10; i++) {
    stateA.items[`a${i}`] = { name: `A${i}` }
    await engineA.recordEvent('create', { id: `a${i}`, name: `A${i}` })
  }

  // Device B syncs only first 5 events
  await storage.set({
    'm_device-B': { last_increment: 0, shards: [0] },
    'b_device-B': {
      includes: { 'device-A': 5 }, // Only includes up to event 5
      state: { items: {} }
    },
  })

  const stateB: TestState = { items: {} }
  const { engine: engineB } = createTrackedEngine('device-B', storage, stateB)
  await engineB.initialize()

  await engineA.sync()
  await engineB.sync()

  // Trigger GC on A
  await engineA.sync()

  // Should keep only events 6-10 (not safe to remove because B baseline only includes up to 5)
  const shard0 = await storage.get('e_device-A_0')
  assert.strictEqual(shard0.length, 5, 'Should keep exactly events 6-10')

  // Verify events 6-10 are there
  assert.strictEqual(shard0[0].increment, 6, 'Should keep event 6')
  assert.strictEqual(shard0[4].increment, 10, 'Should keep event 10')

  console.log('✓ I2. GC respects incomplete baselines passed')
})
