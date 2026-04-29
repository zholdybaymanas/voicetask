import { createContext, useContext, useEffect, useState } from 'react'

// Each theme entry includes the swatch colors used by the picker UI on
// /settings (small color circles).
export const THEMES = [
  {
    id: 'dark', name: 'Тёмная',
    swatch: '#0F1117', accent: '#2D5BE3', borderColor: '#262A38',
  },
  {
    id: 'cloud-dancer', name: 'Cloud Dancer',
    swatch: '#F0EEE9', accent: '#2D5BE3', borderColor: '#E2DED7',
  },
  {
    id: 'mocha', name: 'Mocha',
    swatch: '#F5F0EB', accent: '#A47864', borderColor: '#E8DED3',
  },
  {
    id: 'ocean', name: 'Ocean',
    swatch: '#F0F4F8', accent: '#0EA5E9', borderColor: '#DBE2EA',
  },
  {
    id: 'midnight-purple', name: 'Midnight Purple',
    swatch: '#0D0D1A', accent: '#7C3AED', borderColor: '#23234B',
  },
]

export const STORAGE_KEY = 'voicetask:theme'
export const DEFAULT_THEME = 'dark'

const ThemeContext = createContext(null)

function readStoredTheme() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return THEMES.some(t => t.id === v) ? v : DEFAULT_THEME
  } catch { return DEFAULT_THEME }
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(readStoredTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try { localStorage.setItem(STORAGE_KEY, theme) } catch {}

    // Sync iOS PWA / Android status-bar tint to the active theme background
    // so there's no leftover blue bar at the bottom of the screen.
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) {
      const t = THEMES.find(x => x.id === theme)
      if (t?.swatch) meta.setAttribute('content', t.swatch)
    }
  }, [theme])

  function setTheme(id) {
    if (THEMES.some(t => t.id === id)) setThemeState(id)
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
