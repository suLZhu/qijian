export function buildBackupPayload(kindId: string, people: string[]): Promise<any>
export function savePreUpdateBackup(people: string[], options?: {requiredState?: {conversations?: unknown}; verify?: () => boolean}): Promise<string>
