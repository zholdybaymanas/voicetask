// Tasks store subtasks inside the `description` column as a JSON object
// of shape `{ text: string, subtasks: [{id, text, done}] }`.
// When a task has no subtasks, `description` stays as plain text for
// backward compatibility with existing rows and the voice-input flow.

export function parseDescription(raw) {
  if (typeof raw !== 'string' || !raw) return { text: '', subtasks: [] }
  if (raw[0] !== '{') return { text: raw, subtasks: [] }
  try {
    const obj = JSON.parse(raw)
    if (obj && Array.isArray(obj.subtasks)) {
      return {
        text: typeof obj.text === 'string' ? obj.text : '',
        subtasks: obj.subtasks
          .filter(s => s && typeof s.text === 'string')
          .map(s => ({
            id:   typeof s.id === 'string' ? s.id : Math.random().toString(36).slice(2),
            text: s.text,
            done: !!s.done,
          })),
      }
    }
  } catch {}
  return { text: raw, subtasks: [] }
}

export function serializeDescription(text, subtasks) {
  const trimmed = (text || '').trim()
  if (!subtasks || subtasks.length === 0) return trimmed || null
  return JSON.stringify({ text: trimmed, subtasks })
}

export function descriptionPreview(raw) {
  return parseDescription(raw).text
}

export function newSubtaskId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}
