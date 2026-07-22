# 移动端通宵执行边界（Gate 0B）

> **本文件是本次通宵自主执行的最高优先级边界。若与其他移动端计划冲突，以本文件的更保守限制为准。**

## 1. 时间边界

- 开始参考时间：**2026-07-22 03:38（UTC+8）**
- 停止新增工作：**2026-07-22 07:45（UTC+8）**
- 硬停止：**2026-07-22 08:00（UTC+8）**
- 每进入一个新阶段前必须检查本机时间。
- 07:45 后只允许：停止临时进程、验证文件、更新进度、写最终摘要。
- 08:00 到达后，无论完成度如何都必须停止工具调用并保存状态；不得以“只差一点”为由延期。
- 所有可能长时间运行的命令必须设置 timeout，且不能超过距 07:45 的剩余时间。

## 2. 本次唯一目标

完成 **Gate 0B 的安全部分：pi-web 协议画像、只读容量测量、脱敏 fixture/契约草案和后续实测清单**。

本次不是完整 Gate 0B 验收；凡需要修改真实 session、发送真实 prompt、切换真实模型或中止真实 agent 的测试全部延期并明确记录。

## 3. 允许范围

### 允许读取

- `D:/PI-web-desktop/` 内代码、文档、锁定的 `resources/pi-web/` 构建产物。
- `~/.pi/agent/` **只读**：仅统计 session 文件数量/大小/时间，不复制正文、不输出消息内容、不输出密钥。
- 当前系统进程、监听端口、网络代理配置：只读检测。

### 允许写入

仅允许写入：

- `D:/PI-web-desktop/mobile/`
- `D:/PI-web-desktop/.test/mobile-gate0b/`（临时测试；结束前清理进程，文件可保留供复核）
- `D:/PI-web-desktop/.backup/`（修改既有文件前备份）

### 允许创建的产物

建议目录：`mobile/gate0b/`

1. `protocol-inventory.md`：接口、method、请求体、响应字段、错误状态、证据来源和置信度。
2. `capacity-report.md`：session数量/文件大小分布、代表性API响应大小、解析时间和内存；不得包含正文。
3. `fixtures/`：完全脱敏或人工合成的 JSON/SSE fixture。
4. `read-only-probe.mjs`：只读 GET/HEAD 探针；必须拒绝 POST/PATCH/DELETE。
5. `fixture-check.mjs`：离线验证 fixture/schema；不得调用外部模型。
6. `deferred-live-tests.md`：prompt/abort/set_model/new-session 等需写真实session的延期项。
7. 更新 `mobile/findings.md`、`progress.md`、`task_plan.md`。

## 4. 绝对禁止

- **禁止修改、创建或删除 `~/.pi/agent/` 下任何文件。**
- 禁止调用会改变状态的 pi-web API：`POST/PATCH/PUT/DELETE`，包括 `agent/new`、`prompt`、`abort`、`set_model`、重命名和删除 session。
- 禁止向任何真实 session 发送消息；禁止调用外部模型产生费用。
- 禁止停止、重启、强杀当前正在承载用户会话的 Electron/pi-web。
- 禁止修改 `resources/pi-web/`。
- 禁止进入 Stage 1：不改 `src/main.ts`、`src/pi-web-runtime.ts`、`src/preload.ts`，不实现 MobileBridge/PWA主体。
- 禁止安装 cloudflared/frpc、修改DNS、域名、Cloudflare、DigitalPlat或网络账户。
- 禁止 `npm install -g`、管理员权限、注册表、系统环境变量、系统文件修改。
- 禁止把 session正文、API key、Cookie、Token、代理凭据写入文档/fixture/log。
- 禁止 git push；本次默认不 commit。
- 禁止删除项目外任何文件；禁止破坏性命令。

## 5. 执行阶段

### A. 恢复与安全检查（约 15 分钟）

- 读取：`mobile/MOBILE_PLAN.md`、`task_plan.md`、`findings.md`、`progress.md`、本文件。
- 检查本机时间、磁盘空间（<5GB立即停止）、git状态。
- 识别当前桌面/pi-web进程和端口，但不停止、不重启。

### B. 协议静态画像（约 45–60 分钟）

- 从锁定 pi-web 前端调用点和 API route bundle 提取 sessions/history/state/models/agent/events 的method、body和响应字段。
- 每项标注：`source-confirmed` / `live-read-only-observed` / `unverified-mutation`。
- 不把猜测写成已验证事实。

### C. 只读实时探针（约 30–45 分钟）

- 只有在不重启当前应用、能可靠发现现有 pi-web URL 时才执行。
- 仅 GET/HEAD：health/home/sessions/history/state/models；不得连接或干扰用户当前运行中的 session SSE。
- 如果无法安全发现URL，跳过live probe并改做bundle/static验证，不得重启桌面端。

### D. 容量与历史预算（约 45–60 分钟）

- 只读统计 `~/.pi/agent/` session文件大小分布：数量、p50/p90/p95/max、最近更新时间。
- 不读取/输出正文；如需API响应，只记录字节数、耗时和RSS变化。
- 根据数据评估8MiB初始历史上限是否合理；不得擅自承诺完整分页。

### E. 脱敏fixture和契约草案（约 45–60 分钟）

- fixture必须人工合成或彻底脱敏；不复制真实消息。
- 为未来BFF定义最小 DTO/schema 和稳定错误码草案。
- 构造SSE connected/delta/end/error/heartbeat的合成样例；明确上游无replay cursor时仅最终一致。

### F. 审查、验证与收尾（最晚07:45开始）

- `node --check`/离线运行所建脚本；确认只读probe代码层面拒绝非GET/HEAD。
- 搜索产物中的敏感路径、Token/API key/真实正文；发现立即删除/脱敏。
- 停止本次启动的所有临时进程，确认临时端口释放；不得触碰原有进程。
- 更新移动端计划文件，明确完成项、未验证项和下一步。
- 写最终摘要后停止。

## 6. 预期完成标准

到08:00前至少完成：

- [ ] 锁定版本协议清单（区分已验证/未验证）
- [ ] 只读session容量报告（无正文）
- [ ] 合成/脱敏fixture及离线检查
- [ ] mutation延期清单
- [ ] 进度与发现记录
- [ ] 所有临时进程已停止、无新增监听残留

若时间不足，优先级：安全清理 > 进度保存 > 协议清单 > 容量报告 > fixture。

## 7. 必须立即停止的情况

- 需要修改真实session或`~/.pi/agent/`才能继续。
- 需要重启/终止当前Electron/pi-web。
- 发现任何敏感信息将被写入产物且无法可靠脱敏。
- 磁盘剩余空间 <5GB。
- 需要管理员权限或系统级安装。
- 连续3次同类失败。
- 当前时间达到07:45（停止新增工作）或08:00（硬停止）。

## 8. 通宵结束时的报告格式

1. 完成了什么（文件路径）
2. 运行了哪些验证命令及结果
3. 哪些Gate 0B项目仍未验证，为什么
4. 是否启动过临时进程、是否已清理
5. 是否发现需要用户决策的问题
6. 下一步只写一项
