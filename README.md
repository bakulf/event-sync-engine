# Event Sync Engine

Distributed event sourcing sync engine designed for **browser extensions** (Chrome/Firefox) using the **WebExtension storage.sync API**.

## Overview

This engine enables conflict-free, eventually consistent data synchronization across multiple browser instances using event sourcing and Hybrid Logical Clocks (HLC). It's specifically designed to work within the constraints of `browser.storage.sync` / `chrome.storage.sync` APIs.

## Features

- **Event Sourcing**: Store changes as immutable events, not state snapshots
- **HLC Ordering**: Deterministic event ordering despite clock drift
- **Conflict-Free**: Guaranteed eventual consistency across devices
- **Automatic Serialization**: All data automatically serialized as JSON strings
- **Automatic Chunking**: Large data (>7KB) automatically split into chunks
- **Garbage Collection**: Baseline-based automatic cleanup of old events and chunks
- **Inactive Device Removal**: Optional automatic cleanup of devices inactive for extended periods
- **Sharding**: Automatic event sharding to respect storage.sync 8KB limit
- **Concurrency Protection**: Operation-level locking prevents race conditions
- **Testable**: Built-in memory storage for testing
- **Storage Agnostic**: Abstract interface with storage.sync adapter
- **TypeScript**: Full type safety with generics

## Installation

```bash
npm install event-sync-engine
```

## Quick Start

### 1. Define Your Types

```typescript
import { SyncEngine, WebExtStorageAdapter } from 'event-sync-engine'

interface TodoState {
  todos: Record<string, { title: string; completed: boolean }>
}

interface TodoEventData {
  id: string
  title?: string
  completed?: boolean
}
```

### 2. Initialize Sync Engine

```typescript
const deviceId = await getOrCreateDeviceId() // Generate UUID once
const storage = new WebExtStorageAdapter() // Automatically detects browser.storage.sync or chrome.storage.sync
const engine = new SyncEngine<TodoState, TodoEventData>(deviceId, storage)

// Your application state
let appState: TodoState = { todos: {} }

// Register event handler for remote events
engine.onApplyEvent((event) => {
  // Application manages its own state
  switch (event.op.type) {
    case 'todo:create':
      appState.todos[event.op.data.id] = {
        title: event.op.data.title!,
        completed: false
      }
      break
    case 'todo:toggle':
      if (appState.todos[event.op.data.id]) {
        appState.todos[event.op.data.id].completed = event.op.data.completed!
      }
      break
  }
  // Update UI or notify app of state change
  renderApp()
})

// Register baseline handlers
engine.onCreateBaseline(() => appState)
engine.onApplyBaseline((state) => {
  appState = state
  renderApp()
})

// Initialize
await engine.initialize()
```

### 3. Record Events

**Important**: Apply the operation to your state BEFORE calling `recordEvent()`.

All data is automatically serialized as JSON and chunked if needed (>7KB):

```typescript
// Record an event with any serializable data
const newTodo = {
  id: generateId(),
  title: 'Buy milk',
  completed: false
}
appState.todos[newTodo.id] = newTodo
renderApp()
await engine.recordEvent('todo:create', {
  id: newTodo.id,
  title: newTodo.title
})

// Large data is automatically chunked
const largeNote = {
  id: generateId(),
  content: 'x'.repeat(50 * 1024) // 50KB of text
}
await engine.recordEvent('note:create', largeNote)
```

**Note**: All data is automatically serialized as JSON strings internally. Data larger than 7KB is automatically chunked to respect storage.sync limits.

### 4. Sync

```typescript
// Sync is triggered automatically on storage.sync changes
// Or manually:
await engine.sync()
```

## Key Concepts

### State Management

**Your application owns and manages its state.** SyncEngine only:
- Records local events for synchronization
- Notifies you of remote events to apply

### Event Flow

**Local events** (originated on this device):
1. Application applies operation to its state
2. Application calls `recordEvent()` to record for sync
3. SyncEngine saves event to storage.sync

**Remote events** (from other devices):
1. SyncEngine detects change in storage.sync
2. SyncEngine calls your `onApplyEvent` handler
3. Application applies event to its state

### Automatic Serialization and Chunking

All data is automatically serialized as JSON and transparently chunked if needed:

**Serialization**:
- Event data is automatically serialized to JSON when recorded
- Event handlers receive deserialized data (parsed objects)
- Baseline data is automatically serialized when created
- Baseline handlers receive deserialized state

**Chunking Behavior**:
- Data >7KB is automatically chunked and stored as multiple storage keys
- Chunks are transparently reconstructed during sync
- Multiple chunked events can coexist in the same shard with different offsets
- Garbage collection automatically removes chunks when events are deleted

**Example**:

```typescript
// Small event - stored inline
await engine.recordEvent('user:update', { id: '123', name: 'John' })

// Large event - automatically chunked
const largeNote = {
  id: '456',
  content: 'x'.repeat(50 * 1024) // 50KB
}
await engine.recordEvent('note:save', largeNote)

// In your event handler, data is already deserialized
engine.onApplyEvent((event) => {
  console.log('Event type:', event.op.type)
  console.log('Event data:', event.op.data) // Already parsed object
})

// Baselines work the same way
engine.onCreateBaseline(() => appState) // Returns state object
engine.onApplyBaseline((state) => {
  appState = state // Receives deserialized state object
  renderApp()
})
```

## Configuration

The SyncEngine constructor accepts an optional configuration object:

```typescript
const engine = new SyncEngine<State, EventData>(deviceId, storage, {
  baselineThreshold: 15,
  gcFrequency: 10,
  removeInactiveDevices: false,
  inactiveDeviceTimeout: 60 * 24 * 60 * 60 * 1000,
  debug: false
})
```

**Options:**
- `baselineThreshold`: Number of events before triggering baseline update (default: 15)
- `gcFrequency`: Number of syncs between garbage collection runs (default: 10)
- `removeInactiveDevices`: Enable automatic removal of inactive devices (default: false)
- `inactiveDeviceTimeout`: Milliseconds after which a device is considered inactive (default: 60 days)
- `debug`: Enable debug logging (default: false)

### Inactive Device Removal

When enabled, devices that haven't synced for the configured timeout period are automatically removed during garbage collection. This helps:
- Free storage quota in storage.sync
- Clean up abandoned devices
- Prevent accumulation of stale data

**Important:** Removed devices can rejoin seamlessly by bootstrapping from remaining active devices.

## Architecture

See [ARCHITECTURE.md](./docs/ARCHITECTURE.md) for detailed design documentation.

## Browser Compatibility

- Firefox (via `browser.storage.sync`)
- Chrome (via `chrome.storage.sync`)
- Edge (via `chrome.storage.sync`)
- Safari (via `browser.storage.sync`)

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run watch

# Test
npm test
```

### Testing with Real Browser Extension

The `test-extension/` directory contains a minimal browser extension for testing with real `storage.sync` API:

```bash
# Build library first
npm run build

# Load test-extension/ in Chrome/Firefox as unpacked extension
# See test-extension/README.md for detailed instructions
```

This allows you to:
- Test real storage.sync behavior (limits, latency, sync)
- Test multi-device sync across browser instances
- Inspect storage keys and verify sharding/GC
- Test concurrent operations and conflict resolution

## License

MPL-2.0

## Credits

Developed for [Firefox Multi-Account Containers](https://github.com/mozilla/multi-account-containers).
