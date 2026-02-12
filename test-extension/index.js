/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { SyncEngine, WebExtStorageAdapter } from './dist/index.js'

const storage = typeof browser !== 'undefined' ? browser.storage : chrome.storage

let syncEngine = null
let currentDeviceId = null

async function getState() {
  try {
    const result = await storage.local.get('appState')
    return (result && result.appState) || { todos: {} }
  } catch (err) {
    console.error('[getState] Error:', err)
    return { todos: {} }
  }
}

async function setState(state) {
  try {
    await storage.local.set({ appState: state })
  } catch (err) {
    console.error('[setState] Error:', err)
  }
}

async function getDeviceId() {
  try {
    const result = await storage.local.get('deviceId')
    console.log('[getDeviceId] result:', result)
    return (result && result.deviceId) || null
  } catch (err) {
    console.error('[getDeviceId] Error:', err)
    return null
  }
}

async function initEngine(deviceId) {
  console.log('[initEngine] Initializing engine with Device ID:', deviceId)

  const storage = new WebExtStorageAdapter()
  const engine = new SyncEngine(deviceId, storage, {
    debug: true,
    baselineThreshold: 3,
    gcFrequency: 5,
  })

  engine.onApplyEvent(async (event) => {
    console.log('[onApplyEvent] Applying remote event:', event)
    const state = await getState()

    switch (event.op.type) {
      case 'todo:create':
        state.todos[event.op.data.id] = {
          title: event.op.data.title,
          completed: false,
        }
        break
      case 'todo:toggle':
        if (state.todos[event.op.data.id]) {
          state.todos[event.op.data.id].completed = event.op.data.completed
        }
        break
      case 'todo:delete':
        delete state.todos[event.op.data.id]
        break
    }

    await setState(state)
    await render()
  })

  engine.onCreateBaseline(async () => {
    const state = await getState()
    console.log('[onCreateBaseline] Creating baseline:', state)
    return state
  })

  engine.onApplyBaseline(async (newState) => {
    console.log('[onApplyBaseline] Loading baseline:', newState)
    await setState(newState)
    await render()
  })

  await engine.initialize()
  const state = await getState()
  console.log('[initEngine] Engine initialized, state:', state)

  syncEngine = engine
  currentDeviceId = deviceId
}


async function loadDeviceId() {
  const deviceId = await getDeviceId()
  console.log('[loadDeviceId] deviceId:', deviceId)
  const deviceIdEl = document.getElementById('currentDeviceId')
  const deviceIdShortEl = document.getElementById('deviceId')

  if (deviceId) {
    console.log('[loadDeviceId] Setting text to:', deviceId)
    deviceIdEl.textContent = deviceId
    if (deviceIdShortEl) {
      deviceIdShortEl.textContent = deviceId.substring(0, 8) + '...'
    }
    currentDeviceId = deviceId
  } else {
    console.log('[loadDeviceId] No device ID found')
    deviceIdEl.textContent = 'Not configured'
    if (deviceIdShortEl) {
      deviceIdShortEl.textContent = 'Not configured'
    }
  }
}

