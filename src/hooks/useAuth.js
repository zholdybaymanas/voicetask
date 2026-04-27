import { useState, useEffect } from 'react'
import { supabase, supabaseRest } from '../lib/supabase'

// Read session from localStorage without touching the Supabase client
function readStoredSession() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith('sb-') && key.endsWith('-auth-token')) {
        const raw = localStorage.getItem(key)
        return raw ? JSON.parse(raw) : null
      }
    }
  } catch {}
  return null
}

export function useAuth() {
  // Initialize immediately from localStorage — no waiting for getSession() which may hang
  const [session, setSession] = useState(() => readStoredSession())
  const [user, setUser]       = useState(() => readStoredSession()?.user ?? null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

  useEffect(() => {
    // Load profile for users already logged in at mount time
    const stored = readStoredSession()
    if (stored?.user) loadProfile(stored.user.id)

    // Handle future auth changes: sign-in, sign-out, token refresh
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        await loadProfile(session.user.id)
      } else {
        setProfile(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function loadProfile(userId) {
    const { data } = await supabaseRest('profiles', { filters: [`id=eq.${userId}`] })
    setProfile(data?.[0] ?? null)
  }

  async function signIn(email, password) {
    setError(null)
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    return { data, error }
  }

  async function signUp(email, password, fullName) {
    setError(null)
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName?.trim() || '' },
        // Send confirmation links back to whichever origin the user is
        // signing up from. Without this, Supabase falls back to its
        // configured Site URL (often still localhost).
        emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
      },
    })
    if (error) setError(error.message)
    return { data, error }
  }

  async function signOut() {
    setError(null)
    const { error } = await supabase.auth.signOut()
    if (error) setError(error.message)
    return { error }
  }

  return { session, user, profile, loading, error, signIn, signUp, signOut }
}
