/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { StorageAdapter, KeyChange } from './types.js'

/**
 * Storage adapter for WebExtension storage.sync API
 * Works with both Firefox (browser.storage.sync) and Chrome (chrome.storage.sync)
 */
export class WebExtStorageAdapter implements StorageAdapter {
  private api: any

  constructor() {
    if (typeof globalThis !== 'undefined') {
      // @ts-ignore
      if (globalThis.browser?.storage?.sync) {
        // @ts-ignore
        this.api = globalThis.browser.storage.sync
      // @ts-ignore
      } else if (globalThis.chrome?.storage?.sync) {
        // @ts-ignore
        this.api = globalThis.chrome.storage.sync
      } else {
        throw new Error('WebExtension storage.sync API not available')
      }
    } else {
      throw new Error('WebExtension storage.sync API not available')
    }
  }

  async get(key: string): Promise<any | undefined> {
    const result = await this.api.get(key)
    return result[key]
  }

  async set(items: Record<string, any>): Promise<void> {
    await this.api.set(items)
  }

  async remove(keys: string[]): Promise<void> {
    await this.api.remove(keys)
  }

  async getAll(pattern: string): Promise<Record<string, any>> {
    const all = await this.api.get(null)
    const regex = new RegExp(pattern)
    return Object.keys(all)
      .filter((k) => regex.test(k))
      .reduce((acc, k) => ({ ...acc, [k]: all[k] }), {})
  }

  onChange(callback: (changes: KeyChange[]) => void): void {
    this.api.onChanged.addListener((changes: any) => {
      const keyChanges: KeyChange[] = Object.entries(changes).map(([key, change]: [string, any]) => ({
        key,
        oldValue: change.oldValue,
        newValue: change.newValue,
      }))
      callback(keyChanges)
    })
  }
}
