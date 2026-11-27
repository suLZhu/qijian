// The location is explicitly selected by the user. No location permissions are needed.
export async function readWeatherContext(city, { fetchImpl = fetch, signal } = {}) {
  const get = async (base, params) => {
    const url = new URL(base)
    url.search = new URLSearchParams(params).toString()
    const response = await fetchImpl(url, { signal, redirect: 'error' })
    if (!response.ok) throw new Error('天气服务暂不可用')
    return response.json()
  }
  const places = await get('https://geocoding-api.open-meteo.com/v1/search', { name: city, count: '10', language: 'zh' })
  const place = places.results?.find(row => typeof row.name === 'string' && [row.name, row.name + ' ' + row.country].some(name => name.toLowerCase() === city.toLowerCase()))
    || (places.results?.length === 1 ? places.results[0] : null)
  if (!place || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) throw new Error('未找到城市，请检查名称')
  const { current } = await get('https://api.open-meteo.com/v1/forecast', {
    latitude: place.latitude, longitude: place.longitude, current: 'temperature_2m,precipitation', timezone: 'auto',
  })
  if (!Number.isFinite(current?.temperature_2m) || !Number.isFinite(current?.precipitation)) throw new Error('天气服务未返回实况')
  const name = [place.name, place.admin1, place.country].filter(Boolean).filter((v, i, all) => all.indexOf(v) === i).join('，')
  return '【天气实况（Open-Meteo）】' + name + '，气温 ' + current.temperature_2m + ' °C，降水 ' + current.precipitation + ' mm。仅用于用户选定地点；时间和地点无关时无需播报。'
}
