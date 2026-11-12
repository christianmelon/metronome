type AudioSessionLike = {
  type: unknown
}

function isAudioSession(value: unknown): value is AudioSessionLike {
  return typeof value === 'object' && value !== null && 'type' in value
}

export function requestAutomaticAudioSession(navigatorLike: unknown): boolean {
  if (typeof navigatorLike !== 'object' || navigatorLike === null) {
    return false
  }

  try {
    const audioSession =
      'audioSession' in navigatorLike ? navigatorLike.audioSession : undefined
    if (!isAudioSession(audioSession)) {
      return false
    }

    audioSession.type = 'auto'
    return true
  } catch (error: unknown) {
    console.info(
      'Audio Session API could not be configured; using the browser default.',
      error,
    )
    return false
  }
}
