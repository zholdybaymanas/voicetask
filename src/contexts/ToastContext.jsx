import { createContext, useContext, useEffect, useRef, useState } from 'react'

// Global toast for surfacing non-blocking errors / info from anywhere in
// the app, including non-React utilities (lib/*) via a window event.
//
// Usage in components:
//   const { show } = useToast()
//   show('Не удалось синхронизировать с календарём', 'error')
//
// Usage in plain JS (lib helpers):
//   import { emitToast } from '../contexts/ToastContext'
//   emitToast('Не удалось обновить', 'error')

const ToastContext = createContext({ show: () => {} })

export function emitToast(message, kind = 'info') {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('app:toast', { detail: { message, kind } }))
}

export function useToast() {
  return useContext(ToastContext)
}

const KIND_STYLES = {
  info:    'bg-card border-border text-text',
  success: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500',
  error:   'bg-red-500/10 border-red-500/30 text-red-400',
  warn:    'bg-amber-500/10 border-amber-500/30 text-amber-500',
}

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null)
  const timerRef = useRef(null)

  function show(message, kind = 'info') {
    if (!message) return
    clearTimeout(timerRef.current)
    setToast({ message, kind, id: Date.now() })
    timerRef.current = setTimeout(() => setToast(null), 4500)
  }

  // Listen for non-React callers
  useEffect(() => {
    function onEvent(e) {
      const { message, kind } = e.detail ?? {}
      show(message, kind)
    }
    window.addEventListener('app:toast', onEvent)
    return () => window.removeEventListener('app:toast', onEvent)
  }, [])

  function dismiss() {
    clearTimeout(timerRef.current)
    setToast(null)
  }

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast && (
        <div
          key={toast.id}
          className="fixed top-20 right-4 sm:right-7 z-50 max-w-sm pointer-events-auto"
        >
          <div className={`
            flex items-start gap-3 px-4 py-3 rounded-xl border shadow-card-hover
            ${KIND_STYLES[toast.kind] ?? KIND_STYLES.info}
          `}>
            <p className="text-sm leading-snug break-words flex-1">{toast.message}</p>
            <button
              onClick={dismiss}
              aria-label="Закрыть"
              className="opacity-60 hover:opacity-100 shrink-0 -mr-1"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  )
}
