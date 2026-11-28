// Tool registry: built-in tools (memory / worldbook / ledger) plus every
// enabled MCP connection bound to the calling assistant.
//
// Two safety rules live here:
//  1. Tools that act "as the assistant" get their identity injected server-side;
//     whatever the model put in `person` is overwritten before execution.
//  2. MCP tool names are namespaced per connection so two servers exposing the
//     same tool name can never shadow each other.
import { searchMemoryIndex } from '../../memoryIndex.mjs'
import { SQLiteMemoryProvider } from './MemoryStore.mjs'

const sanitize = (text, max = 40) => String(text || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, max)

function def(name, description, properties, required) {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required: required || [] } } }
}

// Built-in tool table. `run` receives (db, person, args) — person is always
// the server-verified assistant id, never a model-supplied value.
const BUILTINS = [
  {
    name: 'proactive_plan_update', source: 'proactive', readOnly: false, proactiveOnly: true,
    definition: def('proactive_plan_update', '更新你自己在自主生活里的简短行动计划和待办。不能创建定时任务、修改权限、预算或免打扰。', {
      note: { type: 'string', description: '下一步想检查的事或待办，最多 600 字；可留空表示无待办' },
    }, ['note']),
    run(db, person, args) {
      const note = String(args.note ?? '').trim()
      if (note.length > 600) throw Object.assign(new Error('计划内容超过 600 字'), { status: 400 })
      const row = db.prepare('UPDATE proactive_settings SET plan_note=?,plan_updated_at=? WHERE person=? AND enabled=1 AND allow_chat=1')
        .run(note,new Date().toISOString(),person)
      if (!row.changes) throw Object.assign(new Error('自主生活未授权'), { status: 403 })
      return { ok: true, note }
    },
  },
  {
    name: 'memory_search',
    source: 'worldbook',
    readOnly: true,
    definition: def('memory_search', '搜索当前助手的长期记忆库（已确认生效的记忆条目）与历史会话原文。', {
      query: { type: 'string', description: '搜索关键词，2 至 160 字' },
    }, ['query']),
    run(db, person, args, context) {
      const query = String(args.query || '').trim()
      if (query.length < 2 || query.length > 160) throw Object.assign(new Error('搜索内容长度应为 2 至 160 字'), { status: 400 })
      // Governed memories first (only lifecycle=active; the Recall Ledger
      // suppresses anything injected into this conversation recently), then
      // original conversation excerpts as fallback context.
      const records = SQLiteMemoryProvider(db).search({
        person, query, limit: 5,
        conversationId: context?.conversationId || '',
        runId: context?.runId || null,
      })
      const excerpts = searchMemoryIndex(db, { person, query, limit: 5 })
      return { records, excerpts }
    },
  },
  {
    name: 'memory_add',
    source: 'worldbook',
    readOnly: false,
    definition: def('memory_add', '提议一条新的长期记忆（写操作）。仅当对话中出现了值得长期记住的新事实、约定或偏好时调用；提议会进入候选区，用户确认后才生效。', {
      title: { type: 'string', description: '记忆标题，2 至 120 字' },
      content: { type: 'string', description: '记忆内容，1 至 4000 字；写清事实本身，不要写你的感想' },
      keywords: { type: 'string', description: '召回关键词，逗号分隔，可选' },
      category: { type: 'string', description: '分类：人物关系/经历事件/偏好习惯/项目进度/其他' },
      scope: { type: 'string', enum: ['world', 'private', 'ops'], description: 'world=世界观事实 private=与用户的私密记忆 ops=运行与协作事务' },
    }, ['title', 'content']),
    run(db, person, args, context) {
      const { record, duplicate } = SQLiteMemoryProvider(db).propose({
        person,
        title: String(args.title || ''),
        content: String(args.content || ''),
        keywords: String(args.keywords || ''),
        category: String(args.category || '其他'),
        scope: String(args.scope || 'private'),
        // Provenance comes from the server-side run, never from the model.
        sourceConversationId: context?.conversationId || '',
        sourceRunId: context?.runId || '',
        createdBy: 'model',
      })
      return { ok: true, id: record.id, lifecycle: record.lifecycle, duplicate,
        message: duplicate ? '相同内容的记忆已存在，未重复创建。' : '已加入候选记忆，等待用户确认后生效。' }
    },
  },
  {
    name: 'worldbook_search',
    source: 'worldbook',
    readOnly: true,
    definition: def('worldbook_search', '搜索当前助手已启用且绑定到自己的世界书条目。', {
      query: { type: 'string', description: '关键词，匹配标题或正文' },
    }, ['query']),
    run(db, person, args) {
      const query = String(args.query || '').trim().toLowerCase()
      if (!query) throw Object.assign(new Error('缺少关键词'), { status: 400 })
      const row = db.prepare('SELECT payload FROM app_state WHERE id=1').get()
      let entries = []
      try { entries = JSON.parse(row?.payload || '{}').worldEntries || [] } catch { entries = [] }
      const hits = entries
        .filter(e => e && e.enabled !== false && Array.isArray(e.boundCharacters) && e.boundCharacters.includes(person))
        .filter(e => [e.title, e.content, e.keywords].some(v => String(v || '').toLowerCase().includes(query)))
        .slice(0, 5)
        .map(e => ({ id: e.id, title: e.title, content: String(e.content || '').slice(0, 800) }))
      return { results: hits }
    },
  },
]

