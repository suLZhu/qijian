export function authorizeChatTool(options: {
  person: string; tool: string; signal?: AbortSignal
  fetchPolicy: (path: string, init: RequestInit) => Promise<Response>
  confirm: (tool: string) => Promise<boolean>
}): Promise<void>
