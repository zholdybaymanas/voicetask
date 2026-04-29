import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useVoiceInput } from '../contexts/VoiceInputContext'

const isTouchDevice = typeof window !== 'undefined'
  && ('ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0)

function getGreeting(name) {
  const h = new Date().getHours()
  const word = h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер'
  return name ? `${word}, ${name}` : word
}

export default function HomePage() {
  const { profile, user } = useAuth()
  const {
    state, transcript, errorMsg,
    isListening, isProcessing,
    startListening, stopListening,
  } = useVoiceInput()

  const displayName = profile?.full_name || user?.email?.split('@')[0] || ''

  const touchHandlers = isTouchDevice ? {
    onTouchStart: (e) => {
      e.preventDefault()
      if (!isProcessing && !isListening) startListening()
    },
    onTouchEnd: (e) => {
      e.preventDefault()
      if (isListening) stopListening()
    },
    onTouchCancel: () => { if (isListening) stopListening() },
  } : {}

  const clickHandler = isTouchDevice ? () => {} : () => {
    if (isProcessing) return
    if (isListening) stopListening()
    else startListening()
  }

  const hint = isProcessing
    ? 'Обрабатываю...'
    : isListening
      ? (isTouchDevice ? 'Отпустите, чтобы закончить' : 'Нажмите ещё раз, чтобы остановить')
      : (isTouchDevice ? 'Удерживайте, чтобы записать' : 'Нажмите, чтобы записать')

  return (
    <div className="flex flex-col items-center justify-center text-center px-4 h-full overflow-hidden">
      <h1 className="text-2xl sm:text-3xl font-semibold text-text mb-2">
        {getGreeting(displayName)}
      </h1>
      <p className="text-sm text-muted mb-10 sm:mb-14">
        Создайте задачу голосом
      </p>

      <button
        {...touchHandlers}
        onClick={clickHandler}
        disabled={isProcessing}
        aria-label="Голосовая задача"
        className={`
          relative w-32 h-32 sm:w-40 sm:h-40 rounded-full
          flex items-center justify-center
          transition-colors duration-200 select-none
          disabled:cursor-not-allowed
          ${isListening
            ? 'mic-active-pulse bg-red-500 shadow-2xl'
            : isProcessing
              ? 'fab-accent'
              : 'mic-idle-pulse fab-accent'}
        `}
      >
        {isListening && (
          <span className="absolute inset-0 rounded-full bg-red-400 animate-ping opacity-40" />
        )}
        {isProcessing ? (
          <div className="w-12 h-12 border-4 border-white border-t-transparent rounded-full animate-spin" />
        ) : (
          <svg className="w-16 h-16 sm:w-20 sm:h-20 text-white relative" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
          </svg>
        )}
      </button>

      <p className="text-xs sm:text-sm text-muted mt-6 min-h-[1.25rem]">{hint}</p>

      {/* Transcript stream */}
      <div className="mt-6 sm:mt-8 max-w-md w-full min-h-[3rem]">
        {transcript ? (
          <p className="text-xs sm:text-sm text-muted leading-relaxed break-words">
            {transcript}
          </p>
        ) : null}
      </div>

      {/* Inline error (in addition to global modal from VoiceInput) */}
      {state === 'error' && errorMsg && (
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

  if (typeof window === 'undefined' || dismissed) return null

  const ua = navigator.userAgent || ''
  const isIOS = /iPad|iPhone|iPod/.test(ua)
  const isSafari = /Safari/.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS/.test(ua)
  const isStandalone =
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches)
    || window.navigator.standalone === true

  if (!isIOS || !isSafari || isStandalone) return null

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
