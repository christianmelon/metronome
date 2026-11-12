export type ScreenWakeLockState =
  | 'idle'
  | 'requesting'
  | 'active'
  | 'released'
  | 'unsupported'
  | 'failed'

type WakeLockSentinelLike = {
  readonly released?: boolean
  addEventListener(type: 'release', listener: EventListener): void
  release(): Promise<void>
}

type WakeLockApiLike = {
  request(type: 'screen'): Promise<WakeLockSentinelLike>
}

function isWakeLockApi(value: unknown): value is WakeLockApiLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'request' in value &&
    typeof value.request === 'function'
  )
}

function getWakeLockApi(navigatorLike: unknown): WakeLockApiLike | null {
  if (
    typeof navigatorLike !== 'object' ||
    navigatorLike === null ||
    !('wakeLock' in navigatorLike)
  ) {
    return null
  }

  const wakeLock = navigatorLike.wakeLock
  return isWakeLockApi(wakeLock) ? wakeLock : null
}

export class ScreenWakeLockController {
  private readonly wakeLockApi: WakeLockApiLike | null
  private readonly onStateChange: (state: ScreenWakeLockState) => void
  private sentinel: WakeLockSentinelLike | null = null
  private pendingRequest: Promise<void> | null = null
  private requestId = 0

  constructor(
    navigatorLike: unknown,
    onStateChange: (state: ScreenWakeLockState) => void,
  ) {
    this.wakeLockApi = getWakeLockApi(navigatorLike)
    this.onStateChange = onStateChange
  }

  get supported(): boolean {
    return this.wakeLockApi !== null
  }

  request(): Promise<void> {
    if (!this.wakeLockApi) {
      this.onStateChange('unsupported')
      return Promise.resolve()
    }

    if (this.sentinel && !this.sentinel.released) {
      this.onStateChange('active')
      return Promise.resolve()
    }
    this.sentinel = null

    if (this.pendingRequest) {
      return this.pendingRequest
    }

    const requestId = ++this.requestId
    this.onStateChange('requesting')
    const request = this.acquire(requestId)
    this.pendingRequest = request

    return request.finally(() => {
      if (this.pendingRequest === request) {
        this.pendingRequest = null
      }
    })
  }

  async release(): Promise<void> {
    this.requestId += 1
    this.pendingRequest = null
    const sentinel = this.sentinel
    this.sentinel = null
    this.onStateChange(this.supported ? 'idle' : 'unsupported')

    if (!sentinel) {
      return
    }

    try {
      await sentinel.release()
    } catch (error: unknown) {
      this.onStateChange('failed')
      console.info('Screen Wake Lock could not be released.', error)
    }
  }

  private async acquire(requestId: number): Promise<void> {
    const wakeLockApi = this.wakeLockApi
    if (!wakeLockApi) {
      this.onStateChange('unsupported')
      return
    }

    try {
      const sentinel = await wakeLockApi.request('screen')
      if (requestId !== this.requestId) {
        try {
          await sentinel.release()
        } catch (error: unknown) {
          console.info('A stale Screen Wake Lock could not be released.', error)
        }
        return
      }

      this.sentinel = sentinel
      sentinel.addEventListener('release', () => {
        if (this.sentinel !== sentinel) {
          return
        }
        this.sentinel = null
        this.onStateChange('released')
      })

      this.onStateChange(sentinel.released ? 'released' : 'active')
      if (sentinel.released) {
        this.sentinel = null
      }
    } catch (error: unknown) {
      if (requestId === this.requestId) {
        this.onStateChange('failed')
        console.info(
          'Screen Wake Lock could not be acquired; continuing without it.',
          error,
        )
      }
    }
  }
}