async function render() {
  const state = await getState()

  // Render todos
  const list = document.getElementById('todoList')
  const todos = Object.entries(state.todos)

  list.innerHTML = ''

  if (todos.length === 0) {
    const p = document.createElement('p')
    p.style.padding = '12px'
    p.style.color = '#999'
    p.textContent = 'No todos yet'
    list.appendChild(p)
  } else {
    todos.forEach(([id, todo]) => {
      const div = document.createElement('div')
      div.className = 'todo-item'

      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.checked = todo.completed
      checkbox.addEventListener('change', () => toggleTodo(id))

      const span = document.createElement('span')
      span.className = 'todo-title'
      span.textContent = todo.title

      const button = document.createElement('button')
      button.textContent = 'Delete'
      button.addEventListener('click', () => deleteTodo(id))

      div.appendChild(checkbox)
      div.appendChild(span)
      div.appendChild(button)
      list.appendChild(div)
    })
  }

  document.getElementById('todoCount').textContent = todos.length

  // Render debug info
  if (!syncEngine) {
    document.getElementById('currentDevice').innerHTML = '<p style="color: #999;">Sync engine not initialized. Set device ID first.</p>'
    document.getElementById('devicesBody').innerHTML = '<tr><td colspan="4" style="text-align: center; color: #999;">Not initialized</td></tr>'
    document.getElementById('eventsBody').innerHTML = '<tr><td colspan="5" style="text-align: center; color: #999;">Not initialized</td></tr>'
    document.getElementById('totalEvents').textContent = '0'
    return
  }

  const debugInfo = await syncEngine.getDebugInfo()

  const currentDeviceEl = document.getElementById('currentDevice')
  currentDeviceEl.innerHTML = `
    <div class="stat">
      <div class="stat-label">Device ID</div>
      <div class="stat-value mono" style="font-size: 14px;">${debugInfo.currentDevice.deviceId.substring(0, 16)}...</div>
    </div>
    <div class="stat">
      <div class="stat-label">Last Increment</div>
      <div class="stat-value">${debugInfo.currentDevice.lastIncrement}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Current Shard</div>
      <div class="stat-value">${debugInfo.currentDevice.currentShard}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Events Since Baseline</div>
      <div class="stat-value">${debugInfo.currentDevice.eventsSinceBaseline}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Syncs Since GC</div>
      <div class="stat-value">${debugInfo.currentDevice.syncsSinceGC}</div>
    </div>
    <div class="stat">
      <div class="stat-label">HLC Time</div>
      <div class="stat-value mono">${debugInfo.currentDevice.hlc.time}</div>
    </div>
    <div class="stat">
      <div class="stat-label">HLC Counter</div>
      <div class="stat-value">${debugInfo.currentDevice.hlc.counter}</div>
    </div>
  `

  const devicesBody = document.getElementById('devicesBody')
  devicesBody.innerHTML = debugInfo.devices.map(device => `
    <tr>
      <td><span class="device-id">${device.deviceId.substring(0, 12)}...</span></td>
      <td class="mono">${device.lastIncrement}</td>
      <td class="mono">${device.shards.join(', ')}</td>
      <td>
        <span class="badge ${device.hasBaseline ? 'badge-success' : 'badge-warning'}">
          ${device.hasBaseline ? '✓' : '✗'}
        </span>
      </td>
    </tr>
  `).join('')

  document.getElementById('totalEvents').textContent = debugInfo.totalEvents

  const eventsBody = document.getElementById('eventsBody')
  if (debugInfo.events.length === 0) {
    eventsBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #999;">No events yet</td></tr>'
  } else {
    const sortedEvents = [...debugInfo.events].sort((a, b) => {
      if (a.hlc.time !== b.hlc.time) return a.hlc.time - b.hlc.time
      return a.hlc.counter - b.hlc.counter
    })

    eventsBody.innerHTML = sortedEvents.map(event => `
      <tr>
        <td><span class="device-id">${event.deviceId.substring(0, 6)}...</span></td>
        <td class="mono">${event.increment}</td>
        <td><code>${event.type}</code></td>
        <td class="mono">${event.hlc.time}:${event.hlc.counter}</td>
        <td class="mono" style="max-width: 250px; overflow: hidden; text-overflow: ellipsis;">
          ${JSON.stringify(event.data)}
        </td>
      </tr>
    `).join('')
  }
}

async function addTodo() {
  if (!syncEngine) {
    console.warn('[addTodo] Sync engine not initialized. Set device ID first.')
    return
  }

  const input = document.getElementById('todoInput')
  const title = input.value.trim()
  if (!title) return

  const id = crypto.randomUUID()

  const state = await getState()
  state.todos[id] = { title, completed: false }
  await setState(state)

  await syncEngine.recordEvent('todo:create', { id, title })
  await render()

  input.value = ''
}

