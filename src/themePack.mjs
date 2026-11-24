import { readZip, bytesToDataUrl } from './zip.mjs'
import { UI_ICON_KEYS } from './uiIconKeys.mjs'
// 主题包支持 v1 和 v2。v2 增加独立聊天背景、统一图标清单和控件样式。
// 一个包可统一控制整 App 壁纸 / 页面背景 / surface / 控件 / 按钮 / 图标语义色 / 字体 / 聊天气泡。
// 旧包仍可继续导入；未提供的新 token 会从 accent / surface / field 等基础色自动继承。
//
// 示例：
// {
//   "format": "qijian-theme-pack",
//   "version": 1,
//   "name": "海盐",
//   "author": "you",
//   "tokens": { "accent": "#5b8fb9", "pageBg": "#edf3f6", "surface": "#f8fbfc",
//               "field": "#eef4f7", "ink": "#33414d", "line": "#dbe6ee",
//               "iconAccent": "#5b8fb9", "buttonPrimary": "#5b8fb9" },
//   "background": { "image": "https://…/bg.jpg", "opacity": 0.9 },
//   "font": { "family": "system-ui, sans-serif" },
//   "bubble": { "style": "soft", "radius": 16 }
// }

export const PACK_FORMAT = 'qijian-theme-pack'
export const PACK_VERSION = 2
export const PACKS_KEY = 'ai-home.themePacks'
export const ACTIVE_PACK_KEY = 'ai-home.themePackActive'

export const PACK_TOKEN_KEYS = [
  'accent','accentSoft','accentContrast','pageBg','surface','surfaceElevated','card','field','ink','muted','line',
  'ok','warning','danger','control','controlHover','controlBorder',
  'icon','iconMuted','iconAccent','iconOk','iconWarning','iconDanger',
  'buttonPrimary','buttonPrimaryText','buttonSecondary','buttonSecondaryText','buttonSecondaryBorder','buttonDanger','buttonDangerText',
]
const LEGACY_ICON_KEYS = ['world', 'chat', 'mcp', 'skill', 'memory', 'settings', 'assistant', 'models', 'appearance', 'workspace', 'system']
export const PACK_ICON_KEYS = [...new Set([...UI_ICON_KEYS, ...LEGACY_ICON_KEYS])]
export const PACK_BUBBLE_STYLES = ['soft', 'outlined', 'bare', 'letter', 'frame', 'glass', 'comic', 'note', 'quill', 'pixel']

const isColor = (v) => typeof v === 'string' && /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|var\()/i.test(v.trim())

const PACK_APPEARANCE = {
  button: { radius: [0, 64], stroke: ['none', 'solid', 'dashed', 'double'] },
  card: { radius: [0, 40], stroke: ['none', 'solid', 'dashed', 'double'], material: ['flat', 'paper', 'glass'], rotation: [-6, 6], decoration: ['none', 'tape', 'paper-edge', 'sticker'] },
  motion: { press: ['none', 'fade', 'compress'], duration: [0, 500] },
}

const bounded = (value, min, max) => typeof value === 'number' && Number.isFinite(value)
  ? Math.min(max, Math.max(min, value)) : undefined

function normalizeAppearance(input) {
  const appearance = {}
  for (const [section, rules] of Object.entries(PACK_APPEARANCE)) {
    const fields = {}
    for (const [field, choices] of Object.entries(rules)) {
      const value = input?.[section]?.[field]
      const normalized = typeof choices[0] === 'number'
        ? bounded(value, ...choices)
        : choices.includes(value) ? value : undefined
      if (normalized !== undefined) fields[field] = normalized
    }
    if (Object.keys(fields).length) appearance[section] = fields
  }
  return Object.keys(appearance).length ? appearance : undefined
}

const isImageAsset = (value) => typeof value === 'string' &&
  /^data:image\/(?:png|jpeg|webp|gif|svg\+xml);base64,[a-z\d+/]+=*$/i.test(value)

function normalizeBackground(background, version) {
  if (!background || typeof background !== 'object') return undefined
  const legacy = version === 1
  const image = background.image
  return {
    image: (legacy ? typeof image === 'string' && /^(https?:|data:image\/)/.test(image) : isImageAsset(image)) ? image : undefined,
    color: isColor(background.color) ? String(background.color).trim() : undefined,
    opacity: legacy
      ? (Number.isFinite(Number(background.opacity)) ? Math.min(1, Math.max(0.1, Number(background.opacity))) : undefined)
      : bounded(background.opacity, 0, 1),
  }
}

