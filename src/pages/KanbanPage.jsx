import { useState, useEffect, useMemo } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor,
  useDraggable, useDroppable, useSensor, useSensors,
  closestCorners,
} from '@dnd-kit/core'
import { supabase, supabaseRest, supabasePatch, getCurrentUser } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { descriptionPreview } from '../lib/description'
import TaskDetailDrawer from '../components/TaskDetailDrawer'

const COLUMNS = [
  { id: 'pending',     label: 'Входящие',    accent: 'bg-slate-400' },
  { id: 'in_progress', label: 'В работе',    accent: 'bg-amber-400' },
  { id: 'review',      label: 'На проверке', accent: 'bg-violet-400' },
  { id: 'done',        label: 'Готово',      accent: 'bg-emerald-500' },
]

const PRIORITY_DOT = { high: 'bg-red-500', medium: 'bg-amber-400', low: 'bg-muted' }

// Map legacy statuses to new column ids so old rows still appear after migration.
function normalizeStatus(s) {
  if (s === 'todo') return 'pending'
  if (s === 'cancelled') return 'done'
  return s ?? 'pending'
}

export default function KanbanPage() {
  const { user, profile } = useAuth()
  const [tasks, setTasks]     = useState([])
  const [projects, setProjects] = useState([])
  const [team, setTeam]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [activeId, setActiveId] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [adding, setAdding]   = useState(null) // status string when input visible

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 150, tolerance: 5 } }),
  )

  useEffect(() => {
    if (!user?.id) return
    loadAll()
    const silentReload = () => loadAll({ silent: true })
    window.addEventListener('voiceTaskCreated', silentReload)
    const ch = supabase.channel('kanban-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, silentReload)
      .subscribe()
    return () => {
      window.removeEventListener('voiceTaskCreated', silentReload)
      supabase.removeChannel(ch)
    }
  }, [user?.id])

  async function loadAll({ silent = false } = {}) {
    if (!user?.id) return
    if (!silent) setLoading(true)
    setError(null)
    try {
      const [tasksRes, projectsRes, profilesRes] = await Promise.all([
        supabaseRest('tasks', {
          select: '*,projects(name,color)',
          filters: [
            `or=(assignee_id.eq.${user.id},created_by.eq.${user.id})`,
            'order=created_at.desc',
          ],
        }),
        supabaseRest('projects', { select: 'id,name', filters: ['archived=eq.false'] }),
        supabaseRest('profiles', { select: 'id,full_name,email' }),
      ])
      if (tasksRes.error) throw new Error(tasksRes.error.message ?? JSON.stringify(tasksRes.error))
      if (projectsRes.error) throw new Error(projectsRes.error.message ?? JSON.stringify(projectsRes.error))
      if (profilesRes.error) throw new Error(profilesRes.error.message ?? JSON.stringify(profilesRes.error))
      setTasks(tasksRes.data ?? [])
      setProjects(projectsRes.data ?? [])
      setTeam(profilesRes.data ?? [])
    } catch (err) {
      console.error('[Kanban] loadAll:', err)
      setError(err.message ?? 'Не удалось загрузить задачи')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  const tasksByStatus = useMemo(() => {
    const groups = { pending: [], in_progress: [], review: [], done: [] }
    for (const t of tasks) {
      const s = normalizeStatus(t.status)
      if (groups[s]) groups[s].push(t)
    }
    return groups
  }, [tasks])

  const teamById = useMemo(() => Object.fromEntries(team.map(u => [u.id, u])), [team])

  function applyTaskUpdate(updated) {
    setTasks(prev => prev.map(t => t.id === updated.id ? { ...t, ...updated, projects: t.projects } : t))
  }

  function removeTaskFromList(id) {
    setTasks(prev => prev.filter(t => t.id !== id))
    setSelectedId(null)
  }

  async function moveTask(task, toStatus) {
    const fromStatus = normalizeStatus(task.status)
    if (fromStatus === toStatus) return

    // Optimistic update
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: toStatus } : t))

    const { error } = await supabasePatch('tasks', task.id, { status: toStatus })
    if (error) {
      console.error('[Kanban] moveTask:', error)
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: task.status } : t))
      return
    }

    // Notify the creator on review / done — only when it's not a self-task.
    if (task.created_by && task.assignee_id && task.created_by !== task.assignee_id) {
      const me = user?.id
      // The mover is `me`. Notify the other person (creator if I'm assignee, assignee if I'm creator).
      const actorIsAssignee = me === task.assignee_id
      const recipient = actorIsAssignee ? task.created_by : null

      if (recipient && (toStatus === 'review' || toStatus === 'done')) {
        const notifTitle = toStatus === 'review'
          ? `Задача отправлена на проверку: ${task.title}`
          : `Задача выполнена: ${task.title}`
        const notifRes = await supabaseRest('notifications', {
          method: 'POST',
          body: {
            user_id: recipient,
            task_id: task.id,
            type:    toStatus === 'review' ? 'task_review' : 'task_done',
            title:   notifTitle,
          },
        })
        if (notifRes.error) console.warn('[Kanban] notification failed:', notifRes.error)
      }
    }
  }

  async function quickCreate(status, title) {
    const trimmed = title.trim()
    if (!trimmed) return
    const me = getCurrentUser()
    if (!me?.id) return
    const result = await supabaseRest('tasks', {
      method: 'POST',
      body: {
        title:       trimmed,
        status,
        priority:    'medium',
        assignee_id: me.id,
        created_by:  me.id,
      },
    })
    if (result.error) {
      console.error('[Kanban] quickCreate:', result.error)
      return
    }
    const created = Array.isArray(result.data) ? result.data[0] : result.data
    if (created) setTasks(prev => [created, ...prev])
  }

  const activeTask = activeId ? tasks.find(t => t.id === activeId) : null
  const selectedTask = tasks.find(t => t.id === selectedId) ?? null

  if (loading) return (
    <div className="flex items-center justify-center h-48">
      <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (error) return (
    <div className="flex flex-col items-center justify-center h-48 gap-3 text-center">
      <p className="text-sm text-muted">{error}</p>
      <button className="btn-secondary text-sm" onClick={loadAll}>Повторить</button>
    </div>
  )

  return (
    <div className="-mx-4 sm:-mx-6 px-4 sm:px-6">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={({ active }) => setActiveId(active.id)}
        onDragEnd={({ active, over }) => {
          setActiveId(null)
          if (!over) return
          const task = tasks.find(t => t.id === active.id)
          if (!task) return
          // `over.id` is either a column id or a task id (when hovering a card).
          // Resolve to the column.
          const overTask = tasks.find(t => t.id === over.id)
          const targetStatus = overTask ? normalizeStatus(overTask.status) : over.id
          if (!COLUMNS.find(c => c.id === targetStatus)) return
          moveTask(task, targetStatus)
        }}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="
          flex gap-3 overflow-x-auto pb-2
          lg:grid lg:grid-cols-4 lg:overflow-visible
        ">
          {COLUMNS.map(col => (
            <Column
              key={col.id}
              column={col}
              tasks={tasksByStatus[col.id]}
              teamById={teamById}
              onCardClick={setSelectedId}
              isAdding={adding === col.id}
              onAddOpen={() => setAdding(col.id)}
              onAddClose={() => setAdding(null)}
              onAddSubmit={title => { quickCreate(col.id, title); setAdding(null) }}
            />
          ))}
        </div>

        <DragOverlay dropAnimation={{ duration: 180 }}>
          {activeTask ? (
            <Card task={activeTask} teamById={teamById} dragging />
          ) : null}
        </DragOverlay>
      </DndContext>

      {selectedTask && (
        <TaskDetailDrawer
          task={selectedTask}
          projects={projects}
          team={team}
          onClose={() => setSelectedId(null)}
          onUpdated={applyTaskUpdate}
          onDeleted={removeTaskFromList}
        />
      )}
    </div>
  )
}

