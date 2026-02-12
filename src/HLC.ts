/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Hybrid Logical Clock implementation
 *
 * Provides monotonically increasing timestamps that approximate physical time
 * while guaranteeing causality for events with causal relationships.
 */
export class HLC {
  private time: number
  private counter: number

  constructor(initialTime: number = Date.now()) {
    this.time = initialTime
    this.counter = 0
  }

  /**
   * Get current HLC state
   */
  get(): { time: number; counter: number } {
    return { time: this.time, counter: this.counter }
  }

  /**
   * Advance the clock for a new local event
   * If physical time has advanced, use it and reset counter
   * Otherwise increment counter
   */
  advance(): { time: number; counter: number } {
    const now = Date.now()

    if (now > this.time) {
      this.time = now
      this.counter = 0
    } else {
      this.counter++
    }

    return { time: this.time, counter: this.counter }
  }

  /**
   * Update the clock when receiving a remote event
   * Ensures our clock is ahead of the received timestamp
   */
  update(remoteTime: number, remoteCounter: number): void {
    const now = Date.now()

    const maxTime = Math.max(this.time, remoteTime, now)

    if (maxTime === this.time && maxTime === remoteTime) {
      this.counter = Math.max(this.counter, remoteCounter) + 1
    } else if (maxTime === remoteTime) {
      this.time = remoteTime
      this.counter = remoteCounter + 1
    } else {
      this.time = maxTime
      this.counter = 0
    }
  }

  /**
   * Compare two HLC timestamps
   * Returns: -1 if a < b, 0 if a == b, 1 if a > b
   */
  static compare(
    aTime: number,
    aCounter: number,
    aDeviceId: string,
    bTime: number,
    bCounter: number,
    bDeviceId: string
  ): number {
    if (aTime < bTime) return -1
    if (aTime > bTime) return 1

    if (aCounter < bCounter) return -1
    if (aCounter > bCounter) return 1

    if (aDeviceId < bDeviceId) return -1
    if (aDeviceId > bDeviceId) return 1

    return 0
  }
}
