export const CONTEXT_LIMITS: { maxMessages: number; keepMessages: number; maxChars: number }
export function planCompaction(history: unknown[], limits?: { maxMessages?: number; keepMessages?: number; maxChars?: number }): { needed: boolean; cut: number }
export function buildSummaryPrompt(previousSummary: string, messages: unknown[], options?: { maxChars?: number }): { role: string; content: string }[]
export function buildSummarySystemMessage(summary: string, coveredMessages: number): string
export function searchMessageList(messages: unknown[], query: string, limit?: number): { index: number; role: string; at: string; content: string; score: number }[]
export function searchHistory(conversations: Record<string, any[]>, person: string, query: string, limit?: number): { conversationId: string; title: string; role: string; at: string; content: string; score: number }[]
type SummaryMessage = { id?: string; role: string; content: string }
type SummaryConversation = { messages: SummaryMessage[]; summary?: string; summaryThroughId?: string; summaryThrough?: number; summaryAt?: string }
type SummaryRefresh = { source: SummaryMessage[]; throughId: string; previousSummary?: string; prompt: ReturnType<typeof buildSummaryPrompt> }
export function updateSummaryMessages<T extends SummaryConversation>(conversation: T, messages: T['messages']): T
export function planSummaryRefresh(history: SummaryMessage[], coveredIndex: number, previousSummary?: string): SummaryRefresh | null
export function applySummaryRefresh<T extends SummaryConversation>(conversation: T, refresh: SummaryRefresh, summary: string, at: string): T