export function normalizeThemePack(input) {
  if (!input || typeof input !== 'object') throw new Error('美化包必须是 JSON 对象。')
  if (input.format && input.format !== PACK_FORMAT) throw new Error('不是栖间美化包（format 不匹配）。')
  const version = input.version ?? 1
  if (version !== 1 && version !== PACK_VERSION) throw new Error('不支持的栖间主题包版本。')
  const name = String(input.name || '').trim()
  if (!name) throw new Error('美化包缺少名字（name）。')
  const tokens = {}
  for (const key of PACK_TOKEN_KEYS) {
    const value = input.tokens?.[key]
    if (value == null) continue
    if (!isColor(value)) throw new Error(`颜色 ${key} 格式不对：${value}`)
    tokens[key] = String(value).trim()
  }
  if (!Object.keys(tokens).length) throw new Error('美化包至少要有一个颜色 token。')
  const bubble = input.bubble && typeof input.bubble === 'object' ? {
    style: PACK_BUBBLE_STYLES.includes(input.bubble.style) ? input.bubble.style : undefined,
    radius: Number.isFinite(Number(input.bubble.radius)) ? Math.min(28, Math.max(4, Number(input.bubble.radius))) : undefined,
    me: isColor(input.bubble.me) ? String(input.bubble.me).trim() : undefined,
    ai: isColor(input.bubble.ai) ? String(input.bubble.ai).trim() : undefined,
  } : undefined
  const background = normalizeBackground(input.background, version)
  const chatBackground = version === PACK_VERSION ? normalizeBackground(input.chatBackground, version) : undefined
  const appearance = version === PACK_VERSION ? normalizeAppearance(input.appearance) : undefined
  const font = input.font && typeof input.font === 'object' ? {
    family: typeof input.font.family === 'string' ? input.font.family.trim().slice(0, 60) : undefined,
    src: typeof input.font.src === 'string' && input.font.src.length < 2_000_000 &&
      (version === 1 ? /^data:font\//.test(input.font.src) : /^data:font\/(?:woff2?|ttf|otf);base64,[a-z\d+/]+=*$/i.test(input.font.src))
      ? input.font.src : undefined,
  } : undefined
  const icons = {}
  if (input.icons && typeof input.icons === 'object') {
    const allowedKeys = version === 1 ? LEGACY_ICON_KEYS : PACK_ICON_KEYS
    for (const [key, value] of Object.entries(input.icons)) {
      if (typeof value !== 'string' || !value.trim() || !allowedKeys.includes(key)) continue
      const icon = value.trim()
      if (version === PACK_VERSION) {
        if (icon.length < 400_000 && isImageAsset(icon)) icons[key] = icon
      } else if (/^data:image\//.test(icon)) {
        if (icon.length < 400_000) icons[key] = icon
      } else {
        icons[key] = icon.slice(0, 4)
      }
    }
  }
  return {
    format: PACK_FORMAT,
    version,
    id: String(input.id || 'pack-' + hash(name + JSON.stringify(tokens))),
    name,
    author: String(input.author || '').slice(0, 40),
    description: String(input.description || '').slice(0, 120),
    tokens, bubble, background,
    ...(chatBackground && { chatBackground }),
    ...(appearance && { appearance }),
    font: font && (font.family || font.src) ? font : undefined,
    icons: Object.keys(icons).length ? icons : undefined,
  }
}

function hash(text) {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0
  return Math.abs(h).toString(36)
}

export function parseThemePack(text) {
  let data
  try { data = JSON.parse(String(text || '')) } catch { throw new Error('不是合法的 JSON 文件。') }
  return normalizeThemePack(data)
}

export function loadThemePacks(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(PACKS_KEY)
    const list = raw ? JSON.parse(raw) : []
    if (!Array.isArray(list)) return []
    return list.map((p) => { try { return normalizeThemePack(p) } catch { return null } }).filter(Boolean)
  } catch { return [] }
}

