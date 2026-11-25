const TEXT_EXT_RE = /\.(txt|md|markdown|json|csv|log|xml|yaml|yml)$/i
const PDF_EXT_RE = /\.pdf$/i
const DOCX_EXT_RE = /\.docx$/i
const XLSX_EXT_RE = /\.(xlsx|xls)$/i

export const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024
export const MAX_DOCUMENT_TEXT_CHARS = 120_000

function extension(name: string) {
  const match = String(name || '').toLowerCase().match(/\.[^.]+$/)
  return match ? match[0] : ''
}

export function supportedDocumentName(name: string) {
  return TEXT_EXT_RE.test(name) || PDF_EXT_RE.test(name) || DOCX_EXT_RE.test(name) || XLSX_EXT_RE.test(name)
}

function normalizeExtractedText(value: string) {
  const text = String(value || '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim()
  if (!text) throw new Error('没有提取到可读文字')
  if (text.length <= MAX_DOCUMENT_TEXT_CHARS) return { text, truncated: false }
  return {
    text: text.slice(0, MAX_DOCUMENT_TEXT_CHARS) + '\n\n【文档内容过长，已截取前 ' + MAX_DOCUMENT_TEXT_CHARS.toLocaleString() + ' 个字符】',
    truncated: true,
  }
}

async function extractPdf(file: File) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const worker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const bytes = new Uint8Array(await file.arrayBuffer())
  const doc = await pdfjs.getDocument({ data: bytes, disableFontFace: true, useWorkerFetch: false }).promise
  const pages: string[] = []
  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber)
      const content = await page.getTextContent()
      const line = content.items
        .map(item => ('str' in item ? String(item.str || '') : ''))
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (line) pages.push('【第 ' + pageNumber + ' 页】\n' + line)
    }
  } finally {
    const cleanup = doc as unknown as { destroy?: () => Promise<void> | void }
    if (cleanup.destroy) await cleanup.destroy()
  }
  return pages.join('\n\n')
}

async function extractDocx(file: File) {
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
  return result.value
}

async function extractWorkbook(file: File) {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  const sheets: string[] = []
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false }).trim()
    if (csv) sheets.push('【工作表：' + sheetName + '】\n' + csv)
  }
  return sheets.join('\n\n')
}

export async function extractDocumentText(file: File) {
  if (!supportedDocumentName(file.name)) throw new Error('暂不支持此文件格式：' + (extension(file.name) || file.type || '未知格式'))
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error('文档不能超过 12 MB')
  let raw = ''
  if (TEXT_EXT_RE.test(file.name)) raw = await file.text()
  else if (PDF_EXT_RE.test(file.name)) raw = await extractPdf(file)
  else if (DOCX_EXT_RE.test(file.name)) raw = await extractDocx(file)
  else if (XLSX_EXT_RE.test(file.name)) raw = await extractWorkbook(file)
  return normalizeExtractedText(raw)
}
