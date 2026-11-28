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
