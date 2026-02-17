/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { test } from 'node:test'
import assert from 'node:assert'
import { DataSerializer } from '../src/DataSerializer.js'
import { MemoryStorage } from '../src/MemoryStorage.js'

// =============================================================================
// Small Data Tests (No Chunking)
// =============================================================================

test('Small string data (no chunking)', async () => {
  const storage = new MemoryStorage()
  const serializer = new DataSerializer(
    (items) => storage.set(items),
    (key) => storage.get(key),
    (keys) => storage.remove(keys)
  )

  const data = JSON.stringify({ id: '123', name: 'Test', items: [1, 2, 3] })
  const result = await serializer.write('test_key', data)

  // Should store inline (no chunks)
  assert.strictEqual(result.chunks, undefined)
  assert.strictEqual(result.data, data)

  // Read back
  const readData = await serializer.read('test_key', result)
  assert.strictEqual(readData, data)

  console.log('✓ Small string data (no chunking) passed')
})

// =============================================================================
// Large Data Tests (With Chunking)
// =============================================================================

test('Large string data (with chunking)', async () => {
  const storage = new MemoryStorage()
  const serializer = new DataSerializer(
    (items) => storage.set(items),
    (key) => storage.get(key),
    (keys) => storage.remove(keys)
  )

  // Create string > 7KB
  const largeString = JSON.stringify({ data: 'x'.repeat(20 * 1024) })  // 20KB+
  const result = await serializer.write('test_key', largeString)

  // Should be chunked
  assert.ok(result.chunks !== undefined)
  assert.ok(result.chunks! > 0)
  assert.strictEqual(result.fromChunk, 0)
  assert.strictEqual(result.data, undefined)  // Data stored in chunks, not inline

  // Verify chunks exist in storage
  for (let i = 0; i < result.chunks!; i++) {
    const chunk = await storage.get(`test_key_${i}`)
    assert.ok(chunk !== undefined)
    assert.strictEqual(typeof chunk, 'string')
  }

  // Read back and verify
  const readData = await serializer.read('test_key', result)
  assert.strictEqual(readData, largeString)

  console.log('✓ Large string data (with chunking) passed')
})

test('Large string with custom chunk offset', async () => {
  const storage = new MemoryStorage()
  const serializer = new DataSerializer(
    (items) => storage.set(items),
    (key) => storage.get(key),
    (keys) => storage.remove(keys)
  )

  const largeString = JSON.stringify({ data: 'x'.repeat(20 * 1024) })
  const fromChunk = 10
  const result = await serializer.write('test_key', largeString, fromChunk)

  assert.ok(result.chunks !== undefined)
  assert.strictEqual(result.fromChunk, fromChunk)

  // Verify chunks start at offset 10
  const chunk = await storage.get(`test_key_${fromChunk}`)
  assert.ok(chunk !== undefined)

  // Read back
  const readData = await serializer.read('test_key', result)
  assert.strictEqual(readData, largeString)

  console.log('✓ Large string with custom chunk offset passed')
})

// =============================================================================
// Remove Tests
// =============================================================================

test('Remove data without chunks', async () => {
  const storage = new MemoryStorage()
  const serializer = new DataSerializer(
    (items) => storage.set(items),
    (key) => storage.get(key),
    (keys) => storage.remove(keys)
  )

  const data = JSON.stringify({ id: '123' })
  const result = await serializer.write('test_key', data)

  // Store the data
  await storage.set({ test_key: result.data })

  // Remove
  await serializer.remove('test_key', result)

  // Verify removed
  const removed = await storage.get('test_key')
  assert.strictEqual(removed, undefined)

  console.log('✓ Remove data without chunks passed')
})

test('Remove data with chunks', async () => {
  const storage = new MemoryStorage()
  const serializer = new DataSerializer(
    (items) => storage.set(items),
    (key) => storage.get(key),
    (keys) => storage.remove(keys)
  )

  const largeString = JSON.stringify({ data: 'x'.repeat(20 * 1024) })
  const result = await serializer.write('test_key', largeString)

  assert.ok(result.chunks !== undefined)

  // Remove
  await serializer.remove('test_key', result)

  // Verify all chunks removed
  for (let i = 0; i < result.chunks!; i++) {
    const chunk = await storage.get(`test_key_${i}`)
    assert.strictEqual(chunk, undefined)
  }

  console.log('✓ Remove data with chunks passed')
})

