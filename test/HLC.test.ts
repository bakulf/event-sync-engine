/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { test } from 'node:test'
import assert from 'node:assert'
import { HLC } from '../src/HLC.js'

test('HLC - constructor and get', () => {
  const hlc = new HLC(1000)
  const state = hlc.get()

  assert.strictEqual(state.time, 1000, 'Initial time should be 1000')
  assert.strictEqual(state.counter, 0, 'Initial counter should be 0')

  console.log('✓ Constructor and get test passed')
})

test('HLC - constructor with default time', () => {
  const before = Date.now()
  const hlc = new HLC()
  const after = Date.now()
  const state = hlc.get()

  assert.ok(state.time >= before && state.time <= after, 'Initial time should be current timestamp')
  assert.strictEqual(state.counter, 0, 'Initial counter should be 0')

  console.log('✓ Constructor with default time test passed')
})

test('HLC - advance when physical time has advanced', () => {
  const hlc = new HLC(1000)

  // Advance with time greater than initial
  const result = hlc.advance()

  assert.ok(result.time >= 1000, 'Time should advance')
  assert.strictEqual(result.counter, 0, 'Counter should reset to 0')

  const state = hlc.get()
  assert.strictEqual(state.time, result.time, 'State time should match result')
  assert.strictEqual(state.counter, 0, 'State counter should be 0')

  console.log('✓ Advance with physical time test passed')
})

test('HLC - advance when physical time has not advanced', () => {
  // Use a far future time to ensure Date.now() won't exceed it
  const futureTime = Date.now() + 100000
  const hlc = new HLC(futureTime)

  const result1 = hlc.advance()
  assert.strictEqual(result1.time, futureTime, 'Time should stay the same')
  assert.strictEqual(result1.counter, 1, 'Counter should increment to 1')

  const result2 = hlc.advance()
  assert.strictEqual(result2.time, futureTime, 'Time should still stay the same')
  assert.strictEqual(result2.counter, 2, 'Counter should increment to 2')

  console.log('✓ Advance without physical time test passed')
})

test('HLC - update with remote time in the past', () => {
  const now = Date.now()
  const hlc = new HLC(now)
  hlc.advance() // time = now, counter = 0

  // Update with older remote timestamp
  hlc.update(now - 1000, 5)

  const state = hlc.get()
  assert.ok(state.time >= now, 'Time should be at least current time')
  assert.strictEqual(state.counter, 0, 'Counter should be 0 since physical time advanced')

  console.log('✓ Update with remote time in the past test passed')
})

test('HLC - update with remote time in the future', () => {
  const now = Date.now()
  const hlc = new HLC(now)

  // Update with future remote timestamp (beyond current time)
  const futureTime = now + 10000
  hlc.update(futureTime, 3)

  const state = hlc.get()
  assert.strictEqual(state.time, futureTime, 'Time should be updated to remote time')
  assert.strictEqual(state.counter, 4, 'Counter should be remote counter + 1')

  console.log('✓ Update with remote time in the future test passed')
})

test('HLC - update with same time but different counter', () => {
  const hlc = new HLC(5000)
  hlc.advance() // counter becomes 0 or time advances

  // Set to a specific state
  const futureTime = Date.now() + 100000
  hlc.update(futureTime, 10)

  const state1 = hlc.get()
  assert.strictEqual(state1.time, futureTime)
  assert.strictEqual(state1.counter, 11)

  // Update with same time but smaller counter
  hlc.update(futureTime, 5)

  const state2 = hlc.get()
  assert.strictEqual(state2.time, futureTime, 'Time should stay the same')
  assert.strictEqual(state2.counter, 12, 'Counter should be max(local, remote) + 1')

  console.log('✓ Update with same time test passed')
})

test('HLC - update ensures time never goes backwards', () => {
  const futureTime = Date.now() + 100000
  const hlc = new HLC(futureTime)

  // Record initial state
  const state0 = hlc.get()

  // First update with future time
  hlc.update(futureTime + 10000, 5)
  const state1 = hlc.get()

  // Time should have advanced
  assert.ok(state1.time >= state0.time, 'Time should not go backwards after first update')

  // Second update with older timestamp - time should still not go backwards
  hlc.update(futureTime + 5000, 3)
  const state2 = hlc.get()

  // Time component should never decrease
  assert.ok(state2.time >= state1.time, 'Time should never go backwards')

  console.log('✓ Update time never goes backwards test passed')
})

test('HLC - compare returns -1 when first is less', () => {
  const result1 = HLC.compare(1000, 0, 'device-A', 2000, 0, 'device-B')
  assert.strictEqual(result1, -1, 'Should return -1 when time is less')

  const result2 = HLC.compare(1000, 0, 'device-A', 1000, 5, 'device-B')
  assert.strictEqual(result2, -1, 'Should return -1 when time is equal but counter is less')

  const result3 = HLC.compare(1000, 5, 'device-A', 1000, 5, 'device-B')
  assert.strictEqual(result3, -1, 'Should return -1 when time and counter are equal but deviceId is less')

  console.log('✓ Compare returns -1 test passed')
})

test('HLC - compare returns 1 when first is greater', () => {
  const result1 = HLC.compare(2000, 0, 'device-A', 1000, 0, 'device-B')
  assert.strictEqual(result1, 1, 'Should return 1 when time is greater')

  const result2 = HLC.compare(1000, 5, 'device-A', 1000, 0, 'device-B')
  assert.strictEqual(result2, 1, 'Should return 1 when time is equal but counter is greater')

  const result3 = HLC.compare(1000, 5, 'device-B', 1000, 5, 'device-A')
  assert.strictEqual(result3, 1, 'Should return 1 when time and counter are equal but deviceId is greater')

  console.log('✓ Compare returns 1 test passed')
})

test('HLC - compare returns 0 when equal', () => {
  const result = HLC.compare(1000, 5, 'device-A', 1000, 5, 'device-A')
  assert.strictEqual(result, 0, 'Should return 0 when all values are equal')

  console.log('✓ Compare returns 0 test passed')
})

test('HLC - compare lexicographic ordering', () => {
  // Test that deviceId comparison is lexicographic
  const result1 = HLC.compare(1000, 5, 'aaa', 1000, 5, 'zzz')
  assert.strictEqual(result1, -1, 'Should compare deviceId lexicographically (aaa < zzz)')

  const result2 = HLC.compare(1000, 5, 'device-1', 1000, 5, 'device-2')
  assert.strictEqual(result2, -1, 'Should compare deviceId lexicographically (device-1 < device-2)')

  const result3 = HLC.compare(1000, 5, 'device-10', 1000, 5, 'device-2')
  assert.strictEqual(result3, -1, 'Should compare deviceId lexicographically (device-10 < device-2)')

  console.log('✓ Compare lexicographic ordering test passed')
})

test('HLC - multiple updates maintain causality', () => {
  const hlcA = new HLC(1000)
  const hlcB = new HLC(1000)

  // A advances
  const eventA1 = hlcA.advance()

  // B receives A's event
  hlcB.update(eventA1.time, eventA1.counter)

  // B advances (happens-after A's event)
  const eventB1 = hlcB.advance()

  // A receives B's event
  hlcA.update(eventB1.time, eventB1.counter)

  // A's clock should be ahead of or equal to B's event
  const stateA = hlcA.get()
  assert.ok(
    stateA.time > eventB1.time || (stateA.time === eventB1.time && stateA.counter > eventB1.counter),
    'Clock should reflect causality'
  )

  console.log('✓ Multiple updates maintain causality test passed')
})
