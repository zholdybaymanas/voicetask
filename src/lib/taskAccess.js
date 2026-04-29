// Returns the PostgREST filter strings needed to restrict a `tasks` query
// to what the current user is allowed to see.
//
//   admin  → no filter (sees every task)
//   member → assignee_id == me OR created_by == me
//
// Usage:
//   const filters = ['order=created_at.desc', ...taskVisibilityFilter(user, profile)]
//   supabaseRest('tasks', { filters })
//
// RLS on the server is the source of truth — this filter exists to keep the
// client honest (and to make admin/member views obvious in the UI).
export function taskVisibilityFilter(user, profile) {
  if (!user?.id) return []
  if (profile?.role === 'admin') return []
  return [`or=(assignee_id.eq.${user.id},created_by.eq.${user.id})`]
}
