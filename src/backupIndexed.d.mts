export function collectBackupIndexed(kind: string): Promise<Record<string, unknown>>
export function applyBackupIndexed(kind: string, data: unknown): Promise<() => Promise<void>>
