/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { StorageAdapter, KeyChange } from './types.js'

/**
 * In-memory storage adapter for testing
 * Simulates a simple key-value store with change notifications
 */
export class MemoryStorage implements StorageAdapter {
  private data: Map<string, any> = new Map()
  private listeners: Array<(changes: KeyChange[]) => void> = []

  async get(key: string): Promise<any | undefined> {
    return this.data.get(key)
  }

  async set(items: Record<string, any>): Promise<void> {
    const changes: KeyChange[] = []

    for (const [key, value] of Object.entries(items)) {
      const oldValue = this.data.get(key)
      this.data.set(key, value)
      changes.push({ key, oldValue, newValue: value })
    }

    for (const listener of this.listeners) {
      setTimeout(() => listener(changes), 0)
    }
  }

  async remove(keys: string[]): Promise<void> {
    const changes: KeyChange[] = []

    for (const key of keys) {
      const oldValue = this.data.get(key)
      this.data.delete(key)
      changes.push({ key, oldValue, newValue: undefined })
    }

    for (const listener of this.listeners) {
      setTimeout(() => listener(changes), 0)
    }
  }

  async getAll(pattern: string): Promise<Record<string, any>> {
    const regex = new RegExp(pattern)
    const result: Record<string, any> = {}

    for (const [key, value] of this.data.entries()) {
      if (regex.test(key)) {
        result[key] = value
      }
    }

    return result
  }

  onChange(callback: (changes: KeyChange[]) => void): void {
    this.listeners.push(callback)
  }

  cleanup(): void {
    this.listeners = []
  }

  /**
   * Utility method for testing: clear all data
   */
  clear(): void {
    this.data.clear()
  }

  /**
   * Utility method for testing: get all keys
   */
  keys(): string[] {
    return Array.from(this.data.keys())
  }
}
