import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isMobileDevice,
  ScreenWakeLockController,
} from '../src/screenWakeLock.ts'

function createSentinel() {
  const listeners = new Set()
  return {
    released: false,
    releaseCalls: 0,
    addEventListener(type, listener) {
      assert.equal(type, 'release')
      listeners.add(listener)
    },
    async release() {
      this.releaseCalls += 1
      this.released = true
      for (const listener of listeners) {
        listener(new Event('release'))
      }
    },
  }
}

describe('ScreenWakeLockController', () => {
  it('reports unsupported without interfering with callers', async () => {
    const states = []
    const controller = new ScreenWakeLockController({}, (state) => states.push(state))

    assert.equal(controller.supported, false)
    await controller.request()
    assert.deepEqual(states, ['unsupported'])
  })

  describe('isMobileDevice', () => {
    it('uses the browser mobile hint when available', () => {
      assert.equal(isMobileDevice({ userAgentData: { mobile: true } }), true)
      assert.equal(
        isMobileDevice(
          { userAgentData: { mobile: false } },
          () => ({ matches: true }),
        ),
        false,
      )
    })

    it('falls back to the coarse-pointer and no-hover media query', () => {
      let query
      const mobile = isMobileDevice({}, (value) => {
        query = value
        return { matches: true }
      })

      assert.equal(mobile, true)
      assert.equal(query, '(pointer: coarse) and (hover: none)')
    })

    it('does not classify a device as mobile without either signal', () => {
      assert.equal(isMobileDevice({}), false)
      assert.equal(isMobileDevice({}, () => ({ matches: false })), false)
    })
  })

  it('requests a screen lock once and releases it on demand', async () => {
    const states = []
    const sentinel = createSentinel()
    const wakeLock = {
      requestCalls: 0,
      async request(type) {
        assert.equal(type, 'screen')
        this.requestCalls += 1
        return sentinel
      },
    }
    const controller = new ScreenWakeLockController({ wakeLock }, (state) => states.push(state))

    await Promise.all([controller.request(), controller.request()])
    assert.equal(wakeLock.requestCalls, 1)
    assert.equal(states.at(-1), 'active')

    await controller.release()
    assert.equal(sentinel.releaseCalls, 1)
    assert.equal(states.at(-1), 'idle')
  })

  it('reports a lock released by the browser', async () => {
    const states = []
    const sentinel = createSentinel()
    const controller = new ScreenWakeLockController(
      { wakeLock: { request: async () => sentinel } },
      (state) => states.push(state),
    )

    await controller.request()
    await sentinel.release()

    assert.equal(states.at(-1), 'released')
  })

  it('reports acquisition failures without rejecting', async () => {
    const states = []
    const controller = new ScreenWakeLockController(
      { wakeLock: { request: async () => { throw new Error('denied') } } },
      (state) => states.push(state),
    )

    await assert.doesNotReject(controller.request())
    assert.equal(states.at(-1), 'failed')
  })

  it('releases a lock acquired after the request was cancelled', async () => {
    const states = []
    let resolveRequest
    const sentinel = createSentinel()
    const controller = new ScreenWakeLockController(
      { wakeLock: { request: () => new Promise((resolve) => { resolveRequest = resolve }) } },
      (state) => states.push(state),
    )

    const request = controller.request()
    await controller.release()
    resolveRequest(sentinel)
    await request

    assert.equal(sentinel.releaseCalls, 1)
    assert.equal(states.at(-1), 'idle')
  })
})
