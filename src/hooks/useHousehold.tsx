import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listMemberships } from '@/services/households'
import { useAuth } from '@/features/auth/AuthProvider'
import type { Household, HouseholdRole } from '@/types/domain'

interface HouseholdContextValue {
  household: Household | null
  householdId: string | null
  role: HouseholdRole | null
  memberships: ReturnType<typeof useMemberships>['data']
  loading: boolean
  setHouseholdId: (id: string) => void
}

function useMemberships() {
  const { user } = useAuth()
  return useQuery({ queryKey: ['memberships', user?.id], queryFn: listMemberships, enabled: Boolean(user) })
}

const HouseholdContext = createContext<HouseholdContextValue>({
  household: null,
  householdId: null,
  role: null,
  memberships: undefined,
  loading: true,
  setHouseholdId: () => undefined,
})

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const query = useMemberships()
  const [householdId, setHouseholdIdState] = useState<string | null>(() => localStorage.getItem('active-household-id'))

  useEffect(() => {
    if (!query.data?.length) return
    const stillValid = householdId && query.data.some((m) => m.household_id === householdId)
    if (!stillValid) setHouseholdIdState(query.data[0]!.household_id)
  }, [query.data, householdId])

  const setHouseholdId = (id: string) => {
    setHouseholdIdState(id)
    localStorage.setItem('active-household-id', id)
  }

  const membership = query.data?.find((m) => m.household_id === householdId) ?? null
  const household = (membership?.household ?? null) as Household | null

  const value = useMemo(() => ({
    household,
    householdId,
    role: membership?.role ?? null,
    memberships: query.data,
    loading: query.isLoading,
    setHouseholdId,
  }), [household, householdId, membership?.role, query.data, query.isLoading])

  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>
}

export function useHousehold() {
  return useContext(HouseholdContext)
}
