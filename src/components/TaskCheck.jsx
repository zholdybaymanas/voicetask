// Reusable themed task checkbox — toggles a task's done status.
// Shared by Dashboard and TasksPage.
export default function TaskCheck({ done, onToggle, isOverdue, ariaLabel }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onToggle?.() }}
      className={`task-check ${done ? 'is-done' : ''} ${isOverdue ? 'is-overdue' : ''}`}
      aria-label={ariaLabel ?? (done ? 'Снова открыть задачу' : 'Закрыть задачу')}
    >
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
      </svg>
    </button>
  )
}