function Column({ column, tasks, teamById, onCardClick, isAdding, onAddOpen, onAddClose, onAddSubmit }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id })
  return (
    <div
      ref={setNodeRef}
      className={`
        shrink-0 w-[280px]
        md:w-[calc(50%-6px)]
        lg:w-auto lg:min-w-0 lg:shrink
        bg-bg/40 border rounded-xl flex flex-col
        max-h-[calc(100vh-160px)] transition-colors
        ${isOver ? 'border-primary bg-primary/5' : 'border-border'}
      `}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border shrink-0">
        <span className={`w-2 h-2 rounded-full ${column.accent}`} />
        <h3 className="text-sm font-semibold text-text">{column.label}</h3>
        <span className="text-xs text-muted">{tasks.length}</span>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {tasks.length === 0 && !isAdding && (
          <p className="text-xs text-muted text-center py-6">Пусто</p>
        )}
        {tasks.map(task => (
          <Card
            key={task.id}
            task={task}
            teamById={teamById}
            onClick={() => onCardClick(task.id)}
          />
        ))}
        {isAdding && (
          <QuickAdd onSubmit={onAddSubmit} onCancel={onAddClose} />
        )}
      </div>

      {/* Add button */}
      {!isAdding && (
        <button
          onClick={onAddOpen}
          className="text-sm text-muted hover:text-text hover:bg-hover transition-colors px-3 py-2 border-t border-border flex items-center gap-1.5 shrink-0"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Задача
        </button>
      )}
    </div>
  )
}