// Registry for one run. `mcpList(row)` and `mcpCall(row, tool, args)` are
// injected by server.mjs so the MCP transport stays in one place.
export async function createToolRegistry({ db, person, mcpList, mcpCall, allowedTools = null }) {
  const allowed = allowedTools == null ? null : new Set(allowedTools)
  const definitions = BUILTINS.filter(b => allowed ? allowed.has(b.name) : !b.proactiveOnly).map(b => b.definition)
  const mcpMap = new Map()
  const connections = allowed ? [] : db.prepare(`
    SELECT c.* FROM mcp_connections c
    INNER JOIN mcp_bindings b ON b.connection_id=c.id
    WHERE b.person=? AND c.enabled=1
    ORDER BY c.updated_at DESC
  `).all(person)

  for (const row of connections) {
    let listed
    try { listed = await mcpList(row) } catch { continue } // one dead server never blocks a run
    for (const tool of listed || []) {
      if (!tool || !tool.name) continue
      const name = sanitize(`mcp_${String(row.id).slice(0, 8)}_${tool.name}`, 64)
      if (mcpMap.has(name) || BUILTINS.some(b => b.name === name)) continue
      mcpMap.set(name, { row, originalName: String(tool.name), serverName: row.name })
      definitions.push({
        type: 'function',
        function: {
          name,
          description: `[MCP:${row.name}] ${String(tool.description || '')}`.slice(0, 500),
          parameters: tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : { type: 'object', properties: {} },
        },
      })
    }
  }

  const describe = (name) => {
    if (allowed && !allowed.has(name)) return null
    const builtin = BUILTINS.find(b => b.name === name)
    if (builtin?.proactiveOnly && !allowed) return null
    if (builtin) return { source: builtin.source, serverName: '', readOnly: builtin.readOnly }
    const mapped = mcpMap.get(name)
    if (!mapped) return null
    return { source: 'mcp', serverName: mapped.serverName, readOnly: false }
  }

  return {
    person,
    definitions,
    mcpTools: [...mcpMap.keys()],
    // Metadata without executing; null means unknown tool.
    describe,
    // Returns { source, serverName, readOnly, data }; throws on failure.
    // `context` (runId / conversationId) lets read tools feed the Recall
    // Ledger without trusting any model-supplied identity.
    async invoke(name, args, context) {
      const meta = describe(name)
      if (!meta) throw Object.assign(new Error('未知工具：' + name), { status: 400 })
      const builtin = BUILTINS.find(b => b.name === name)
      if (builtin) return { ...meta, data: builtin.run(db, person, args, context) }
      const mapped = mcpMap.get(name)
      const data = await mcpCall(mapped.row, mapped.originalName, args)
      return { ...meta, data }
    },
  }
}
