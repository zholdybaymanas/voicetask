import { useState, useEffect, useMemo, useRef } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor,
  useDroppable, useSensor, useSensors,
  closestCorners,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { supabaseRest, supabasePatch, getCurrentUser } from '../lib/supabase'
import { syncTaskToGoogleCalendar } from '../lib/googleCalendar'
import { useTaskRealtime } from '../hooks/useTaskRealtime'
import { taskVisibilityFilter } from '../lib/taskAccess'
import { useAuth } from '../hooks/useAuth'
import { descriptionPreview } from '../lib/description'
import TaskDetailDrawer from '../components/TaskDetailDrawer'

const COLUMNS = [
  { id: 'pending',     label: 'Новая',       shortLabel: 'Новая',     accent: 'bg-slate-400',   accentText: 'text-slate-400' },
  { id: 'in_progress', label: 'В работе',    shortLabel: 'В работе',  accent: 'bg-amber-400',   accentText: 'text-amber-400' },
  { id: 'review',      label: 'На проверке', shortLabel: 'Проверка',  accent: 'bg-violet-400',  accentText: 'text-violet-400' },
  { id: 'done',        label: 'Выполнена',   shortLabel: 'Выполнена', accent: 'bg-emerald-500', accentText: 'text-emerald-500' },
]

const PRIORITY_DOT = { high: 'bg-red-500', medium: 'bg-amber-400', low: 'bg-muted' }

function normalizeStatus(s) {
  if (s === 'todo') return 'pending'
  if (s === 'cancelled') return 'done'
  return s ?? 'pending'
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < 768
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const onChange = (e) => setIsMobile(e.matches)
    if (mq.addEventListener) mq.addEventListener('change', onChange)
    else mq.addListener(onChange)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange)
      else mq.removeListener(onChange)
    }
  }, [])
  return isMobile
}

