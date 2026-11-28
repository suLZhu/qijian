# 本地 Agent 开发记录

## 听觉上传测试（提交 4540ef7）

- 修改：package.json、tests/hearing-native-upload.test.mjs；AndroidManifest.xml 的音频权限补充仍在听觉工作区，尚未提交。
- 实现：测试原生二进制上传字节、请求头、直连策略，以及旧桥拒绝上传。
- 删除：无。
- 验证：新增两项测试通过；当时全量 545 项和 Web 构建通过。
- 未解决：Android 编译、真机录音、真实接口及听觉协议验收；服务器当前 PATH 未发现 java。

## 共享自主唤醒判断

- 修改：src/proactive.mjs、src/proactiveRules.mjs、tests/proactive-rules.test.mjs、package.json。
- 实现：服务端复用可在浏览器运行的唤醒判断；覆盖时区、免打扰、每日次数、未知用量、token 警戒、忙碌、待处理和间隔；保留超过 48 小时的上次事件以判断长间隔。
- 删除：服务端原有重复的免打扰与唤醒判断逻辑，未删除用户数据。
- 验证：全量 548 项通过；Web 生产构建与 TypeScript 检查通过，存在大 chunk 警告。
- 未解决：共享规则尚未接入本地调度器；本地执行器、执行事件与取消、统一模型执行、定时工作流和听觉哨兵均未完成。当前不具备进程回收后执行 AI 的能力。

## 本地运行记录基础设施

- 修改：src/localAgentRuns.mjs、src/localAgentRuns.d.mts、src/localBackend.mjs、src/agentRuns.ts、tests/local-agent-runs.test.mjs、package.json。
- 实现：本地运行持久化、按助手查询、结果与实际用量保存、运行事件分发、取消信号、失败记录；没有注册执行器时明确拒绝启动，不假装任务成功。
- 删除：本地 Agent 运行接口原有始终空列表的占位分支；事件流 SSE 占位暂保留，前端本地订阅改用进程内事件。
- 验证：全量 551 项通过；Web 构建与类型检查通过，仍有大 chunk 警告。新增测试使用受控模拟执行器，不代表真实模型已接通。
- 未解决：应用尚未注册真实模型执行器，用户还不能实际启动本地 Agent；进程回收后的状态恢复、实际工具策略、真实模型用量、后台生命周期均未完成，取消仅发送信号并等待执行器结束。

## 底层审计及事件流清理

- 修改：src/localBackend.mjs、tests/local-agent-runs.test.mjs。
- 实现：本地 Agent SSE 不再只发心跳，改为订阅与看板相同的运行事件；关闭时取消订阅和心跳。
- 删除：已无引用的 Agent 降级常量、仅心跳的事件流实现；修正过期的本地 MCP 注释。
- 验证：全量 552 项通过，生产构建与 TypeScript 检查通过；新增事件流测试使用模拟执行器，仍有大 chunk 警告。
- 审计发现：1）App 聊天 send 与 localBackend 的 runLocalConversationTask 各有一条执行入口；后者已有受限模型聊天生成，而非单纯提醒，但没有主聊天的完整工具和记忆能力，也未看到将模型用量写入账本。2）工具策略在服务端 Agent 的 ToolExecutor 中执行；普通聊天工具分支未发现读取同一套策略，统一前必须确认并补齐。3）localAgentRuns 只有测试注册了执行器，真实 App 未注册，不能实际运行；进程中断恢复未完成。4）本地 proactive 唤醒仍降级，前述共享规则尚未接入。5）听觉改动未提交，协议、真机、实际接口和资源释放尚待验收。6）旧数据迁移和历史摘要兼容仍存在，未经迁移验证不得直接删除，避免丢失用户数据。

## 聊天工具权限

- 修改：src/App.tsx、src/chatToolPolicy.mjs、src/chatToolPolicy.d.mts、tests/chat-tool-policy.test.mjs、package.json。
- 实现：每次聊天工具调用前读取当前助手策略；deny 拒绝、ask 需确认并在确认后重查策略，读取错误不放行，确认后取消不会执行。MCP 按工具记录名匹配策略。
- 删除：无；保留服务端 Agent 的原审批流程，本次只修复聊天路径未检查策略的问题。
- 验证：555 项测试通过；Web 构建及类型检查通过，仍有大 chunk 警告。
- 未解决：真实 App 上的确认对话和完整模型工具调用尚未端到端验证；本地 Agent 的真实模型执行链和自主调度尚未接入。

