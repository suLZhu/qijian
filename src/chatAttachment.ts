import { apiFetch } from './apiBase.mjs'
import { extractDocumentText, MAX_DOCUMENT_BYTES } from './documentText'

export async function readChatAttachment(file: File) {
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error('单个文件不能超过 12 MB')
  const metadata = { name: file.name, type: file.type || 'application/octet-stream', size: file.size }
  if (!file.type.startsWith('image/')) {
    return { ...metadata, textContent: (await extractDocumentText(file)).text }
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
  try {
    const response = await apiFetch('/api/attachments', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: file.name, mime: file.type, data: dataUrl.slice(dataUrl.indexOf(',') + 1) }),
    })
    if (response.ok) {
      const saved = await response.json()
      if (saved.id && saved.url) return { ...metadata, dataUrl, preview: String(saved.url), assetId: String(saved.id) }
    }
  } catch { /* The current draft still has the image bytes. */ }
  return { ...metadata, dataUrl, preview: URL.createObjectURL(file) }
}
