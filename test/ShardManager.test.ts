/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { test } from 'node:test'
import assert from 'node:assert'
import { ShardManager } from '../src/ShardManager.js'
import { MAX_KEYVALUE_SIZE } from '../src/constants.js'
import type { Event } from '../src/types.js'

test('ShardManager - initialization with defaults', () => {
  const manager = new ShardManager()

  assert.strictEqual(manager.getCurrentShard(), 0, 'Should start at shard 0')
  assert.deepStrictEqual(manager.getActiveShards(), [0], 'Should have only shard 0 active')

  console.log('✓ Initialization with defaults test passed')
})

test('ShardManager - initialization with existing shards', () => {
  const manager = new ShardManager([0, 1, 2])

  assert.strictEqual(manager.getCurrentShard(), 2, 'Should start at shard 2 (max of existing)')
  assert.deepStrictEqual(manager.getActiveShards(), [0, 1, 2], 'Should have shards 0, 1, 2 active')

  console.log('✓ Initialization with existing shards test passed')
})

test('ShardManager - should not create new shard for small events', () => {
  const manager = new ShardManager()

  const events: Event<any>[] = [
    { increment: 1, hlc_time: 1000, hlc_counter: 0, op: { type: 'test', data: JSON.stringify({ data: 'small' }) } },
    { increment: 2, hlc_time: 1001, hlc_counter: 0, op: { type: 'test', data: JSON.stringify({ data: 'small' }) } },
  ]

  assert.strictEqual(manager.shouldCreateNewShard(events), false, 'Should not create new shard for small events')

  console.log('✓ Should not create new shard for small events test passed')
})

test('ShardManager - should create new shard for large events', () => {
  const manager = new ShardManager()

  // Create a large event that exceeds MAX_KEYVALUE_SIZE
  const largeData = 'x'.repeat(MAX_KEYVALUE_SIZE / 2)
  const events: Event<any>[] = [
    { increment: 1, hlc_time: 1000, hlc_counter: 0, op: { type: 'test', data: JSON.stringify({ data: largeData }) } },
  ]

  assert.strictEqual(manager.shouldCreateNewShard(events), true, 'Should create new shard for large events')

  console.log('✓ Should create new shard for large events test passed')
})

test('ShardManager - create new shard', () => {
  const manager = new ShardManager()

  assert.strictEqual(manager.getCurrentShard(), 0, 'Should start at shard 0')

  const newShard = manager.createNewShard()

  assert.strictEqual(newShard, 1, 'New shard should be 1')
  assert.strictEqual(manager.getCurrentShard(), 1, 'Current shard should be 1')
  assert.deepStrictEqual(manager.getActiveShards(), [0, 1], 'Should have shards 0 and 1 active')

  console.log('✓ Create new shard test passed')
})

test('ShardManager - create multiple new shards', () => {
  const manager = new ShardManager()

  manager.createNewShard() // Creates shard 1
  manager.createNewShard() // Creates shard 2
  manager.createNewShard() // Creates shard 3

  assert.strictEqual(manager.getCurrentShard(), 3, 'Current shard should be 3')
  assert.deepStrictEqual(manager.getActiveShards(), [0, 1, 2, 3], 'Should have shards 0-3 active')

  console.log('✓ Create multiple new shards test passed')
})

test('ShardManager - getActiveShards returns sorted array', () => {
  const manager = new ShardManager([2, 0, 1])

  const shards = manager.getActiveShards()

  assert.deepStrictEqual(shards, [0, 1, 2], 'Shards should be sorted')
  assert.strictEqual(manager.getCurrentShard(), 2, 'Current shard should be max (2)')

  console.log('✓ Get active shards sorted test passed')
})
