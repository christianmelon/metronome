export async function registerOfflineSupport(): Promise<void> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('This browser does not support service workers.')
  }

  await navigator.serviceWorker.register(
    `${import.meta.env.BASE_URL}service-worker.js?build=${__APP_BUILD_ID__}`,
  )
  await navigator.serviceWorker.ready
}
