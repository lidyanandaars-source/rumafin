import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { hasSupabaseConfig, supabase } from '@/lib/supabase'

interface AuthContextValue {
  user: User | null
  session: Session | null
  loading: boolean
  configured: boolean
}

const AuthContext = createContext<AuthContextValue>({ user: null, session: null, loading: true, configured: false })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(hasSupabaseConfig)

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    let mounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) {
        setSession(data.session)
        setLoading(false)
      }
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setLoading(false)
    })

    return () => {
      mounted = false
      listener.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo(() => ({ user: session?.user ?? null, session, loading, configured: hasSupabaseConfig }), [session, loading])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