export default function KanbanPage({ projectFilter = null } = {}) {
  const { user, profile } = useAuth()
  const isMobile = useIsMobile()
  const [tasks, setTasks]     = useState([])
  const [projects, setProjects] = useState([])
  const [team, setTeam]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [activeId, setActiveId] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [adding, setAdding]   = useState(null)
  const [activeColumn, setActiveColumn] = useState('pending')
  const [moveMenuTask, setMoveMenuTask] = useState(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 150, tolerance: 5 } }),
  )

  useEffect(() => {
    if (!user?.id) return
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, profile?.role, projectFilter])

  useTaskRealtime({
    channelName: projectFilter ? `kanban-rt-${projectFilter}` : 'kanban-rt',
    enabled:     !!user?.id,
    refresh:     loadAll,
    deps:        [user?.id, profile?.role, projectFilter],
  })

  async function loadAll({ silent = false } = {}) {
    if (!user?.id) return
    if (!silent) setLoading(true)
    setError(null)
    try {
      // Project-scoped Kanban shows every task in the project — the
      // shared board is meant to give all participants the full picture.
      // Global Kanban (no projectFilter) still limits to the user's own
      // tasks via taskVisibilityFilter.
      const taskFilters = [
        ...(projectFilter ? [] : taskVisibilityFilter(user, profile)),
        ...(projectFilter ? [`project_id=eq.${projectFilter}`] : []),
        'order=sort_order.desc.nullslast,created_at.desc',
      ]
      const [tasksRes, projectsRes, profilesRes] = await Promise.all([
        supabaseRest('tasks', { select: '*,projects(name,color)', filters: taskFilters }),
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
    // Within each column, sort by sort_order DESC (top = highest), then by created_at DESC.
    for (const k of Object.keys(groups)) {
      groups[k].sort((a, b) => {
        const ao = a.sort_order ?? 0
        const bo = b.sort_order ?? 0
        if (ao !== bo) return bo - ao
        return new Date(b.created_at) - new Date(a.created_at)
      })
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

  // Pick a sort_order between the two neighbours so the dropped task
  // sits between them (sort_order DESC ⇒ above's value > below's value).
  function neighborMid(above, below) {
    const ao = above?.sort_order
    const bo = below?.sort_order
    if (ao == null && bo == null) return Date.now() / 1000
    if (ao == null) return bo + 1                  // dropped at top
    if (bo == null) return ao - 1                  // dropped at bottom
    return (ao + bo) / 2
  }

  // Used by mobile move-menu fallback — drops at top of destination column.
  function pickSortOrder(destTasks, targetIndex) {
    const above = destTasks[targetIndex - 1]
    const below = destTasks[targetIndex]
    return neighborMid(above, below)
  }

  async function moveTask(task, toStatus, newSortOrder = null) {
    const fromStatus = normalizeStatus(task.status)
    const samePosition = fromStatus === toStatus && newSortOrder == null
    if (samePosition) return

    // Cross-column moves without an explicit position (e.g. mobile menu)
    // drop the task at the top of the destination column.
    if (newSortOrder == null && fromStatus !== toStatus) {
      const destList = (tasksByStatus[toStatus] ?? []).filter(t => t.id !== task.id)
      newSortOrder = pickSortOrder(destList, 0)
    }

    const patch = { status: toStatus }
    if (newSortOrder != null) patch.sort_order = newSortOrder

    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, ...patch } : t))

    const { error } = await supabasePatch('tasks', task.id, patch)
    if (error) {
      console.error('[Kanban] moveTask:', error)
      setTasks(prev => prev.map(t => t.id === task.id
        ? { ...t, status: task.status, sort_order: task.sort_order } : t))
      return
    }

    // Re-sync to Google Calendar so done-status updates with [✓] prefix.
    if (fromStatus !== toStatus) syncTaskToGoogleCalendar(task.id)

    // Cross-column moves notify the creator on review / done (only delegated tasks).
    const crossColumn = fromStatus !== toStatus
    if (crossColumn && task.created_by && task.assignee_id && task.created_by !== task.assignee_id) {
      const me = user?.id
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
        sort_order:  Date.now() / 1000,
        ...(projectFilter ? { project_id: projectFilter } : {}),
      },
    })
    if (result.error) {
      console.error('[Kanban] quickCreate:', result.error)
      return
    }
    const created = Array.isArray(result.data) ? result.data[0] : result.data
    if (created) {
      setTasks(prev => [created, ...prev])
      if (created.id) syncTaskToGoogleCalendar(created.id)
    }
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
      <button className="btn-secondary text-sm" onClick={() => loadAll()}>Повторить</button>
    </div>
  )

  return (
    <div className="-mx-4 sm:-mx-6 px-4 sm:px-6">
      {isMobile ? (
        <MobileBoard
          activeColumn={activeColumn}
          setActiveColumn={setActiveColumn}
          tasksByStatus={tasksByStatus}
          teamById={teamById}
          onCardClick={setSelectedId}
          onLongPress={setMoveMenuTask}
          isAdding={adding === activeColumn}
          onAddOpen={() => setAdding(activeColumn)}
          onAddClose={() => setAdding(null)}
          onAddSubmit={title => { quickCreate(activeColumn, title); setAdding(null) }}
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={({ active }) => setActiveId(active.id)}
          onDragEnd={({ active, over }) => {
            setActiveId(null)
            if (!over || active.id === over.id) return

            const activeTask = tasks.find(t => t.id === active.id)
            if (!activeTask) return

            const overTask = tasks.find(t => t.id === over.id)
            const targetStatus = overTask ? normalizeStatus(overTask.status) : over.id
            if (!COLUMNS.find(c => c.id === targetStatus)) return

            const sourceStatus = normalizeStatus(activeTask.status)

            // Same-column reorder: use dnd-kit's canonical arrayMove pattern.
            // Read the post-move neighbors from the reordered array — that
            // way the dropped position always matches the preview exactly.
            if (sourceStatus === targetStatus && overTask) {
              const items   = tasksByStatus[targetStatus] ?? []
              const oldIdx  = items.findIndex(t => t.id === activeTask.id)
              const newIdx  = items.findIndex(t => t.id === overTask.id)
              if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return

              const reordered = arrayMove(items, oldIdx, newIdx)
              const above = reordered[newIdx - 1]
              const below = reordered[newIdx + 1]
              const newSortOrder = neighborMid(above, below)
              moveTask(activeTask, targetStatus, newSortOrder)
              return
            }

            // Cross-column move: place `active` at over's position in the
            // destination column (or at the end if dropped on column body).
            const destItems = tasksByStatus[targetStatus] ?? []
            let insertAt = destItems.length
            if (overTask) {
              const idx = destItems.findIndex(t => t.id === overTask.id)
              if (idx !== -1) insertAt = idx
            }
            const above = destItems[insertAt - 1]
            const below = destItems[insertAt]
            const newSortOrder = neighborMid(above, below)
            moveTask(activeTask, targetStatus, newSortOrder)
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
      )}

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

      {moveMenuTask && (
        <MoveMenu
          task={moveMenuTask}
          onSelect={status => { moveTask(moveMenuTask, status); setMoveMenuTask(null) }}
          onClose={() => setMoveMenuTask(null)}
        />
      )}
    </div>
  )
}

// ─── Mobile ──────────────────────────────────────────────────────────────

function MobileBoard({
  activeColumn, setActiveColumn,
  tasksByStatus, teamById,
  onCardClick, onLongPress,
  isAdding, onAddOpen, onAddClose, onAddSubmit,
}) {
  const touchStartRef = useRef(null)
  const column = COLUMNS.find(c => c.id === activeColumn) ?? COLUMNS[0]
  const tasks = tasksByStatus[activeColumn] ?? []

  function onTouchStart(e) {
    const t = e.touches[0]
    touchStartRef.current = { x: t.clientX, y: t.clientY }
  }
  function onTouchEnd(e) {
    if (!touchStartRef.current) return
    const t = e.changedTouches[0]
    const dx = touchStartRef.current.x - t.clientX
    const dy = touchStartRef.current.y - t.clientY
    touchStartRef.current = null
    if (Math.abs(dx) <= Math.abs(dy)) return        // vertical scroll, ignore
    if (Math.abs(dx) <= 50) return                  // not enough swipe
    const idx = COLUMNS.findIndex(c => c.id === activeColumn)
    if (dx > 0 && idx < COLUMNS.length - 1) setActiveColumn(COLUMNS[idx + 1].id)
    if (dx < 0 && idx > 0)                  setActiveColumn(COLUMNS[idx - 1].id)
  }

  return (
    <>
      {/* Tabs — fit all four into one row, no horizontal scroll */}
      <div className="flex -mx-4 px-4 border-b border-border mb-3">
        {COLUMNS.map(c => {
          const isActive = c.id === activeColumn
          const count = tasksByStatus[c.id]?.length ?? 0
          return (
            <button
              key={c.id}
              onClick={() => setActiveColumn(c.id)}
              className={`
                flex-1 min-w-0 px-0.5 py-2 text-xs font-medium transition-colors relative truncate
                ${isActive ? 'text-text' : 'text-muted hover:text-text'}
              `}
            >
              {c.shortLabel ?? c.label} ({count})
              {isActive && (
                <span className="absolute left-1 right-1 -bottom-px h-0.5 bg-primary rounded-full" />
              )}
            </button>
          )
        })}
      </div>

      {/* Active column */}
      <div
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className="space-y-2 min-h-[60vh] pb-4"
      >
        {tasks.length === 0 && !isAdding ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm text-muted">В колонке «{column.label}» пусто</p>
            <p className="text-xs text-muted mt-1">Свайп влево/вправо — другая колонка</p>
          </div>
        ) : (
          tasks.map(task => (
            <CardMobile
              key={task.id}
              task={task}
              teamById={teamById}
              onClick={() => onCardClick(task.id)}
              onLongPress={() => onLongPress(task)}
            />
          ))
        )}

        {isAdding && <QuickAdd onSubmit={onAddSubmit} onCancel={onAddClose} />}

        {!isAdding && (
          <button
            onClick={onAddOpen}
            className="w-full text-sm text-muted hover:text-text hover:bg-hover transition-colors px-3 py-2.5 border border-dashed border-border rounded-lg flex items-center justify-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Задача
          </button>
        )}
      </div>
    </>
  )
}