export function saveThemePacks(list, storage = globalThis.localStorage) {
  const clean = (Array.isArray(list) ? list : []).map((p) => normalizeThemePack(p)).slice(0, 24)
  try { storage?.setItem(PACKS_KEY, JSON.stringify(clean)) } catch { /* 存不下就不持久化 */ }
  return clean
}

export function upsertThemePack(pack, storage = globalThis.localStorage) {
  const list = loadThemePacks(storage).filter((p) => p.id !== pack.id)
  return saveThemePacks([pack, ...list], storage)
}

export function removeThemePack(id, storage = globalThis.localStorage) {
  const list = loadThemePacks(storage).filter((p) => p.id !== id)
  if (getActivePackId(storage) === id) setActivePack('', storage)
  return saveThemePacks(list, storage)
}

export function getActivePackId(storage = globalThis.localStorage) {
  try { return storage?.getItem(ACTIVE_PACK_KEY) || '' } catch { return '' }
}

export function setActivePack(id, storage = globalThis.localStorage) {
  try { if (id) storage?.setItem(ACTIVE_PACK_KEY, id); else storage?.removeItem(ACTIVE_PACK_KEY) } catch { /* ignore */ }
}

export function packCssVars(pack) {
  if (!pack) return {}
  const vars = {}
  const map = {
    accent:'--accent', accentSoft:'--accent-soft', accentContrast:'--accent-contrast',
    pageBg:'--page-bg', surface:'--surface', surfaceElevated:'--surface-elevated', card:'--card', field:'--field',
    ink:'--ink', muted:'--muted', line:'--line', ok:'--ok', warning:'--warning', danger:'--danger',
    control:'--control-bg', controlHover:'--control-bg-hover', controlBorder:'--control-border',
    icon:'--icon', iconMuted:'--icon-muted', iconAccent:'--icon-accent', iconOk:'--icon-ok', iconWarning:'--icon-warning', iconDanger:'--icon-danger',
    buttonPrimary:'--button-primary-bg', buttonPrimaryText:'--button-primary-fg',
    buttonSecondary:'--button-secondary-bg', buttonSecondaryText:'--button-secondary-fg', buttonSecondaryBorder:'--button-secondary-border',
    buttonDanger:'--button-danger-bg', buttonDangerText:'--button-danger-fg',
  }
  for (const [key, cssVar] of Object.entries(map)) if (pack.tokens[key]) vars[cssVar] = pack.tokens[key]
  if (pack.tokens.accent) vars['--accent-ink'] = pack.tokens.accent
  if (pack.tokens.pageBg) vars['--app-bg'] = pack.tokens.pageBg
  const appBackground = pack.background
  const appPaint = backgroundPaint(appBackground)
  const chat = pack.version === PACK_VERSION ? pack.chatBackground : undefined
  const chatPaint = backgroundPaint(chat)
  if (appPaint) vars['--wallpaper'] = appPaint
  if (chatPaint || appPaint) vars['--pack-chat-bg'] = chatPaint || appPaint
  if (appBackground?.opacity !== undefined) vars['--wallpaper-opacity'] = String(appBackground.opacity)
  const chatOpacity = chat?.opacity ?? (chatPaint ? 1 : appBackground?.opacity)
  if (chatOpacity !== undefined) vars['--pack-bg-opacity'] = String(chatOpacity)
  if (pack.font?.family || pack.font?.src) {
    const family = pack.font.src ? packFontName(pack) : pack.font.family
    vars['--theme-font-family'] = family
    vars['--pack-font-family'] = family
  }
  if (pack.bubble?.me) vars['--bubble-me-bg'] = pack.bubble.me
  if (pack.bubble?.ai) vars['--bubble-ai-bg'] = pack.bubble.ai
  if (pack.version === PACK_VERSION) {
    if (pack.bubble?.radius !== undefined) vars['--pack-bubble-radius'] = pack.bubble.radius + 'px'
    for (const [section, fields] of Object.entries(pack.appearance ?? {})) {
      for (const [field, value] of Object.entries(fields)) {
        const unit = { radius: 'px', rotation: 'deg', duration: 'ms' }[field] ?? ''
        vars[`--pack-${section}-${field}`] = String(value) + unit
      }
    }
  }
  return vars
}

function backgroundPaint(background) {
  return background?.image ? `url(${background.image})` : background?.color
}