test('Remove data with custom chunk offset', async () => {
  const storage = new MemoryStorage()
  const serializer = new DataSerializer(
    (items) => storage.set(items),
    (key) => storage.get(key),
    (keys) => storage.remove(keys)
  )

  const largeString = JSON.stringify({ data: 'x'.repeat(20 * 1024) })
  const fromChunk = 5
  const result = await serializer.write('test_key', largeString, fromChunk)

  // Remove
  await serializer.remove('test_key', result)

  // Verify chunks at offset removed
  for (let i = 0; i < result.chunks!; i++) {
    const chunk = await storage.get(`test_key_${fromChunk + i}`)
    assert.strictEqual(chunk, undefined)
  }

  console.log('✓ Remove data with custom chunk offset passed')
})

// =============================================================================
// Edge Cases
// =============================================================================

test('Empty string', async () => {
  const storage = new MemoryStorage()
  const serializer = new DataSerializer(
    (items) => storage.set(items),
    (key) => storage.get(key),
    (keys) => storage.remove(keys)
  )

  const data = ''
  const result = await serializer.write('test_key', data)

  assert.strictEqual(result.chunks, undefined)
  assert.strictEqual(result.data, data)

  const readData = await serializer.read('test_key', result)
  assert.strictEqual(readData, data)

  console.log('✓ Empty string passed')
})

test('String exactly at size limit', async () => {
  const storage = new MemoryStorage()
  const serializer = new DataSerializer(
    (items) => storage.set(items),
    (key) => storage.get(key),
    (keys) => storage.remove(keys)
  )

  // 7168 bytes exactly (the limit)
  const data = 'x'.repeat(7168)
  const result = await serializer.write('test_key', data)

  // Should NOT be chunked
  assert.strictEqual(result.chunks, undefined)
  assert.strictEqual(result.data, data)

  const readData = await serializer.read('test_key', result)
  assert.strictEqual(readData, data)

  console.log('✓ String exactly at size limit passed')
})

test('String just over size limit', async () => {
  const storage = new MemoryStorage()
  const serializer = new DataSerializer(
    (items) => storage.set(items),
    (key) => storage.get(key),
    (keys) => storage.remove(keys)
  )

  // 7169 bytes (one byte over the limit)
  const data = 'x'.repeat(7169)
  const result = await serializer.write('test_key', data)

  // Should be chunked
  assert.ok(result.chunks !== undefined)
  assert.ok(result.chunks! > 0)

  const readData = await serializer.read('test_key', result)
  assert.strictEqual(readData, data)

  console.log('✓ String just over size limit passed')
})

test('Chunked data integrity - complex content', async () => {
  const storage = new MemoryStorage()
  const serializer = new DataSerializer(
    (items) => storage.set(items),
    (key) => storage.get(key),
    (keys) => storage.remove(keys)
  )

  // Create complex data with various characters, numbers, unicode
  const complexData = JSON.stringify({
    text: 'Hello 世界 🌍 '.repeat(500),
    numbers: Array.from({ length: 1000 }, (_, i) => i),
    nested: {
      deep: {
        values: 'test'.repeat(200)
      }
    },
    special: '特殊字符 émojis 🎉🎊🎈 symbols @#$%^&*()'.repeat(100)
  })

  // Verify it's large enough to be chunked
  assert.ok(complexData.length > 7168, 'Data should be large enough to require chunking')

  // Write the data
  const result = await serializer.write('test_key', complexData)

  // Verify it was chunked
  assert.ok(result.chunks !== undefined, 'Data should be chunked')
  assert.ok(result.chunks! > 1, 'Should have multiple chunks')
  assert.strictEqual(result.data, undefined, 'Should not have inline data')

  // Read it back
  const reconstructed = await serializer.read('test_key', result)

  // Verify integrity
  assert.strictEqual(reconstructed, complexData, 'Reconstructed data should match original exactly')
  assert.strictEqual(reconstructed.length, complexData.length, 'Length should match')

  // Verify the data can be parsed back to the original object
  const originalObj = JSON.parse(complexData)
  const reconstructedObj = JSON.parse(reconstructed)
  assert.deepStrictEqual(reconstructedObj, originalObj, 'Parsed objects should match')

  console.log('✓ Chunked data integrity - complex content passed')
})
