import { useState, useEffect, useRef } from 'react'
import { supabasePatch, supabaseDelete } from '../lib/supabase'
import { parseDescription, serializeDescription, newSubtaskId } from '../lib/description'

export default function TaskDetailDrawer({ task, projects, team, onClose, onUpdated, onDeleted }) {
  const [title, setTitle]         = useState('')
  const [text, setText]           = useState('')
  const [subtasks, setSubtasks]   = useState([])
  const [status, setStatus]       = useState('pending')
  const [assignee, setAssignee]   = useState('')
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
    setAssignee(task.assignee_id ?? '')
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
    return updated
  }

  function saveTitle() {
    const trimmed = title.trim()
    if (!trimmed || trimmed === task.title) return
    patch({ title: trimmed })
  }

  function saveDescription(nextText, nextSubtasks) {
    const next = serializeDescription(nextText, nextSubtasks)
    if (next === task.description) return
    patch({ description: next })
  }

  function changeStatus(s) {
    setStatus(s)
    patch({ status: s })
  }
  function changeAssignee(id) {
    setAssignee(id)
    patch({ assignee_id: id || null })
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

  function closeTask() {
    changeStatus('done')
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
            onBlur={saveTitle}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); titleRef.current?.blur() } }}
            placeholder="Название задачи"
            className="w-full bg-transparent text-lg font-semibold text-text placeholder:text-muted outline-none border-0 px-0 py-0"
          />

          {/* Meta grid */}
          <div className="grid grid-cols-[100px_1fr] gap-y-3 gap-x-3 text-sm items-center">
            <label className="text-xs text-muted">Статус</label>
            <select className="input" value={status} onChange={e => changeStatus(e.target.value)}>
              <option value="pending">Входящие</option>
              <option value="in_progress">В работе</option>
              <option value="review">На проверке</option>
              <option value="done">Готово</option>
            </select>

            <label className="text-xs text-muted">Исполнитель</label>
            <select className="input" value={assignee} onChange={e => changeAssignee(e.target.value)}>
              <option value="">— не назначен —</option>
              {team.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
            </select>

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
              onBlur={() => saveDescription(text, subtasks)}
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

        {/* Footer actions */}
        <footer className="border-t border-border px-4 sm:px-5 py-3 flex items-center gap-2 shrink-0">
          {status !== 'done' ? (
            <button
              onClick={closeTask}
              className="btn-primary text-sm flex items-center gap-1.5"
              disabled={saving}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              Закрыть задачу
            </button>
          ) : (
            <button
              onClick={() => changeStatus('pending')}
              className="btn-secondary text-sm"
              disabled={saving}
            >
              Снова открыть
            </button>
          )}

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