async function toggleTodo(id) {
  if (!syncEngine) {
    console.warn('[toggleTodo] Sync engine not initialized. Set device ID first.')
    return
  }

  const state = await getState()
  if (!state.todos[id]) return

  state.todos[id].completed = !state.todos[id].completed
  await setState(state)

  await syncEngine.recordEvent('todo:toggle', {
    id,
    completed: state.todos[id].completed,
  })
  await render()
}

async function deleteTodo(id) {
  if (!syncEngine) {
    console.warn('[deleteTodo] Sync engine not initialized. Set device ID first.')
    return
  }

  const state = await getState()
  if (!state.todos[id]) return

  delete state.todos[id]
  await setState(state)

  await syncEngine.recordEvent('todo:delete', { id })
  await render()
}

async function manualSync() {
  if (!syncEngine) {
    console.warn('[manualSync] Sync engine not initialized. Set device ID first.')
    return
  }
  console.log('[manualSync] Manual sync triggered')
  const result = await syncEngine.sync()
  console.log('[manualSync] Sync result:', result)
}

async function clearAll() {
  if (!confirm('Clear ALL sync data? This will affect all devices!')) return

  await storage.sync.clear()
  await storage.local.clear()
  console.log('[clearAll] All data cleared.')

  // Reset local state
  syncEngine = null
  currentDeviceId = null

  await render()
  await loadDeviceId()
}

async function checkDeviceIdExists(deviceId) {
  // Use SyncEngine's static method to check if device exists
  const storageAdapter = new WebExtStorageAdapter()
  return await SyncEngine.deviceExists(deviceId, storageAdapter)
}

async function setDeviceId() {
  const input = document.getElementById('deviceIdInput')
  const deviceId = input.value.trim()

  if (!deviceId) {
    console.warn('[setDeviceId] Please enter a device ID')
    return
  }

  try {
    console.log('[setDeviceId] Setting device ID:', deviceId)

    // Check if this device ID already exists in sync storage
    const existingMeta = await checkDeviceIdExists(deviceId)
    if (existingMeta) {
      const state = await getState()
      const hasLocalState = state.todos && Object.keys(state.todos).length > 0
      if (!hasLocalState) {
        const proceed = confirm(
          `WARNING: Device ID "${deviceId}" already exists in sync storage but you have no local data.\n\n` +
          `This usually means you cleared local storage but not sync storage.\n\n` +
          `Continuing might cause data conflicts or loss.\n\n` +
          `Recommendation: Choose a different device ID.\n\n` +
          `Do you want to proceed anyway?`
        )
        if (!proceed) {
          console.warn('[setDeviceId] User cancelled device ID setup due to existing metadata')
          return
        }
      }
    }

    await storage.local.set({ deviceId })
    currentDeviceId = deviceId

    // Update UI directly
    document.getElementById('currentDeviceId').textContent = deviceId
    const deviceIdShortEl = document.getElementById('deviceId')
    if (deviceIdShortEl) {
      deviceIdShortEl.textContent = deviceId.substring(0, 8) + '...'
    }

    await initEngine(deviceId)
    await render()
    input.value = ''
  } catch (err) {
    console.error('[setDeviceId] Error setting device ID:', err)
  }
}

async function init() {
  const deviceId = await getDeviceId()
  if (deviceId) {
    currentDeviceId = deviceId
    await initEngine(deviceId)
  } else {
    console.log('[init] No device ID configured. Waiting for user input.')
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('setDeviceIdBtn').addEventListener('click', setDeviceId)
  document.getElementById('deviceIdInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') setDeviceId()
  })
  document.getElementById('addBtn').addEventListener('click', addTodo)
  document.getElementById('todoInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addTodo()
  })
  document.getElementById('syncBtn').addEventListener('click', async () => {
    await manualSync()
    await render()
  })
  document.getElementById('clearBtn').addEventListener('click', clearAll)

  init().then(async () => {
    await render()
    await loadDeviceId()
  })
})