## 手动本地 Agent 模型入口

- 修改：src/App.tsx、src/UsageStats.tsx、src/localAgentRuns.mjs、src/localAgentRuns.d.mts、tests/local-agent-runs.test.mjs。
- 实现：App 注册手动 Agent 执行器并复用聊天 send 的模型、上下文和工具调用；不写入聊天气泡、不清草稿；关联 runId 和取消信号；成功运行中供应商返回的用量按助手并入现有账本；停止截断旧运行记录。
- 删除：本地 Agent 自动删除旧运行记录的逻辑。
- 验证：全量 557 项测试及 Web 构建、TypeScript 检查通过，仍有大 chunk 警告；账本和运行状态测试使用模拟执行器。
- 未解决：真实模型端到端调用尚未验证；失败或取消时已消耗用量未完整归账；进程回收后运行状态恢复尚未接入；自主唤醒、定时工作流和听觉哨兵仍未整合。不得将原生前台服务视为进程回收后仍能执行。

## Agent 部分用量记录

- 修改：src/App.tsx、src/UsageStats.tsx、src/localAgentRuns.mjs、src/localAgentRuns.d.mts、tests/local-agent-runs.test.mjs。
- 实现：模型流返回用量时即时保存到对应运行；失败和取消的运行保留已报告用量，账本可读取；未返回的用量不估算。
- 删除：无。
- 验证：558 项测试及 Web 构建、类型检查通过；使用模拟流和执行器，未验证真实供应商请求，仍有大 chunk 警告。
- 未解决：供应商未返回用量或存储写入失败时无法统计；运行恢复、自主唤醒、定时工作流、听觉哨兵和全局审计尚未完成。

## Android 本地运行中断状态恢复

- 修改：src/App.tsx、src/localAgentRuns.mjs、src/localAgentRuns.d.mts、tests/local-agent-runs.test.mjs。
- 实现：Android 主 WebView 启动时将没有当前执行主体的运行标为中断失败，保留用量和部分结果，不自动重试；当前进程中仍在执行的任务不受影响。
- 删除：无。
- 验证：全量 559 项通过，追加恢复保护专项测试 9 项通过；Web 构建及类型检查通过，仍有大 chunk 警告。
- 未解决：浏览器多标签页不自动恢复；Android 实机重启验证、恢复失败时的显式提示、自主生活和定时任务统一调度仍未完成。

## 自主唤醒共用提示与结果判断

- 修改：src/proactivePrompt.mjs、src/server/agent/ProactiveHeat.mjs、tests/proactive-rules.test.mjs。
- 实现：把服务端自主触发提示和沉默/错误结果判断抽成可在本地使用的共用模块，服务端已切换调用。
- 删除：服务端文件中原有的重复提示和判断实现。
- 验证：全量 561 项通过，包含既有服务端 Agent 验收；尚未接入本地调度，不代表本地自主唤醒可用。
- 未解决：本地启动、记忆与工具权限、状态/结果交付、频率限制及实际模型验证均未完成。

## 本地自主唤醒闭环（前台）

- 修改：src/App.tsx、src/localBackend.mjs、src/localAgentRuns.mjs、src/localAgentRuns.d.mts、tests/local-proactive.test.mjs、package.json。
- 实现：前台及回前台检查自主唤醒；共用免打扰、间隔、次数、用量和忙碌判断；复用聊天 Agent 执行器，不插用户气泡或清空草稿；未授权记忆时不检索长期记忆，自主运行不开放工具；结果经幂等收件箱进入绑定会话；权限撤销、沉默和失败不投递。
- 删除：本地自主唤醒固定降级分支。
- 验证：全量 566 项通过，包含模拟模型驱动的唤醒、静默、权限撤销、忙碌、免打扰、限额、会话隔离与来源保护；Web 构建及类型检查通过，仍有大 chunk 警告。
- 未解决：真实模型与界面端到端和 Android 实机未验证；App 进程被回收时不执行自主模型请求；自主计划更新工具未开放，定时任务和听觉哨兵尚未整合。
