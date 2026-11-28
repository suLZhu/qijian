export type LedgerRound = { model: string; vendorId: string; vendor: string; subscription: boolean; promptTokens: number; completionTokens: number }
export declare function usageRows(conversations: unknown[]): Array<{ key: string; model: string; vendor: string; subscription: boolean; calls: number; tokens: number; lastAt: string }>

export declare function readMediaUsage(storage:Storage,person:string):unknown[]
export declare function recordMediaUsage(storage:Storage,person:string,usage:unknown):void
