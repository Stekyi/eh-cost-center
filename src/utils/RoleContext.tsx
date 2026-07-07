import { createContext, useContext } from 'react'

export type StaffRole = 'admin' | 'videographer' | 'assistant'
export const RoleContext = createContext<StaffRole | null>(null)
export function useRole() { return useContext(RoleContext) }
