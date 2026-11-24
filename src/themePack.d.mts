type ThemeBackground = { image?: string; color?: string; opacity?: number }
type ThemeStroke = 'none' | 'solid' | 'dashed' | 'double'

export type ThemePack = {
  format: string
  version: number
  id: string
  name: string
  author: string
  description: string
  tokens: Record<string, string>
  bubble?: { style?: string; radius?: number; me?: string; ai?: string }
  background?: ThemeBackground
  chatBackground?: ThemeBackground
  font?: { family?: string; src?: string }
  appearance?: {
    button?: { radius?: number; stroke?: ThemeStroke }
    card?: { radius?: number; stroke?: ThemeStroke; material?: 'flat' | 'paper' | 'glass'; rotation?: number; decoration?: 'none' | 'tape' | 'paper-edge' | 'sticker' }
    motion?: { press?: 'none' | 'fade' | 'compress'; duration?: number }
  }
  icons?: Record<string, string>
}

export const PACK_FORMAT: string
export const PACK_VERSION: number
export const PACKS_KEY: string
export const ACTIVE_PACK_KEY: string
export const PACK_TOKEN_KEYS: string[]
export const PACK_ICON_KEYS: string[]
export const PACK_BUBBLE_STYLES: string[]

export function normalizeThemePack(input: unknown): ThemePack
export function parseThemePack(text: string): ThemePack
export function loadThemePacks(storage?: Storage): ThemePack[]
export function saveThemePacks(list: ThemePack[], storage?: Storage): ThemePack[]
export function upsertThemePack(pack: ThemePack, storage?: Storage): ThemePack[]
export function removeThemePack(id: string, storage?: Storage): ThemePack[]
export function getActivePackId(storage?: Storage): string
export function setActivePack(id: string, storage?: Storage): void
export function packCssVars(pack: ThemePack | null): Record<string, string>
export function applyPackVars(pack: ThemePack | null): void
export function packFromZip(buffer: ArrayBuffer | Uint8Array): Promise<ThemePack>