function Card({ task, teamById, onClick, dragging }) {
  const { setNodeRef, attributes, listeners, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  })

  const today = new Date().toISOString().split('T')[0]
  const isOverdue = task.due_date && task.due_date < today && normalizeStatus(task.status) !== 'done'
  const assignee = teamById[task.assignee_id]
  const previewText = descriptionPreview(task.description)

  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={onClick}
      className={`bg-card border border-border rounded-lg p-3 shadow-card hover:shadow-card-hover active:cursor-grabbing select-none ${
        dragging ? 'cursor-grabbing rotate-1 shadow-card-hover' : 'cursor-grab'
      }`}
    >
      <div className="flex items-start gap-2 mb-2">
        {task.priority && (
          <span
            className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${PRIORITY_DOT[task.priority] ?? 'bg-muted'}`}
          />
        )}
        <p className="text-sm font-medium text-text break-words">{task.title}</p>
      </div>

      {previewText && (
        <p className="text-xs text-muted line-clamp-2 mb-2">{previewText}</p>
      )}

      {task.projects && (
        <span
          className="inline-flex items-center gap-1.5 text-xs text-text bg-hover px-2 py-0.5 rounded-full mb-2 max-w-full"
        >
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: task.projects.color ?? '#2D5BE3' }} />
          <span className="truncate">{task.projects.name}</span>
        </span>
      )}

      <div className="flex items-center justify-between gap-2">
        {assignee ? (
          <div
            className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-primary text-[10px] font-bold shrink-0"
            title={assignee.full_name || assignee.email}
          >
            {(assignee.full_name ?? assignee.email ?? '?')[0].toUpperCase()}
          </div>
        ) : <span />}

        {task.due_date && (
          <span className={`text-xs ${isOverdue ? 'text-red-500 font-medium' : 'text-muted'}`}>
            {new Date(task.due_date + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
          </span>
        )}
      </div>
    </div>
  )
}

function QuickAdd({ onSubmit, onCancel }) {
  const [value, setValue] = useState('')
  return (
    <form
      onSubmit={e => { e.preventDefault(); onSubmit(value) }}
      className="bg-card border border-primary rounded-lg p-2"
    >
      <input
        autoFocus
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') onCancel() }}
        onBlur={() => { if (!value.trim()) onCancel() }}
        placeholder="Название задачи и Enter"
        className="w-full bg-transparent text-sm text-text placeholder:text-muted outline-none border-0 px-1 py-1"
      />
      <div className="flex gap-1.5 mt-1.5">
        <button type="submit" className="btn-primary text-xs px-2.5 py-1">Создать</button>
        <button type="button" className="btn-secondary text-xs px-2.5 py-1" onClick={onCancel}>Отмена</button>
      </div>
    </form>
  )
}
