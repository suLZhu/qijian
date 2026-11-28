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