const PACK_VAR_NAMES=[
  ...Object.entries(PACK_APPEARANCE).flatMap(([section, fields]) => Object.keys(fields).map(field => `--pack-${section}-${field}`)),
  '--pack-bubble-radius',
  '--accent','--accent-soft','--accent-contrast','--accent-ink','--page-bg','--app-bg','--surface','--surface-elevated','--card','--field',
  '--ink','--muted','--line','--ok','--warning','--danger',
  '--control-bg','--control-bg-hover','--control-border',
  '--icon','--icon-muted','--icon-accent','--icon-ok','--icon-warning','--icon-danger',
  '--button-primary-bg','--button-primary-fg','--button-secondary-bg','--button-secondary-fg','--button-secondary-border','--button-danger-bg','--button-danger-fg',
  '--wallpaper','--wallpaper-opacity','--theme-font-family','--pack-chat-bg','--pack-bg-opacity','--pack-font-family','--bubble-me-bg','--bubble-ai-bg',
]
export function applyPackVars(pack){
  const root=globalThis.document?.documentElement
  if(!root)return
  for(const n of PACK_VAR_NAMES)root.style.removeProperty(n)
  applyPackFont(pack)
  const vars=packCssVars(pack)
  // React 每次渲染会把主题内联变量写回 .shell，包里的颜色必须用 important 才盖得住，
  // 否则「美化包」只改了背景、颜色仍是被选中的内置主题。
  const shellEl=globalThis.document?.querySelector('.shell')
  for(const [k,v] of Object.entries(vars)){root.style.setProperty(k,v);if(shellEl?.style)shellEl.style.setProperty(k,v,'important')}
  globalThis.document.body?.classList.toggle('has-pack',!!pack)
  if (pack?.version === 1 || (pack && pack.version === undefined)) {
    void applyDerivedPalette(pack)
  } else {
    paletteSeq++
    globalThis.document.body?.classList.remove('pack-dark')
  }
}

const FONT_STYLE_ID='qijian-pack-font'
const packFontName = (pack) => 'pack-' + hash(pack.id)
function applyPackFont(pack){
  const doc=globalThis.document
  if(!doc)return
  let el=doc.getElementById(FONT_STYLE_ID)
  if(pack?.font?.src){
    if(!el){el=doc.createElement('style');el.id=FONT_STYLE_ID;doc.head.appendChild(el)}
    el.textContent='@font-face{font-family:'+packFontName(pack)+';src:url('+pack.font.src+');font-display:swap}'
  }else if(el){el.remove()}
}

// ── ZIP 美化包：pack.json + 同目录资源（图片 / 字体）──
const MIME_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf' }
function mimeOf(name) { const ext = String(name).split('.').pop()?.toLowerCase() || ''; return MIME_BY_EXT[ext] || 'application/octet-stream' }

export async function packFromZip(buffer) {
  const files = await readZip(buffer)
  const names = [...files.keys()]
  const jsonName = names.find((n) => /(^|\/)pack\.json$/i.test(n)) || names.find((n) => /\.json$/i.test(n))
  if (!jsonName) throw new Error('ZIP 里缺少 pack.json。')
  const base = jsonName.includes('/') ? jsonName.slice(0, jsonName.lastIndexOf('/') + 1) : ''
  let raw
  try { raw = JSON.parse(new TextDecoder().decode(files.get(jsonName))) } catch { throw new Error('pack.json 不是合法 JSON。') }
  const resolve = (ref) => {
    if (typeof ref !== 'string' || !ref || /^(data:|https?:)/i.test(ref)) return ref
    const bytes = files.get(base + ref) || files.get(ref)
    if (bytes) return bytesToDataUrl(bytes, mimeOf(ref))
    if (raw?.version === PACK_VERSION) throw new Error('ZIP 里缺少主题素材：' + ref)
    return ref
  }
  for (const background of [raw?.background, raw?.chatBackground]) {
    if (background && typeof background === 'object') background.image = resolve(background.image)
  }
  if (raw?.icons && typeof raw.icons === 'object') for (const key of Object.keys(raw.icons)) raw.icons[key] = resolve(raw.icons[key])
  if (raw?.font && typeof raw.font === 'object') raw.font.src = resolve(raw.font.src)
  return normalizeThemePack(raw)
}

