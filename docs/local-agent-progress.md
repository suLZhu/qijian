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
