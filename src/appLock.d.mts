export type AppLockApp = { pkg: string; label: string; locked: boolean; excluded?: boolean }
export type AppLockStatus = { accessibility: boolean; hasPin: boolean; locked: number }
export function appLockAvailable(): boolean
export function appLockStatus(): AppLockStatus | null
export function appLockApps(): AppLockApp[]
export function appLockSetLocked(pkg: string, locked: boolean): boolean
export function appLockSetPin(pin: string): { ok: boolean; error?: string }
export function appLockOpenSettings(): void

export function appLockSetExcluded(pkg: string, excluded: boolean): boolean
