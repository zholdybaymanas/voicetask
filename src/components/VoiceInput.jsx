// FAB voice button + global error/toast UI.
// All recording logic lives in VoiceInputContext — this is just the
// floating button that appears on every page EXCEPT the home page,
// where the big centered mic takes its place.
import { useLocation } from 'react-router-dom'
import { useVoiceInput } from '../contexts/VoiceInputContext'

const isTouchDevice = typeof window !== 'undefined'
  && ('ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0)

export default function VoiceInput() {
  const location = useLocation()
  const showFab  = location.pathname !== '/'
  const { state, errorMsg, toast, isListening, isProcessing,
          startListening, stopListening, reset } = useVoiceInput()

  const fabLabel = isListening ? 'Остановить' : isProcessing ? 'Обработка...' : null

  // Touch: hold to record. Mouse: click to toggle. Avoid double-fire by
  // using onTouchStart/End on touch devices and onClick on others.
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

  return (
    <>
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-20 sm:bottom-24 right-4 sm:right-7 z-50 animate-in">
          <div className="bg-card border border-border text-text text-sm font-medium px-4 py-3 rounded-xl shadow-card-hover flex items-center gap-2 max-w-xs">
            <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
            </svg>
            <span className="truncate">{toast.message}</span>
          </div>
        </div>
      )}

      {/* FAB — hidden on home where the big mic lives */}
      {showFab && (
        <div className="group fixed bottom-5 sm:bottom-7 right-4 sm:right-7 z-40 flex items-center gap-3">
          <span className="hidden sm:inline-block pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 bg-card border border-border text-text text-xs font-medium rounded-lg px-2.5 py-1.5 whitespace-nowrap shadow-card">
            {fabLabel ?? 'Голосовая задача'}
          </span>

          <button
            {...touchHandlers}
            onClick={clickHandler}
            disabled={isProcessing}
            aria-label="Голосовая задача"
            className={`
              relative w-14 h-14 rounded-full flex items-center justify-center
              transition-all duration-200 hover:scale-105 active:scale-95
              disabled:opacity-60 disabled:cursor-not-allowed
              ${isListening ? 'bg-red-500 hover:bg-red-600 shadow-xl' : 'fab-accent'}
            `}
          >
            {isListening && (
              <span className="absolute inset-0 rounded-full bg-red-400 animate-ping opacity-50" />
            )}
            {isProcessing ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-6 h-6 text-white relative" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
              </svg>
            )}
          </button>
        </div>
      )}

      {/* Error modal */}
      {state === 'error' && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={reset} />
          <div className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h2 className="text-base font-semibold text-text mb-3">Ошибка</h2>
            <div className="flex gap-3 items-start bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl p-3 mb-5">
              <svg className="w-4 h-4 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm-.75-11.25a.75.75 0 011.5 0v4.5a.75.75 0 01-1.5 0v-4.5zm.75 7.5a.75.75 0 100-1.5.75.75 0 000 1.5z" clipRule="evenodd" />
              </svg>
              <span>{errorMsg}</span>
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={reset}>Закрыть</button>
              <button className="btn-primary" onClick={() => { reset(); startListening() }}>
                Попробовать снова
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
