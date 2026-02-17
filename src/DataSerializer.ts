/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { MAX_KEYVALUE_SIZE } from './constants.js'

/**
 * Metadata for serialized data
 */
export interface SerializedMetadata {
  chunks?: number
  fromChunk?: number
  data?: string
}

/**
 * Result of a write operation
 */
export interface WriteResult {
  chunks?: number
  fromChunk?: number
  data?: string
}

/**
 * DataSerializer handles serialization, chunking, and reconstruction of string data
 *
 * All data is stored as strings (JSON-serialized).
 * Chunking strategy:
 * - If data fits in 7KB: store inline (no chunks)
 * - If data > 7KB: split into chunks and store separately
 *
 * Chunk naming: {keyName}_0, {keyName}_1, {keyName}_2, ...
 */
export class DataSerializer {
  private readonly MAX_SIZE = MAX_KEYVALUE_SIZE
  private readonly setFn: (items: Record<string, any>) => Promise<void>
  private readonly getFn: (key: string) => Promise<any>
  private readonly removeFn: (keys: string[]) => Promise<void>

  constructor(
    setFn: (items: Record<string, any>) => Promise<void>,
    getFn: (key: string) => Promise<any>,
    removeFn: (keys: string[]) => Promise<void>
  ) {
    this.setFn = setFn
    this.getFn = getFn
    this.removeFn = removeFn
  }

  /**
   * Write string data with automatic chunking if needed
   *
   * @param keyName Base key name for storage
   * @param data String data to serialize
   * @param fromChunk Optional starting chunk offset (default: 0)
   * @returns Metadata describing how data was stored
   */
  async write(
    keyName: string,
    data: string,
    fromChunk: number = 0
  ): Promise<WriteResult> {
    const size = data.length

    if (size <= this.MAX_SIZE) {
      return {
        data
      }
    }

    const chunks = this.splitString(data)
    const chunkWrites: Record<string, string> = {}

    chunks.forEach((chunk, index) => {
      chunkWrites[`${keyName}_${fromChunk + index}`] = chunk
    })

    await this.setFn(chunkWrites)

    return {
      chunks: chunks.length,
      fromChunk
    }
  }

  /**
   * Read data and reconstruct from chunks if needed
   *
   * @param keyName Base key name
   * @param metadata Metadata describing how data was stored
   * @returns Reconstructed string data
   */
  async read(
    keyName: string,
    metadata: SerializedMetadata
  ): Promise<string> {
    const { chunks, fromChunk, data } = metadata

    if (!chunks) {
      return data || ''
    }

    const offset = fromChunk ?? 0
    const chunkKeys = Array.from({ length: chunks }, (_, i) => `${keyName}_${offset + i}`)
    const chunkData = await Promise.all(
      chunkKeys.map(key => this.getFn(key))
    )

    return chunkData.join('')
  }

  /**
   * Remove all data associated with a key (including chunks)
   *
   * @param keyName Base key name
   * @param metadata Metadata describing what to remove
   */
  async remove(
    keyName: string,
    metadata: SerializedMetadata
  ): Promise<void> {
    const keysToRemove: string[] = [keyName]

    if (metadata.chunks) {
      const offset = metadata.fromChunk ?? 0
      for (let i = 0; i < metadata.chunks; i++) {
        keysToRemove.push(`${keyName}_${offset + i}`)
      }
    }

    await this.removeFn(keysToRemove)
  }

  private splitString(data: string): string[] {
    const chunks: string[] = []
    for (let i = 0; i < data.length; i += this.MAX_SIZE) {
      chunks.push(data.slice(i, i + this.MAX_SIZE))
    }
    return chunks
  }
}
