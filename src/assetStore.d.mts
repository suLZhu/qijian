export declare function loadCustomAssets<T extends object>(fallback: T): Promise<T>
export declare function saveCustomAssets(assets: object): Promise<void>

export function readStoredCustomAssets(): Promise<Record<string, unknown> | null>
export function writeStoredCustomAssets(value: Record<string, unknown> | null): Promise<void>