function CardMobile({ task, teamById, onClick, onLongPress }) {
  const timerRef = useRef(null)
  const startRef = useRef(null)
  const longPressedRef = useRef(false)

  function handleTouchStart(e) {
    longPressedRef.current = false
    const t = e.touches[0]
    startRef.current = { x: t.clientX, y: t.clientY }
    timerRef.current = setTimeout(() => {
      longPressedRef.current = true
      timerRef.current = null
      try { navigator.vibrate?.(50) } catch {}
      onLongPress()
    }, 450)
  }
  function handleTouchMove(e) {
    if (!startRef.current || !timerRef.current) return
    const t = e.touches[0]
    if (Math.abs(t.clientX - startRef.current.x) > 8 ||
        Math.abs(t.clientY - startRef.current.y) > 8) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }
  function handleTouchEnd() {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    startRef.current = null
  }
  function handleClick() {
    if (longPressedRef.current) {
      // long-press already handled — swallow the synthetic click
      longPressedRef.current = false
      return
    }
    onClick()
  }

  const today = new Date().toISOString().split('T')[0]
  const isOverdue = task.due_date && task.due_date < today && normalizeStatus(task.status) !== 'done'
  const assignee = teamById[task.assignee_id]
  const previewText = descriptionPreview(task.description)

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onClick={handleClick}
      className="bg-card border border-border rounded-lg p-3 shadow-card hover:shadow-card-hover active:scale-[0.99] select-none cursor-pointer"
    >
      <div className="flex items-start gap-2 mb-2">
        {task.priority && (
          <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${PRIORITY_DOT[task.priority] ?? 'bg-muted'}`} />
        )}
        <p className="text-sm font-medium text-text break-words">{task.title}</p>
      </div>

      {previewText && (
        <p className="text-xs text-muted line-clamp-2 mb-2">{previewText}</p>
      )}

      {task.projects && (
        <span className="inline-flex items-center gap-1.5 text-xs text-text bg-hover px-2 py-0.5 rounded-full mb-2 max-w-full">
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

function MoveMenu({ task, onSelect, onClose }) {
  const currentStatus = normalizeStatus(task.status)
  const targets = COLUMNS.filter(c => c.id !== currentStatus)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-4 drawer-enter">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-sm p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-3">
          <p className="text-sm font-semibold text-text truncate flex-1">{task.title}</p>
          <button onClick={onClose} className="text-muted hover:text-text p-1 rounded-lg hover:bg-hover">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="text-xs text-muted mb-3">Переместить в:</p>

        <div className="space-y-1">
          {targets.map(c => (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-text hover:bg-hover transition-colors"
            >
              <span className={`w-2 h-2 rounded-full ${c.accent}`} />
              <span>{c.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Desktop ─────────────────────────────────────────────────────────────

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
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border shrink-0">
        <span className={`w-2 h-2 rounded-full ${column.accent}`} />
        <h3 className="text-sm font-semibold text-text">{column.label}</h3>
        <span className="text-xs text-muted">{tasks.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {tasks.length === 0 && !isAdding && (
          <p className="text-xs text-muted text-center py-6">Пусто</p>
        )}
        <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map(task => (
            <Card
              key={task.id}
              task={task}
              teamById={teamById}
              onClick={() => onCardClick(task.id)}
            />
          ))}
        </SortableContext>
        {isAdding && (
          <QuickAdd onSubmit={onAddSubmit} onCancel={onAddClose} />
        )}
      </div>

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
  const {
    setNodeRef, attributes, listeners,
    transform, transition, isDragging,
  } = useSortable({ id: task.id, data: { task } })

  const today = new Date().toISOString().split('T')[0]
  const isOverdue = task.due_date && task.due_date < today && normalizeStatus(task.status) !== 'done'
  const assignee = teamById[task.assignee_id]
  const previewText = descriptionPreview(task.description)

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
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
          <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${PRIORITY_DOT[task.priority] ?? 'bg-muted'}`} />
        )}
        <p className="text-sm font-medium text-text break-words">{task.title}</p>
      </div>

      {previewText && (
        <p className="text-xs text-muted line-clamp-2 mb-2">{previewText}</p>
      )}

      {task.projects && (
        <span className="inline-flex items-center gap-1.5 text-xs text-text bg-hover px-2 py-0.5 rounded-full mb-2 max-w-full">
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
