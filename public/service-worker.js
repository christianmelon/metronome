const scopeUrl = self.registration.scope
const scopeId = new URL(scopeUrl).pathname.replace(/[^a-zA-Z0-9_-]/g, '_')
const cachePrefix = `metronome-static-${scopeId}-`
const buildId = new URL(self.location.href).searchParams.get('build') ?? 'development'
const cacheName = `${cachePrefix}${buildId}`

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const manifestUrl = new URL('precache-manifest.json', scopeUrl)
      const response = await fetch(manifestUrl)
      if (!response.ok) {
        throw new Error(`Could not load precache manifest: ${response.status}`)
      }

      const resources = await response.json()
      if (!Array.isArray(resources) || resources.some((resource) => typeof resource !== 'string')) {
        throw new Error('Precache manifest must be an array of resource paths.')
      }

      const urls = new Set([
        new URL('./', scopeUrl).href,
        ...resources.map((resource) => new URL(resource, scopeUrl).href),
      ])
      const cache = await caches.open(cacheName)
      await cache.addAll([...urls])
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys()
      await Promise.all(
        cacheNames
          .filter((name) => name.startsWith(cachePrefix) && name !== cacheName)
          .map((name) => caches.delete(name)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const requestUrl = new URL(request.url)
  if (
    request.method !== 'GET' ||
    requestUrl.origin !== self.location.origin ||
    !requestUrl.href.startsWith(scopeUrl)
  ) {
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request)
          if (response.ok) {
            const cache = await caches.open(cacheName)
            await cache.put(new URL('./', scopeUrl).href, response.clone())
          }
          return response
        } catch {
          const cache = await caches.open(cacheName)
          const fallback =
            (await cache.match(request)) ?? (await cache.match(scopeUrl))
          return (
            fallback ??
            new Response('Application indisponible hors ligne.', {
              status: 503,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            })
          )
        }
      })(),
    )
    return
  }

  event.respondWith(
    (async () => {
      const cachedResponse = await caches.match(request)
      if (cachedResponse) {
        return cachedResponse
      }

      const response = await fetch(request)
      if (response.ok) {
        const cache = await caches.open(cacheName)
        await cache.put(request, response.clone())
      }
      return response
    })(),
  )
})
