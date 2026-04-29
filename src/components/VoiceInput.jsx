// FAB voice button + global error/toast UI + clarification modal.
// All recording logic lives in VoiceInputContext — this is just the
// floating button that appears on every page EXCEPT the home page,
// where the big centered mic takes its place. The toast, error modal,
// and clarification modal render on every page.
import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useVoiceInput } from '../contexts/VoiceInputContext'

export default function VoiceInput() {
  const location = useLocation()
  const showFab  = location.pathname !== '/'
  const { state, errorMsg, toast, isListening, isProcessing,
          startListening, stopListening, reset } = useVoiceInput()

  const fabLabel = isListening ? 'Удерживайте для записи' : isProcessing ? 'Обработка...' : null

  // Hold-to-record on every pointer type — no click toggle.
  function fabPointerDown(e) {
    e.preventDefault()
    if (isProcessing || isListening) return
    startListening()
  }
  function fabRelease(e) {
    e.preventDefault?.()
    if (isListening) stopListening()
  }

  return (
    <>
      {/* Toast — either a rich task-created card or a one-line message. */}
      {toast && (
        <div
          key={toast.id}
          className="task-toast-show fixed bottom-20 sm:bottom-24 right-4 sm:right-7 z-50 max-w-xs sm:max-w-sm w-[calc(100vw-2rem)]"
        >
          {toast.kind === 'task-created' ? (
            <div className="bg-card border border-border rounded-xl shadow-card-hover px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                </svg>
                <span className="text-sm font-semibold text-text">{toast.headline}</span>
              </div>
              {toast.title && (
                <p className="text-sm text-text leading-snug break-words mb-1.5">{toast.title}</p>
              )}
              <div className="space-y-0.5 text-xs text-muted leading-relaxed">
                {toast.projectName && (
                  <div className="flex items-center gap-1.5">
                    <span aria-hidden>📁</span>
                    <span className="truncate"><span className="text-text">Проект:</span> {toast.projectName}</span>
                  </div>
                )}
                {toast.assigneeName && (
                  <div className="flex items-center gap-1.5">
                    <span aria-hidden>👤</span>
                    <span className="truncate"><span className="text-text">Исполнитель:</span> {toast.assigneeName}</span>
                  </div>
                )}
                {toast.deadlineText && (
                  <div className="flex items-center gap-1.5">
                    <span aria-hidden>📅</span>
                    <span className="truncate"><span className="text-text">Дедлайн:</span> {toast.deadlineText}</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-card border border-border text-text text-sm font-medium px-4 py-3 rounded-xl shadow-card-hover flex items-center gap-2">
              <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
              </svg>
              <span className="truncate">{toast.message}</span>
            </div>
          )}
        </div>
      )}

      {/* FAB — hidden on home where the big mic lives */}
      {showFab && (
        <div className="group fixed bottom-5 sm:bottom-7 right-4 sm:right-7 z-40 flex items-center gap-3">
          <span className="hidden sm:inline-block pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 bg-card border border-border text-text text-xs font-medium rounded-lg px-2.5 py-1.5 whitespace-nowrap shadow-card">
            {fabLabel ?? 'Голосовая задача'}
          </span>

          <button
            onPointerDown={fabPointerDown}
            onPointerUp={fabRelease}
            onPointerCancel={fabRelease}
            onPointerLeave={fabRelease}
            onContextMenu={(e) => e.preventDefault()}
            disabled={isProcessing}
            aria-label="Голосовая задача (удерживайте для записи)"
            style={{ touchAction: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
            className={`
              relative w-14 h-14 rounded-full flex items-center justify-center
              transition-colors duration-200 select-none
              disabled:opacity-60 disabled:cursor-not-allowed
              ${isListening
                ? 'mic-active-pulse bg-red-500 hover:bg-red-600 shadow-xl'
                : isProcessing
                  ? 'fab-accent'
                  : 'mic-idle-pulse fab-accent'}
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

      {/* Clarification modal — shown when parser confidence is low */}
      <ClarificationModal />

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

function ClarificationModal() {
  const { pendingTask, projects, team, confirmPendingTask, cancelPendingTask } = useVoiceInput()
  const [assigneeId, setAssigneeId] = useState('')
  const [projectId,  setProjectId]  = useState('')
  const [deadline,   setDeadline]   = useState('')
  const [saving,     setSaving]     = useState(false)

  // Reset form when a new pending task arrives
  useEffect(() => {
    if (pendingTask) {
      setAssigneeId(pendingTask.assigned_to ?? '')
      setProjectId(pendingTask.project_id ?? '')
      setDeadline(pendingTask.deadline ?? '')
      setSaving(false)
    }
  }, [pendingTask])

  if (!pendingTask) return null

  async function submit() {
    setSaving(true)
    await confirmPendingTask({
      assigned_to: assigneeId || null,
      project_id:  projectId  || null,
      deadline:    deadline   || null,
    })
    // setSaving(false) — modal will unmount when pendingTask becomes null
  }

  const confidencePercent = Math.round((pendingTask.confidence ?? 0) * 100)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !saving && cancelPendingTask()} />
      <div className="relative bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-md p-5 sm:p-6">
        <div className="flex items-start justify-between mb-4 gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-text">Уточните задачу</h2>
            <p className="text-xs text-muted mt-0.5">
              Уверенность распознавания: {confidencePercent}%
            </p>
          </div>
          <button
            onClick={() => !saving && cancelPendingTask()}
            className="text-muted hover:text-text p-1 rounded-lg hover:bg-hover shrink-0"
            aria-label="Отмена"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="bg-hover rounded-lg px-3 py-2.5 mb-4">
          <p className="text-xs text-muted mb-0.5">Название</p>
          <p className="text-sm text-text break-words">{pendingTask.title}</p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-text mb-1">Кому назначить?</label>
            <select
              className="input"
              value={assigneeId}
              onChange={e => setAssigneeId(e.target.value)}
              autoFocus
            >
              <option value="">Себе</option>
              {team.map(u => (
                <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-text mb-1">В какой проект?</label>
            <select
              className="input"
              value={projectId}
              onChange={e => setProjectId(e.target.value)}
            >
              <option value="">— без проекта —</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-text mb-1">Дедлайн</label>
            <input
              type="date"
              className="input"
              value={deadline}
              onChange={e => setDeadline(e.target.value)}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            className="btn-secondary"
            onClick={cancelPendingTask}
            disabled={saving}
          >
            Отмена
          </button>
          <button
            type="button"
            className="btn-primary flex items-center gap-2"
            onClick={submit}
            disabled={saving}
          >
            {saving && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            Создать задачу
          </button>
        </div>
      </div>
    </div>
  )
}
