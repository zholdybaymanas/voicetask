import { useState, useRef } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useVoiceInput } from '../contexts/VoiceInputContext'
import { isIOS, isSafari, isStandalonePWA } from '../lib/platform'

function getGreeting(name) {
  const h = new Date().getHours()
  const word = h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер'
  return name ? `${word}, ${name}` : word
}

export default function HomePage() {
  const { profile, user } = useAuth()
  const {
    state, errorMsg,
    isListening, isProcessing,
    startListening, stopListening,
    voiceUnavailable, voiceUnavailableReason,
  } = useVoiceInput()

  const displayName = profile?.full_name || user?.email?.split('@')[0] || ''

  // Hold-to-record with a 300ms threshold so a fast tap/click doesn't
  // accidentally start a session. Recording only kicks in once the timer
  // fires and the pointer is still down.
  const HOLD_THRESHOLD = 300
  const isHolding       = useRef(false)
  const holdTimer       = useRef(null)
  const pointerDownTime = useRef(0)

  const handlePointerDown = (e) => {
    if (voiceUnavailable) return // mic is decorative — no recording possible
    e.preventDefault()
    pointerDownTime.current = Date.now()
    clearTimeout(holdTimer.current)
    holdTimer.current = setTimeout(() => {
      isHolding.current = true
      startListening()
    }, HOLD_THRESHOLD)
  }

  const handlePointerUp = (e) => {
    e.preventDefault?.()
    clearTimeout(holdTimer.current)
    const held = Date.now() - pointerDownTime.current
    if (held < HOLD_THRESHOLD) {
      // Treated as a click — the recording timer never fired, nothing to stop.
      isHolding.current = false
      return
    }
    if (isHolding.current) {
      isHolding.current = false
      stopListening()
    }
  }

  const hint = voiceUnavailable
    ? 'Голосовой ввод недоступен'
    : isProcessing
      ? 'Обрабатываю...'
      : isListening
        ? 'Отпустите, чтобы закончить'
        : 'Нажмите и удерживайте, чтобы записать'

  return (
    <div className="flex flex-col items-center justify-center text-center px-4 h-full min-h-[calc(100dvh-7rem)] sm:min-h-[calc(100dvh-3.5rem)] overflow-hidden">
      <h1 className="text-2xl sm:text-3xl font-semibold text-text mb-2">
        {getGreeting(displayName)}
      </h1>
      <p className="text-sm text-muted mb-10 sm:mb-14">
        Создайте задачу голосом
      </p>

      <button
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={(e) => e.preventDefault()}
        disabled={isProcessing || voiceUnavailable}
        aria-label={voiceUnavailable ? 'Голосовой ввод недоступен' : 'Голосовая задача (удерживайте для записи)'}
        style={{ touchAction: 'none', userSelect: 'none', WebkitTouchCallout: 'none' }}
        className={`
          relative w-32 h-32 sm:w-40 sm:h-40 rounded-full
          flex items-center justify-center
          transition-colors duration-200 select-none
          disabled:cursor-not-allowed
          ${voiceUnavailable
            ? 'bg-hover border border-border opacity-70'
            : isListening
              ? 'mic-active-pulse bg-red-500 shadow-2xl'
              : isProcessing
                ? 'fab-accent'
                : 'mic-idle-pulse fab-accent'}
        `}
      >
        {isListening && (
          <span className="absolute inset-0 rounded-full bg-red-400 animate-ping opacity-40" />
        )}
        {voiceUnavailable ? (
          <svg className="w-14 h-14 sm:w-16 sm:h-16 text-muted relative" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        ) : isProcessing ? (
          <div className="w-12 h-12 border-4 border-white border-t-transparent rounded-full animate-spin" />
        ) : (
          <svg className="w-16 h-16 sm:w-20 sm:h-20 text-white relative" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
          </svg>
        )}
      </button>

      <p className="text-xs sm:text-sm text-muted mt-6 min-h-[1.25rem]">{hint}</p>

      {voiceUnavailable && (
        <p className="mt-3 text-xs sm:text-sm text-muted max-w-sm leading-relaxed break-words">
          {voiceUnavailableReason}
        </p>
      )}

      {/* Inline error (in addition to global modal from VoiceInput) */}
      {state === 'error' && errorMsg && !voiceUnavailable && (
        <p className="mt-4 text-xs text-red-500 max-w-md break-words">{errorMsg}</p>
      )}

      <IOSInstallHint />
    </div>
  )
}

const IOS_HINT_KEY = 'voicetask:iosInstallDismissed'

function IOSInstallHint() {
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(IOS_HINT_KEY) === '1' } catch { return false }
  })

  if (dismissed) return null
  if (!isIOS || !isSafari || isStandalonePWA) return null

  function close() {
    try { localStorage.setItem(IOS_HINT_KEY, '1') } catch {}
    setDismissed(true)
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 z-40 max-w-md mx-auto pointer-events-auto">
      <div className="bg-card border border-border shadow-card-hover rounded-xl px-4 py-3 flex items-start gap-3 text-left">
        <p className="flex-1 text-xs sm:text-sm text-text leading-relaxed">
          Установите приложение: нажмите{' '}
          <span className="inline-flex items-center justify-center w-5 h-6 align-middle border border-current rounded text-primary text-sm leading-none">
            ↑
          </span>
          {' '}→ «На экран «Домой»»
        </p>
        <button
          onClick={close}
          className="text-muted hover:text-text shrink-0 p-0.5 -mr-1 rounded hover:bg-hover"
          aria-label="Закрыть"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}
