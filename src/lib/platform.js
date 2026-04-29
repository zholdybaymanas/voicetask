// Platform / browser detection. SSR-safe — all guards check `typeof` first
// so these constants don't crash during server rendering or build-time
// eval. UA-based checks are pragmatic, not bulletproof; good enough for
// branching UI hints (e.g. "open in Safari", install banners).

const ua = typeof navigator !== 'undefined' ? (navigator.userAgent || '') : ''

export const isIOS    = /iPad|iPhone|iPod/.test(ua)
export const isAndroid = /Android/i.test(ua)
export const isSafari = /Safari/.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS/.test(ua)
export const isIOSChrome  = isIOS && /CriOS/.test(ua)
export const isIOSFirefox = isIOS && /FxiOS/.test(ua)
export const isIOSEdge    = isIOS && /EdgiOS/.test(ua)

export const isStandalonePWA =
  typeof window !== 'undefined' && (
    (typeof window.matchMedia === 'function'
      && window.matchMedia('(display-mode: standalone)').matches)
    || window.navigator?.standalone === true
  )

export const isTouchDevice =
  typeof window !== 'undefined' && (
    'ontouchstart' in window
    || (navigator.maxTouchPoints ?? 0) > 0
  )
