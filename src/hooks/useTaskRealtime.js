// Subscribe to realtime changes on the `tasks` table + listen for the
// `voiceTaskCreated` window event (fired when VoiceInput creates a new
// task). On either signal, calls `refresh({ silent: true })` so the
// page updates without flashing the full-screen spinner.
//
// Each caller must pass a stable channel name (different page = different
// channel) so multiple pages can subscribe in parallel without conflicts.
import { useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function useTaskRealtime({ channelName, enabled = true, refresh, deps = [] }) {
  useEffect(() => {
    if (!enabled || typeof refresh !== 'function') return
    const silentReload = () => refresh({ silent: true })
    window.addEventListener('voiceTaskCreated', silentReload)
    const ch = supabase.channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, silentReload)
      .subscribe()
    return () => {
      window.removeEventListener('voiceTaskCreated', silentReload)
      supabase.removeChannel(ch)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, enabled, ...deps])
}
