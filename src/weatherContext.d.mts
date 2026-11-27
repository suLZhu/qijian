export function readWeatherContext(city: string, options?: { fetchImpl?: typeof fetch; signal?: AbortSignal }): Promise<string>
