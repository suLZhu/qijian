import test from 'node:test'
import assert from 'node:assert/strict'
import { readWeatherContext } from '../src/weatherContext.mjs'

test('天气只查询指定城市，保留零度和无降水', async () => {
  const text = await readWeatherContext('东京', { fetchImpl: async url => {
    if (url.pathname.endsWith('search')) {
      assert.equal(url.searchParams.get('name'), '东京')
      return Response.json({ results: [{ name: '东京', country: '日本', latitude: 35, longitude: 139 }] })
    }
    assert.equal(url.searchParams.get('latitude'), '35')
    return Response.json({ current: { temperature_2m: 0, precipitation: 0 } })
  } })
  assert.match(text, /东京，日本，气温 0 °C，降水 0 mm/)
})
