import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
const map = JSON.parse(readFileSync('scripts/ui-icon-map.json', 'utf8'))
const renderer = readFileSync('src/icons.tsx', 'utf8')
test('统一图标渲染器与位图资源一一对应', () => {
  const names = [...renderer.matchAll(/<IconImage name="([^"]+)"/g)].map(m => m[1])
  assert.deepEqual([...new Set(names)].sort(), Object.keys(map).sort())
  for (const name of names) {
    const png = readFileSync('public/ui-icons/' + name + '.png')
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    assert.equal(png.readUInt32BE(16), 96)
    assert.equal(png.readUInt32BE(20), 96)
  }
  assert.ok(!existsSync('public/msg-icons'))
})