// ── 从背景取色：手机主题那种「跟着壁纸走」的配色 ─────────────────────
// 背景是纯色就直接转 HSL；是图片就缩到 24×24 取平均色。再按明暗推导一整套 token。
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
    else if (max === g) h = ((b - r) / d + 2) / 6
    else h = ((r - g) / d + 4) / 6
  }
  return [h * 360, s, l]
}

const clamp = (v, min, max) => Math.min(max, Math.max(min, v))
const hsl = (h, s, l) => 'hsl(' + Math.round(h) + ' ' + Math.round(clamp(s, 0, 1) * 100) + '% ' + Math.round(clamp(l, 0, 1) * 100) + '%)'

export function paletteFromRgb(r, g, b) {
  const [h, s, l] = rgbToHsl(r, g, b)
  if (l < 0.48) {
    return {
      mode: 'dark',
      '--accent': hsl(h, s * 1.1 + 0.18, 0.62),
      '--accent-soft': hsl(h, 0.32, 0.26),
      '--accent-contrast': hsl(h, 0.12, 0.12),
      '--page-bg': hsl(h, 0.14, 0.10),
      '--app-bg': hsl(h, 0.14, 0.10),
      '--surface': hsl(h, 0.16, 0.14),
      '--surface-elevated': hsl(h, 0.16, 0.18),
      '--card': hsl(h, 0.15, 0.16),
      '--field': hsl(h, 0.14, 0.2),
      '--ink': hsl(h, 0.1, 0.93),
      '--muted': hsl(h, 0.08, 0.68),
      '--line': hsl(h, 0.12, 0.34),
    }
  }
  return {
    mode: 'light',
    '--accent': hsl(h, s * 1.1 + 0.18, 0.4),
    '--accent-soft': hsl(h, s * 0.8, 0.9),
    '--accent-contrast': '#ffffff',
    '--page-bg': hsl(h, s * 0.22, 0.94),
    '--app-bg': hsl(h, s * 0.22, 0.94),
    '--surface': hsl(h, s * 0.35, 0.97),
    '--surface-elevated': hsl(h, s * 0.28, 0.99),
    '--card': hsl(h, s * 0.28, 0.96),
    '--field': hsl(h, s * 0.3, 0.93),
    '--ink': hsl(h, s * 0.25, 0.2),
    '--muted': hsl(h, s * 0.18, 0.45),
    '--line': hsl(h, s * 0.3, 0.8),
  }
}

function colorToRgb(color) {
  const doc = globalThis.document
  if (!doc) return null
  const probe = doc.createElement('div')
  probe.style.color = color
  doc.body.appendChild(probe)
  const computed = getComputedStyle(probe).color
  probe.remove()
  const m = computed.match(/\d+/g)
  return m ? [+m[0], +m[1], +m[2]] : null
}

async function imageAverageRgb(src) {
  const doc = globalThis.document
  if (!doc || typeof Image === 'undefined') return null
  try {
    const img = new Image()
    img.src = src
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject })
    const canvas = doc.createElement('canvas')
    canvas.width = 24; canvas.height = 24
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0, 24, 24)
    const { data } = ctx.getImageData(0, 0, 24, 24)
    let r = 0, g = 0, b = 0, n = 0
    for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++ }
    return n ? [r / n, g / n, b / n] : null
  } catch { return null } // 跨域图片会画不进去，退回包里的 token
}

let paletteSeq = 0
export async function applyDerivedPalette(pack) {
  const seq = ++paletteSeq
  const bg = pack?.background
  if (!bg) return null
  let rgb = null
  if (bg.color) rgb = colorToRgb(bg.color)
  else if (bg.image) rgb = await imageAverageRgb(bg.image)
  if (!rgb || seq !== paletteSeq) return null
  const palette = paletteFromRgb(rgb[0], rgb[1], rgb[2])
  const root = globalThis.document?.documentElement
  if (!root) return null
  const shell = globalThis.document.querySelector('.shell')
  for (const [k, v] of Object.entries(palette)) if (k !== 'mode') {
    root.style.setProperty(k, v)
    // React 每次渲染都会把主题变量以内联样式写回 .shell，这里用 important 优先级盖住它。
    if (shell && shell.style) shell.style.setProperty(k, v, 'important')
  }
  globalThis.document.body?.classList.toggle('pack-dark', palette.mode === 'dark')
  return palette
}
