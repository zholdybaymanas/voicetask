// Shared task mutations used across Dashboard, TasksPage, ProjectDetailPage.
// Pattern: optimistic UI update → PATCH → rollback on error.
import { supabasePatch } from './supabase'
import { syncTaskToGoogleCalendar } from './googleCalendar'

export async function toggleTaskDone(task, setTasks) {
  const nextStatus = task.status === 'done' ? 'pending' : 'done'

  // Optimistic
  setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: nextStatus } : t))

  const { error } = await supabasePatch('tasks', task.id, { status: nextStatus })
  if (error) {
    console.error('[taskActions] toggleDone:', error)
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: task.status } : t))
    return { error }
  }

  // Best-effort GCal re-sync (adds/removes [✓] in event title)
  syncTaskToGoogleCalendar(task.id)
  return { error: null }
}

export async function setTaskStatus(id, nextStatus, setTasks) {
  let prev
  setTasks(curr => {
    const found = curr.find(t => t.id === id)
    prev = found?.status
    return curr.map(t => t.id === id ? { ...t, status: nextStatus } : t)
  })
  const { error } = await supabasePatch('tasks', id, { status: nextStatus })
  if (error) {
    console.error('[taskActions] setStatus:', error)
    if (prev != null) setTasks(curr => curr.map(t => t.id === id ? { ...t, status: prev } : t))
    return { error }
  }
  syncTaskToGoogleCalendar(id)
  return { error: null }
}
