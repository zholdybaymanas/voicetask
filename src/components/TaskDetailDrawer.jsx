import { useState, useEffect, useRef } from 'react'
import { supabaseRest, supabasePatch, supabaseDelete } from '../lib/supabase'
import { syncTaskToGoogleCalendar } from '../lib/googleCalendar'
import { parseDescription, serializeDescription, newSubtaskId } from '../lib/description'
import { useToast } from '../contexts/ToastContext'

const TEXT_DEBOUNCE_MS = 1000

export default function TaskDetailDrawer({ task, projects, team, onClose, onUpdated, onDeleted }) {
  const { show: showToast } = useToast()
  const [title, setTitle]         = useState('')
  const [text, setText]           = useState('')
  const [subtasks, setSubtasks]   = useState([])
  const [status, setStatus]       = useState('pending')
  // Multi-assignee. The first id (when set) maps onto tasks.assignee_id —
  // a DB trigger keeps that legacy column synced with the membership in
  // task_assignees, so the UI only needs to manipulate the list here.
  const [assigneeIds, setAssigneeIds] = useState([])
  const [pickerOpen, setPickerOpen]   = useState(false)
  const pickerRef = useRef(null)
  const [project, setProject]     = useState('')
  const [dueDate, setDueDate]     = useState('')
  const [priority, setPriority]   = useState('medium')
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [newSubtaskText, setNewSubtaskText] = useState('')
  const titleRef = useRef(null)

  // Load fields whenever the selected task changes
  useEffect(() => {
    if (!task) return
    const parsed = parseDescription(task.description)
    setTitle(task.title ?? '')
    setText(parsed.text)
    setSubtasks(parsed.subtasks)
    setStatus(task.status === 'todo' ? 'pending' : (task.status ?? 'pending'))
    // Seed assignees from the legacy column instantly, then fetch the
    // full list from task_assignees so secondary assignees show up too.
    setAssigneeIds(task.assignee_id ? [task.assignee_id] : [])
    setPickerOpen(false)
    supabaseRest('task_assignees', { select: 'user_id', filters: [`task_id=eq.${task.id}`] })
      .then(({ data, error }) => {
        if (error) {
          console.warn('[TaskDetail] task_assignees load:', error)
          return
        }
        setAssigneeIds((data ?? []).map(r => r.user_id))
      })
    setProject(task.project_id ?? '')
    setDueDate(task.due_date ?? '')
    setPriority(task.priority ?? 'medium')
    setError('')
    setConfirmDelete(false)
    setNewSubtaskText('')
  }, [task?.id])

  // ESC closes
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Close the assignee picker when the user clicks elsewhere.
  useEffect(() => {
    if (!pickerOpen) return
    function onDoc(e) {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setPickerOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [pickerOpen])

  if (!task) return null

  async function patch(body) {
    setSaving(true)
    setError('')
    const result = await supabasePatch('tasks', task.id, body)
    setSaving(false)
    if (result.error) {
      console.error('[TaskDetail] patch error:', result.error, '| body:', body)
      setError(result.error.message ?? 'Не удалось сохранить')
      return null
    }
    const updated = Array.isArray(result.data) ? result.data[0] : result.data
    if (updated) onUpdated?.(updated)

    // Re-sync to Google Calendar when fields visible there changed.
    const syncFields = ['title', 'status', 'due_date']
    if (syncFields.some(f => f in body)) syncTaskToGoogleCalendar(task.id)

    showToast('Сохранено', 'success', 1000)
    return updated
  }

  function saveDescription(nextText, nextSubtasks) {
    const next = serializeDescription(nextText, nextSubtasks)
    if (next === task.description) return
    patch({ description: next })
  }

  // Debounced autosave for the title field — fires 1s after the user
  // stops typing. Skips when value matches what's already on the task
  // (e.g. just-loaded form, or empty).
  useEffect(() => {
    if (!task) return
    const trimmed = title.trim()
    if (!trimmed || trimmed === task.title) return
    const t = setTimeout(() => patch({ title: trimmed }), TEXT_DEBOUNCE_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, task?.id])

  // Debounced autosave for the description text body. Subtasks save
  // immediately via saveDescription() when toggled / added / removed.
  useEffect(() => {
    if (!task) return
    const next = serializeDescription(text, subtasks)
    if (next === task.description) return
    const t = setTimeout(() => patch({ description: next }), TEXT_DEBOUNCE_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, task?.id])

  function changeStatus(s) {
    setStatus(s)
    patch({ status: s })
  }

  // Add or remove an assignee. Optimistically update local state first,
  // then write the change to task_assignees. The DB trigger keeps
  // tasks.assignee_id synced (set to the first row when present, or to
  // null when the list empties), so we don't touch that column here.
  async function toggleAssignee(userId) {
    const isAssigned = assigneeIds.includes(userId)
    const next = isAssigned
      ? assigneeIds.filter(id => id !== userId)
      : [...assigneeIds, userId]
    setAssigneeIds(next)
    setError('')

    let result
    if (isAssigned) {
      result = await supabaseRest('task_assignees', {
        method:  'DELETE',
        filters: [`task_id=eq.${task.id}`, `user_id=eq.${userId}`],
      })
    } else {
      result = await supabaseRest('task_assignees', {
        method: 'POST',
        body:   { task_id: task.id, user_id: userId },
      })
    }

    if (result?.error) {
      console.error('[TaskDetail] toggleAssignee:', result.error)
      setAssigneeIds(assigneeIds) // revert
      setError(result.error.message ?? 'Не удалось сохранить')
      return
    }

    showToast('Сохранено', 'success', 1000)
    // Surface a fresh task to the parent so its list reflects the new
    // primary assignee_id (the trigger updated it server-side).
    const refreshed = await supabaseRest('tasks', { filters: [`id=eq.${task.id}`] })
    const updated = refreshed.data?.[0]
    if (updated) onUpdated?.(updated)
  }

  function changeProject(id) {
    setProject(id)
    patch({ project_id: id || null })
  }
  function changeDueDate(d) {
    setDueDate(d)
    patch({ due_date: d || null })
  }
  function changePriority(p) {
    setPriority(p)
    patch({ priority: p })
  }

  async function handleDelete() {
    setSaving(true)
    const { error } = await supabaseDelete('tasks', task.id)
    setSaving(false)
    if (error) {
      console.error('[TaskDetail] delete error:', error)
      setError(error.message ?? 'Не удалось удалить')
      return
    }
    onDeleted?.(task.id)
    onClose()
  }

  // ── Subtasks ──
  function addSubtask() {
    const t = newSubtaskText.trim()
    if (!t) return
    const next = [...subtasks, { id: newSubtaskId(), text: t, done: false }]
    setSubtasks(next)
    setNewSubtaskText('')
    saveDescription(text, next)
  }
  function toggleSubtask(id) {
    const next = subtasks.map(s => s.id === id ? { ...s, done: !s.done } : s)
    setSubtasks(next)
    saveDescription(text, next)
  }
  function removeSubtask(id) {
    const next = subtasks.filter(s => s.id !== id)
    setSubtasks(next)
    saveDescription(text, next)
  }
  function editSubtask(id, value) {
    setSubtasks(prev => prev.map(s => s.id === id ? { ...s, text: value } : s))
  }
  function commitSubtaskEdit() {
    saveDescription(text, subtasks)
  }

  const total = subtasks.length
  const done  = subtasks.filter(s => s.done).length
  const progress = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer */}
      <aside
        className="
          relative ml-auto h-full w-full sm:max-w-md md:max-w-lg
          bg-card border-l border-border shadow-2xl
          flex flex-col drawer-enter
        "
      >
        {/* Header */}
        <header className="flex items-center gap-2 px-4 sm:px-5 h-14 border-b border-border shrink-0">
          <span className="text-xs text-muted">Задача</span>
          {task.gcal_event_id && (
            <span title="Синхронизировано с Google Calendar" className="text-primary">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
              </svg>
            </span>
          )}
          <div className="flex-1" />
          {saving && (
            <span className="text-[11px] text-muted flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 border-2 border-muted border-t-transparent rounded-full animate-spin" />
              Сохранение
            </span>
          )}
          <button
            onClick={onClose}
            className="text-muted hover:text-text p-1.5 rounded-lg hover:bg-hover"
            aria-label="Закрыть"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-5 space-y-5">
          {/* Title */}
          <input
            ref={titleRef}
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); titleRef.current?.blur() } }}
            placeholder="Название задачи"
            className="w-full bg-transparent text-lg font-semibold text-text placeholder:text-muted outline-none border-0 px-0 py-0"
          />

          {/* Meta grid */}
          <div className="grid grid-cols-[100px_1fr] gap-y-3 gap-x-3 text-sm items-center">
            <label className="text-xs text-muted">Статус</label>
            <select className="input" value={status} onChange={e => changeStatus(e.target.value)}>
              <option value="pending">Новая</option>
              <option value="in_progress">В работе</option>
              <option value="review">На проверке</option>
              <option value="done">Выполнена</option>
            </select>

            <label className="text-xs text-muted self-start mt-2">Исполнители</label>
            <div ref={pickerRef} className="relative">
              <button
                type="button"
                onClick={() => setPickerOpen(v => !v)}
                className="input flex flex-wrap gap-1 items-center text-left min-h-[2.5rem] cursor-pointer"
                aria-haspopup="listbox"
                aria-expanded={pickerOpen}
              >
                {assigneeIds.length === 0 ? (
                  <span className="text-muted">— не назначены —</span>
                ) : (
                  assigneeIds.map(id => {
                    const m = team.find(u => u.id === id)
                    const name = m?.full_name || m?.email || '?'
                    return (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 bg-primary/10 text-primary text-xs font-medium px-2 py-0.5 rounded-full"
                      >
                        {name}
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={e => { e.stopPropagation(); toggleAssignee(id) }}
                          onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault(); e.stopPropagation(); toggleAssignee(id)
                            }
                          }}
                          aria-label={`Удалить ${name}`}
                          className="hover:text-text leading-none cursor-pointer"
                        >
                          ×
                        </span>
                      </span>
                    )
                  })
                )}
                <svg className="w-3.5 h-3.5 text-muted ml-auto shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </button>
              {pickerOpen && (
                <div
                  role="listbox"
                  className="absolute left-0 right-0 mt-1 z-20 max-h-60 overflow-y-auto bg-card border border-border rounded-lg shadow-card-hover py-1"
                >
                  {team.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-muted">Нет участников</p>
                  ) : (
                    team.map(u => {
                      const checked = assigneeIds.includes(u.id)
                      return (
                        <label
                          key={u.id}
                          className="flex items-center gap-2 px-3 py-1.5 hover:bg-hover cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleAssignee(u.id)}
                            className="accent-primary"
                          />
                          <span className="text-sm text-text truncate">{u.full_name || u.email}</span>
                        </label>
                      )
                    })
                  )}
                </div>
              )}
            </div>

            <label className="text-xs text-muted">Проект</label>
            <select className="input" value={project} onChange={e => changeProject(e.target.value)}>
              <option value="">— не выбран —</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>

            <label className="text-xs text-muted">Дедлайн</label>
            <input type="date" className="input" value={dueDate} onChange={e => changeDueDate(e.target.value)} />

            <label className="text-xs text-muted">Приоритет</label>
            <select className="input" value={priority} onChange={e => changePriority(e.target.value)}>
              <option value="low">Низкий</option>
              <option value="medium">Средний</option>
              <option value="high">Высокий</option>
            </select>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">Описание</label>
            <textarea
              className="input resize-y min-h-[80px]"
              rows={3}
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Добавить описание…"
            />
          </div>

          {/* Subtasks */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-muted">
                Подзадачи {total > 0 && <span className="text-text">{done}/{total}</span>}
              </label>
              {total > 0 && <span className="text-xs text-muted">{progress}%</span>}
            </div>

            {total > 0 && (
              <div className="h-1.5 bg-hover rounded-full overflow-hidden mb-3">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}

            <ul className="space-y-1.5">
              {subtasks.map(s => (
                <li key={s.id} className="flex items-center gap-2.5 group">
                  <button
                    onClick={() => toggleSubtask(s.id)}
                    className={`task-check ${s.done ? 'is-done' : ''}`}
                    aria-label={s.done ? 'Отметить невыполненной' : 'Отметить выполненной'}
                  >
                    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  </button>
                  <input
                    value={s.text}
                    onChange={e => editSubtask(s.id, e.target.value)}
                    onBlur={commitSubtaskEdit}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur() } }}
                    className={`flex-1 bg-transparent text-sm outline-none border-0 px-0 py-1 ${s.done ? 'text-muted line-through' : 'text-text'}`}
                  />
                  <button
                    onClick={() => removeSubtask(s.id)}
                    className="opacity-0 group-hover:opacity-100 text-muted hover:text-red-500 p-1 rounded transition-opacity"
                    aria-label="Удалить подзадачу"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>

            <div className="mt-2 flex items-center gap-2.5">
              <span className="task-check pointer-events-none opacity-50" aria-hidden="true">
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </span>
              <input
                value={newSubtaskText}
                onChange={e => setNewSubtaskText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSubtask() } }}
                placeholder="+ Добавить подзадачу"
                className="flex-1 bg-transparent text-sm outline-none border-0 px-0 py-1 text-text placeholder:text-muted"
              />
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 break-words">
              {error}
            </p>
          )}
        </div>

        {/* Footer — autosave handles persistence; the only actions left
            are explicitly close-without-saving and delete. */}
        <footer className="border-t border-border px-4 sm:px-5 py-3 flex items-center gap-2 shrink-0">
          <button
            onClick={onClose}
            className="btn-secondary text-sm flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            Закрыть
          </button>

          <div className="flex-1" />

          {confirmDelete ? (
            <>
              <span className="text-xs text-muted hidden sm:inline">Уверены?</span>
              <button
                onClick={() => setConfirmDelete(false)}
                className="btn-secondary text-sm"
                disabled={saving}
              >
                Отмена
              </button>
              <button
                onClick={handleDelete}
                className="text-sm font-medium px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 active:scale-95 transition-all disabled:opacity-50"
                disabled={saving}
              >
                Удалить
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-sm font-medium px-3 py-2 rounded-lg text-red-500 hover:bg-red-500/10 transition-colors"
            >
              Удалить
            </button>
          )}
        </footer>
      </aside>
    </div>
  )
}
