export type LedgerRound = { model: string; vendorId: string; vendor: string; subscription: boolean; promptTokens: number; completionTokens: number }
export declare function usageRows(conversations: unknown[]): Array<{ key: string; model: string; vendor: string; subscription: boolean; calls: number; tokens: number; lastAt: string }>
