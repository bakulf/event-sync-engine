/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const storage = typeof browser !== 'undefined' ? browser.storage : chrome.storage

function generateDeviceId(name) {
  return `device-${name}-${Math.random().toString(36).substring(2, 15)}`
}

function createTodoEvent(increment, hlcTime, hlcCounter, type, id, data = {}) {
  return {
    increment,
    hlc_time: hlcTime,
    hlc_counter: hlcCounter,
    op: {
      type,
      data: { id, ...data }
    }
  }
}

export const scenarios = {
  'bootstrap-complete': {
    name: 'Bootstrap Complete',
    description: 'Device with 20 events, all included in baseline',
    async setup() {
      const deviceId = generateDeviceId('alpha')
      const baseTime = Date.now() - (7 * 24 * 60 * 60 * 1000)

      const events = []
      for (let i = 1; i <= 20; i++) {
        events.push(createTodoEvent(
          i,
          baseTime + (i * 60 * 1000),
          0,
          'todo:create',
          `todo-${i}`,
          { title: `Task ${i}` }
        ))
      }

      const todos = {}
      events.forEach(e => {
        todos[e.op.data.id] = { title: e.op.data.title, completed: false }
      })

      await storage.sync.set({
        [`m_${deviceId}`]: {
          version: 1,
          last_increment: 20,
          shards: [0]
        },
        [`e_${deviceId}_0`]: events,
        [`b_${deviceId}`]: {
          includes: { [deviceId]: 20 },
          state: { todos }
        },
        [`s_${deviceId}`]: {
          increments: {},
          lastActive: Date.now()
        }
      })

      console.log('[Scenario] Bootstrap Complete - 20 events, all in baseline')
      return generateDeviceId('observer')
    },
    async validate(state) {
      const todoCount = Object.keys(state.todos || {}).length
      if (todoCount !== 20) {
        throw new Error(`Expected 20 todos, found ${todoCount}`)
      }
      for (let i = 1; i <= 20; i++) {
        const todoId = `todo-${i}`
        if (!state.todos[todoId]) {
          throw new Error(`Missing todo: ${todoId}`)
        }
        if (state.todos[todoId].title !== `Task ${i}`) {
          throw new Error(`Wrong title for ${todoId}: ${state.todos[todoId].title}`)
        }
      }
      return true
    }
  },

  'bootstrap-partial': {
    name: 'Bootstrap Partial',
    description: 'Device with 20 events, only first 10 in baseline',
    async setup() {
      const deviceId = generateDeviceId('alpha')
      const baseTime = Date.now() - (7 * 24 * 60 * 60 * 1000)

      const events = []
      for (let i = 1; i <= 20; i++) {
        events.push(createTodoEvent(
          i,
          baseTime + (i * 60 * 1000),
          0,
          'todo:create',
          `todo-${i}`,
          { title: `Task ${i}` }
        ))
      }

      const todosInBaseline = {}
      events.slice(0, 10).forEach(e => {
        todosInBaseline[e.op.data.id] = { title: e.op.data.title, completed: false }
      })

      await storage.sync.set({
        [`m_${deviceId}`]: {
          version: 1,
          last_increment: 20,
          shards: [0]
        },
        [`e_${deviceId}_0`]: events,
        [`b_${deviceId}`]: {
          includes: { [deviceId]: 10 },
          state: { todos: todosInBaseline }
        },
        [`s_${deviceId}`]: {
          increments: {},
          lastActive: Date.now()
        }
      })

      console.log('[Scenario] Bootstrap Partial - 20 events, first 10 in baseline')
      return generateDeviceId('observer')
    },
    async validate(state) {
      const todoCount = Object.keys(state.todos || {}).length
      if (todoCount !== 20) {
        throw new Error(`Expected 20 todos (10 from baseline + 10 from events), found ${todoCount}`)
      }
      for (let i = 1; i <= 20; i++) {
        const todoId = `todo-${i}`
        if (!state.todos[todoId]) {
          throw new Error(`Missing todo: ${todoId}`)
        }
      }
      return true
    }
  },

  'bootstrap-multi-device': {
    name: 'Bootstrap Multi-Device',
    description: 'New device bootstraps into system with 3 active devices',
    async setup() {
      const devices = ['alpha', 'beta', 'gamma'].map(generateDeviceId)
      const baseTime = Date.now() - (3 * 24 * 60 * 60 * 1000)

      const deviceEvents = []

      for (let i = 0; i < devices.length; i++) {
        const deviceId = devices[i]
        const events = []

        for (let j = 1; j <= 5; j++) {
          const idx = i * 5 + j
          const event = createTodoEvent(
            j,
            baseTime + (idx * 60 * 1000),
            0,
            'todo:create',
            `todo-${idx}`,
            { title: `Task ${idx} from ${deviceId.split('-')[1]}` }
          )
          events.push(event)
        }

        deviceEvents.push({ deviceId, events })
      }

      const allTodos = {}
      deviceEvents.forEach(de => {
        de.events.forEach(e => {
          allTodos[e.op.data.id] = {
            title: e.op.data.title,
            completed: false
          }
        })
      })

      const allData = {}

      for (let i = 0; i < deviceEvents.length; i++) {
        const { deviceId, events } = deviceEvents[i]

        const allIncrements = {}
        devices.forEach(d => {
          if (d !== deviceId) allIncrements[d] = 5
        })

        allData[`m_${deviceId}`] = {
          version: 1,
          last_increment: 5,
          shards: [0]
        }
        allData[`e_${deviceId}_0`] = events
        allData[`b_${deviceId}`] = {
          includes: { [deviceId]: 5, ...allIncrements },
          state: { todos: allTodos }
        }
        allData[`s_${deviceId}`] = {
          increments: allIncrements,
          lastActive: Date.now() - (i * 60 * 60 * 1000)
        }
      }

      await storage.sync.set(allData)

      console.log('[Scenario] Bootstrap Multi-Device - new device joins system with 3 devices')
      return generateDeviceId('observer')
    },
    async validate(state) {
      const todoCount = Object.keys(state.todos || {}).length
      if (todoCount !== 15) {
        throw new Error(`Expected 15 todos (5 from each of 3 devices), found ${todoCount}`)
      }
      for (let i = 1; i <= 15; i++) {
        const todoId = `todo-${i}`
        if (!state.todos[todoId]) {
          throw new Error(`Missing todo: ${todoId}`)
        }
      }
      return true
    }
  },

  'pending-updates': {
    name: 'Pending Updates',
    description: 'Device A has new events that Device B hasn\'t seen',
    async setup() {
      const deviceA = generateDeviceId('alpha')
      const deviceB = generateDeviceId('beta')
      const baseTime = Date.now() - (24 * 60 * 60 * 1000)

      const eventsA = []
      for (let i = 1; i <= 10; i++) {
        eventsA.push(createTodoEvent(
          i,
          baseTime + (i * 60 * 1000),
          0,
          'todo:create',
          `todo-a-${i}`,
          { title: `Task A${i}` }
        ))
      }

      const eventsB = []
      for (let i = 1; i <= 3; i++) {
        eventsB.push(createTodoEvent(
          i,
          baseTime + ((i + 5) * 60 * 1000),
          0,
          'todo:create',
          `todo-b-${i}`,
          { title: `Task B${i}` }
        ))
      }

      const todosA = {}
      eventsA.forEach(e => {
        todosA[e.op.data.id] = { title: e.op.data.title, completed: false }
      })
      eventsB.forEach(e => {
        todosA[e.op.data.id] = { title: e.op.data.title, completed: false }
      })

      const todosB = {}
      eventsA.slice(0, 5).forEach(e => {
        todosB[e.op.data.id] = { title: e.op.data.title, completed: false }
      })
      eventsB.forEach(e => {
        todosB[e.op.data.id] = { title: e.op.data.title, completed: false }
      })

      await storage.sync.set({
        [`m_${deviceA}`]: {
          version: 1,
          last_increment: 10,
          shards: [0]
        },
        [`e_${deviceA}_0`]: eventsA,
        [`b_${deviceA}`]: {
          includes: { [deviceA]: 10, [deviceB]: 3 },
          state: { todos: todosA }
        },
        [`s_${deviceA}`]: {
          increments: { [deviceB]: 3 },
          lastActive: Date.now()
        },
        [`m_${deviceB}`]: {
          version: 1,
          last_increment: 3,
          shards: [0]
        },
        [`e_${deviceB}_0`]: eventsB,
        [`b_${deviceB}`]: {
          includes: { [deviceA]: 5, [deviceB]: 3 },
          state: { todos: todosB }
        },
        [`s_${deviceB}`]: {
          increments: { [deviceA]: 5 },
          lastActive: Date.now() - (2 * 60 * 60 * 1000)
        }
      })

      console.log('[Scenario] Pending updates - Device A has 10 events, B only saw 5')
      return {
        deviceId: deviceB,
        localState: {
          appState: { todos: todosB }
        }
      }
    },
    async validate(state) {
      const todoCount = Object.keys(state.todos || {}).length
      if (todoCount !== 13) {
        throw new Error(`Expected 13 todos (10 from A + 3 from B), found ${todoCount}`)
      }
      for (let i = 1; i <= 10; i++) {
        const todoId = `todo-a-${i}`
        if (!state.todos[todoId]) {
          throw new Error(`Missing todo from device A: ${todoId}`)
        }
      }
      for (let i = 1; i <= 3; i++) {
        const todoId = `todo-b-${i}`
        if (!state.todos[todoId]) {
          throw new Error(`Missing todo from device B: ${todoId}`)
        }
      }
      return true
    }
  },

  'multiple-shards': {
    name: 'Multiple Shards',
    description: 'Bootstrap with 3 events in baseline + 6 events across shards 1-2',
    async setup() {
      const deviceId = generateDeviceId('alpha')
      const baseTime = Date.now() - (5 * 24 * 60 * 60 * 1000)

      const largeData = 'x'.repeat(2000)
      const shard0 = []
      const shard1 = []
      const shard2 = []

      for (let i = 1; i <= 3; i++) {
        shard0.push(createTodoEvent(
          i,
          baseTime + (i * 60 * 1000),
          0,
          'todo:create',
          `todo-${i}`,
          { title: `Task ${i}`, notes: largeData }
        ))
      }

      for (let i = 4; i <= 6; i++) {
        shard1.push(createTodoEvent(
          i,
          baseTime + (i * 60 * 1000),
          0,
          'todo:create',
          `todo-${i}`,
          { title: `Task ${i}`, notes: largeData }
        ))
      }

      for (let i = 7; i <= 9; i++) {
        shard2.push(createTodoEvent(
          i,
          baseTime + (i * 60 * 1000),
          0,
          'todo:create',
          `todo-${i}`,
          { title: `Task ${i}`, notes: largeData }
        ))
      }

      const todosInBaseline = {}
      shard0.forEach(e => {
        todosInBaseline[e.op.data.id] = { title: e.op.data.title, completed: false }
      })

      await storage.sync.set({
        [`m_${deviceId}`]: {
          version: 1,
          last_increment: 9,
          shards: [0, 1, 2]
        },
        [`e_${deviceId}_0`]: shard0,
        [`e_${deviceId}_1`]: shard1,
        [`e_${deviceId}_2`]: shard2,
        [`b_${deviceId}`]: {
          includes: { [deviceId]: 3 },
          state: { todos: todosInBaseline }
        },
        [`s_${deviceId}`]: {
          increments: {},
          lastActive: Date.now()
        }
      })

      console.log('[Scenario] Multiple Shards - 3 in baseline, 6 to read from shards 1-2')
      return generateDeviceId('observer')
    },
    async validate(state) {
      const todoCount = Object.keys(state.todos || {}).length
      if (todoCount !== 9) {
        throw new Error(`Expected 9 todos (3 per shard across 3 shards), found ${todoCount}`)
      }
      for (let i = 1; i <= 9; i++) {
        const todoId = `todo-${i}`
        if (!state.todos[todoId]) {
          throw new Error(`Missing todo: ${todoId}`)
        }
        if (state.todos[todoId].title !== `Task ${i}`) {
          throw new Error(`Wrong title for ${todoId}: ${state.todos[todoId].title}`)
        }
      }
      return true
    }
  },

  'inactive-devices': {
    name: 'Inactive Devices',
    description: 'Mix of active and inactive devices (>60 days)',
    async setup() {
      const activeDevice = generateDeviceId('active')
      const oldDevice1 = generateDeviceId('old-1')
      const oldDevice2 = generateDeviceId('old-2')

      const baseTime = Date.now() - (10 * 24 * 60 * 60 * 1000)
      const oldTime = Date.now() - (70 * 24 * 60 * 60 * 1000)

      const eventsActive = []
      for (let i = 1; i <= 5; i++) {
        eventsActive.push(createTodoEvent(
          i,
          baseTime + (i * 60 * 1000),
          0,
          'todo:create',
          `todo-active-${i}`,
          { title: `Active Task ${i}` }
        ))
      }

      const eventsOld = []
      for (let i = 1; i <= 3; i++) {
        eventsOld.push(createTodoEvent(
          i,
          oldTime + (i * 60 * 1000),
          0,
          'todo:create',
          `todo-old-${i}`,
          { title: `Old Task ${i}` }
        ))
      }

      const todosActive = {}
      eventsActive.forEach(e => {
        todosActive[e.op.data.id] = { title: e.op.data.title, completed: false }
      })

      const todosOld = {}
      eventsOld.forEach(e => {
        todosOld[e.op.data.id] = { title: e.op.data.title, completed: false }
      })

      await storage.sync.set({
        [`m_${activeDevice}`]: {
          version: 1,
          last_increment: 5,
          shards: [0]
        },
        [`e_${activeDevice}_0`]: eventsActive,
        [`b_${activeDevice}`]: {
          includes: { [activeDevice]: 5 },
          state: { todos: todosActive }
        },
        [`s_${activeDevice}`]: {
          increments: {},
          lastActive: Date.now()
        },
        [`m_${oldDevice1}`]: {
          version: 1,
          last_increment: 3,
          shards: [0]
        },
        [`e_${oldDevice1}_0`]: eventsOld,
        [`b_${oldDevice1}`]: {
          includes: { [oldDevice1]: 3 },
          state: { todos: todosOld }
        },
        [`s_${oldDevice1}`]: {
          increments: {},
          lastActive: oldTime
        },
        [`m_${oldDevice2}`]: {
          version: 1,
          last_increment: 3,
          shards: [0]
        },
        [`e_${oldDevice2}_0`]: eventsOld,
        [`b_${oldDevice2}`]: {
          includes: { [oldDevice2]: 3 },
          state: { todos: todosOld }
        },
        [`s_${oldDevice2}`]: {
          increments: {},
          lastActive: oldTime
        }
      })

      console.log('[Scenario] Inactive devices - 1 active, 2 inactive (70 days old)')
      return generateDeviceId('observer')
    }
  },

  'baseline-mismatch': {
    name: 'Baseline Mismatch',
    description: 'Devices with baselines at different levels',
    async setup() {
      const deviceA = generateDeviceId('alpha')
      const deviceB = generateDeviceId('beta')
      const baseTime = Date.now() - (5 * 24 * 60 * 60 * 1000)

      const eventsA = []
      for (let i = 1; i <= 15; i++) {
        eventsA.push(createTodoEvent(
          i,
          baseTime + (i * 60 * 1000),
          0,
          'todo:create',
          `todo-a-${i}`,
          { title: `Task A${i}` }
        ))
      }

      const eventsB = []
      for (let i = 1; i <= 8; i++) {
        eventsB.push(createTodoEvent(
          i,
          baseTime + ((i + 7) * 60 * 1000),
          0,
          'todo:create',
          `todo-b-${i}`,
          { title: `Task B${i}` }
        ))
      }

      const todosA = {}
      eventsA.forEach(e => {
        todosA[e.op.data.id] = { title: e.op.data.title, completed: false }
      })
      eventsB.forEach(e => {
        todosA[e.op.data.id] = { title: e.op.data.title, completed: false }
      })

      const todosB = {}
      eventsA.slice(0, 5).forEach(e => {
        todosB[e.op.data.id] = { title: e.op.data.title, completed: false }
      })
      eventsB.forEach(e => {
        todosB[e.op.data.id] = { title: e.op.data.title, completed: false }
      })

      await storage.sync.set({
        [`m_${deviceA}`]: {
          version: 1,
          last_increment: 15,
          shards: [0]
        },
        [`e_${deviceA}_0`]: eventsA,
        [`b_${deviceA}`]: {
          includes: { [deviceA]: 15, [deviceB]: 8 },
          state: { todos: todosA }
        },
        [`s_${deviceA}`]: {
          increments: { [deviceB]: 8 },
          lastActive: Date.now()
        },
        [`m_${deviceB}`]: {
          version: 1,
          last_increment: 8,
          shards: [0]
        },
        [`e_${deviceB}_0`]: eventsB,
        [`b_${deviceB}`]: {
          includes: { [deviceA]: 5, [deviceB]: 8 },
          state: { todos: todosB }
        },
        [`s_${deviceB}`]: {
          increments: { [deviceA]: 5 },
          lastActive: Date.now() - (12 * 60 * 60 * 1000)
        }
      })

      console.log('[Scenario] Baseline mismatch - A baseline at 15, B baseline at 5')
      return {
        deviceId: deviceB,
        localState: {
          appState: { todos: todosB }
        }
      }
    },
    async validate(state) {
      const todoCount = Object.keys(state.todos || {}).length
      if (todoCount !== 23) {
        throw new Error(`Expected 23 todos (15 from A + 8 from B), found ${todoCount}`)
      }
      for (let i = 1; i <= 15; i++) {
        const todoId = `todo-a-${i}`
        if (!state.todos[todoId]) {
          throw new Error(`Missing todo from device A: ${todoId}`)
        }
      }
      for (let i = 1; i <= 8; i++) {
        const todoId = `todo-b-${i}`
        if (!state.todos[todoId]) {
          throw new Error(`Missing todo from device B: ${todoId}`)
        }
      }
      return true
    }
  },

  'concurrent-events': {
    name: 'Concurrent Events',
    description: 'Events with similar HLC times (tests ordering)',
    async setup() {
      const deviceA = generateDeviceId('alpha')
      const deviceB = generateDeviceId('beta')
      const deviceC = generateDeviceId('gamma')

      const baseTime = Date.now() - (24 * 60 * 60 * 1000)

      const eventsA = [
        createTodoEvent(1, baseTime, 0, 'todo:create', 'todo-1', { title: 'Task 1' }),
        createTodoEvent(2, baseTime, 5, 'todo:create', 'todo-2', { title: 'Task 2' }),
        createTodoEvent(3, baseTime + 1000, 0, 'todo:create', 'todo-3', { title: 'Task 3' })
      ]

      const eventsB = [
        createTodoEvent(1, baseTime, 2, 'todo:create', 'todo-4', { title: 'Task 4' }),
        createTodoEvent(2, baseTime, 7, 'todo:create', 'todo-5', { title: 'Task 5' })
      ]

      const eventsC = [
        createTodoEvent(1, baseTime, 3, 'todo:create', 'todo-6', { title: 'Task 6' }),
        createTodoEvent(2, baseTime + 500, 0, 'todo:create', 'todo-7', { title: 'Task 7' })
      ]

      const todosA = {}
      eventsA.forEach(e => {
        todosA[e.op.data.id] = { title: e.op.data.title, completed: false }
      })

      const todosB = {}
      eventsB.forEach(e => {
        todosB[e.op.data.id] = { title: e.op.data.title, completed: false }
      })

      const todosC = {}
      eventsC.forEach(e => {
        todosC[e.op.data.id] = { title: e.op.data.title, completed: false }
      })

      await storage.sync.set({
        [`m_${deviceA}`]: { version: 1, last_increment: 3, shards: [0] },
        [`e_${deviceA}_0`]: eventsA,
        [`b_${deviceA}`]: { includes: { [deviceA]: 3 }, state: { todos: todosA } },
        [`s_${deviceA}`]: { increments: {}, lastActive: Date.now() },

        [`m_${deviceB}`]: { version: 1, last_increment: 2, shards: [0] },
        [`e_${deviceB}_0`]: eventsB,
        [`b_${deviceB}`]: { includes: { [deviceB]: 2 }, state: { todos: todosB } },
        [`s_${deviceB}`]: { increments: {}, lastActive: Date.now() },

        [`m_${deviceC}`]: { version: 1, last_increment: 2, shards: [0] },
        [`e_${deviceC}_0`]: eventsC,
        [`b_${deviceC}`]: { includes: { [deviceC]: 2 }, state: { todos: todosC } },
        [`s_${deviceC}`]: { increments: {}, lastActive: Date.now() }
      })

      console.log('[Scenario] Concurrent events - multiple events at same HLC time')
      return generateDeviceId('observer')
    },
    async validate(state) {
      const todoCount = Object.keys(state.todos || {}).length
      if (todoCount !== 7) {
        throw new Error(`Expected 7 todos (3 from A, 2 from B, 2 from C), found ${todoCount}`)
      }
      for (let i = 1; i <= 7; i++) {
        const todoId = `todo-${i}`
        if (!state.todos[todoId]) {
          throw new Error(`Missing todo: ${todoId}`)
        }
        if (state.todos[todoId].title !== `Task ${i}`) {
          throw new Error(`Wrong title for ${todoId}: ${state.todos[todoId].title}`)
        }
      }
      return true
    }
  },

  'missing-events': {
    name: 'Missing Events',
    description: 'Events with gaps in increments (tests resilience)',
    async setup() {
      const deviceId = generateDeviceId('alpha')
      const baseTime = Date.now() - (24 * 60 * 60 * 1000)

      const events = [
        createTodoEvent(1, baseTime, 0, 'todo:create', 'todo-1', { title: 'Task 1' }),
        createTodoEvent(2, baseTime + 1000, 0, 'todo:create', 'todo-2', { title: 'Task 2' }),
        createTodoEvent(5, baseTime + 4000, 0, 'todo:create', 'todo-5', { title: 'Task 5' }),
        createTodoEvent(7, baseTime + 6000, 0, 'todo:create', 'todo-7', { title: 'Task 7' }),
        createTodoEvent(10, baseTime + 9000, 0, 'todo:create', 'todo-10', { title: 'Task 10' })
      ]

      const todos = {}
      events.forEach(e => {
        todos[e.op.data.id] = { title: e.op.data.title, completed: false }
      })

      await storage.sync.set({
        [`m_${deviceId}`]: {
          version: 1,
          last_increment: 10,
          shards: [0]
        },
        [`e_${deviceId}_0`]: events,
        [`b_${deviceId}`]: {
          includes: { [deviceId]: 10 },
          state: { todos }
        },
        [`s_${deviceId}`]: {
          increments: {},
          lastActive: Date.now()
        }
      })

      console.log('[Scenario] Missing events - gaps at increments 3,4,6,8,9')
      return generateDeviceId('observer')
    },
    async validate(state) {
      const todoCount = Object.keys(state.todos || {}).length
      if (todoCount !== 5) {
        throw new Error(`Expected 5 todos (with gaps in increments), found ${todoCount}`)
      }
      const expectedTodos = ['todo-1', 'todo-2', 'todo-5', 'todo-7', 'todo-10']
      for (const todoId of expectedTodos) {
        if (!state.todos[todoId]) {
          throw new Error(`Missing expected todo: ${todoId}`)
        }
      }
      return true
    }
  },

  'almost-full': {
    name: 'Almost Full Storage',
    description: 'Creates shards until quota limit, tests GC cleanup',
    async setup() {
      const deviceId = generateDeviceId('alpha')
      // Events from 1 year ago - old enough to be GC'd after baseline
      const baseTime = Date.now() - (365 * 24 * 60 * 60 * 1000)

      let successfulEvents = 0
      const batchSize = 10

      try {
        for (let batch = 0; batch < 100; batch++) {
          const allData = {}
          const startIdx = batch * batchSize

          for (let i = 0; i < batchSize; i++) {
            const eventNum = startIdx + i + 1
            const event = createTodoEvent(
              eventNum,
              baseTime + (eventNum * 1000),
              0,
              'todo:create',
              `todo-${eventNum}`,
              { title: `T${eventNum}` }
            )
            allData[`e_${deviceId}_${startIdx + i}`] = [event]
          }

          const finalIncrement = startIdx + batchSize
          const shards = Array.from({ length: finalIncrement }, (_, i) => i)

          allData[`m_${deviceId}`] = {
            version: 1,
            last_increment: finalIncrement,
            shards: shards
          }

          // Update baseline and seen vector every batch
          const todosInBaseline = {}
          for (let i = 1; i <= finalIncrement; i++) {
            todosInBaseline[`todo-${i}`] = { title: `T${i}`, completed: false }
          }
          allData[`b_${deviceId}`] = {
            includes: { [deviceId]: finalIncrement },
            state: { todos: todosInBaseline }
          }
          allData[`s_${deviceId}`] = {
            increments: {},
            lastActive: baseTime  // Old timestamp
          }

          await storage.sync.set(allData)
          successfulEvents = finalIncrement
          console.log(`[Scenario] Batch ${batch + 1}: ${successfulEvents} events created`)
        }
      } catch (err) {
        if (err.message?.includes('Quota')) {
          console.log(`[Scenario] Quota reached at ${successfulEvents} events. All are in baseline and ready for GC!`)
        } else {
          throw err
        }
      }

      console.log(`[Scenario] Almost Full Storage - ${successfulEvents} events created (all in baseline, ready for GC)`)
      return {
        deviceId: generateDeviceId('observer'),
        localState: {
          _scenarioMeta: { expectedTodos: successfulEvents }
        }
      }
    },
    async validate(state) {
      const expectedTodos = state._scenarioMeta?.expectedTodos || 0
      const todoCount = Object.keys(state.todos || {}).filter(k => k.startsWith('todo-')).length

      if (todoCount !== expectedTodos) {
        throw new Error(`Expected ${expectedTodos} todos (created before quota), found ${todoCount}`)
      }

      console.log(`[Validate] Storage test: ${todoCount} todos loaded successfully, GC should free storage`)
      return true
    }
  }
}

export async function loadScenario(scenarioId) {
  const scenario = scenarios[scenarioId]
  if (!scenario) {
    console.error(`[Scenarios] Unknown scenario: ${scenarioId}`)
    return null
  }

  console.log(`[Scenarios] Loading: ${scenario.name}`)
  const result = await scenario.setup()
  console.log(`[Scenarios] Scenario loaded successfully`)

  if (typeof result === 'string') {
    return { deviceId: result, localState: null }
  }
  return result
}

export function getScenario(scenarioId) {
  return scenarios[scenarioId] || null
}

export function getScenarioList() {
  return Object.entries(scenarios).map(([id, scenario]) => ({
    id,
    name: scenario.name,
    description: scenario.description
  }))
}
