# task_plan.md

> 权威计划见 PROJECT_PLAN.md。本文件仅为任务清单快照。

## 阶段

- [ ] 阶段 0：技术验证与工程骨架
- [ ] 阶段 1：桌面最小可用版
- [ ] 阶段 2：外部附件
- [ ] 阶段 3：打包与发布

## 今晚任务范围（定时任务）

1. 统一所有计划与连续性文档（以 PROJECT_PLAN.md 为准）
2. 建 Electron 骨架，将全局 pi-web 复制到 resources/pi-web/ 锁定
3. 用系统 node.exe 启动 pi-web，HTTP 2xx 就绪检查（30 秒超时）
4. 实现退出时 taskkill /T /F /PID 清理进程树，验证端口释放
5. 冒烟验证：启动、退出、端口释放三项
6. **完成上述后停止，不进入阶段 1/2/3**

## 当前任务：资源管理器右键切换项目（进行中）

1. [x] 复现并核对右键命令、第二实例参数和调试日志
2. [x] 定位重复消费、错误 URL 刷新和 argv 重排问题
3. [x] 明确 pi-web 全局 cwd 与当前会话 cwd 的切换语义
4. [x] 统一为单一、串行、可去重的项目切换流程
5. [x] 修复 runtime 停止/启动竞态并编译验证
6. [x] 在不终止当前交互会话的前提下提供人工冒烟步骤

## 当前下一步

代码与独立隐藏 Electron 冒烟已完成；用户重启当前桌面端后执行真实 Explorer 右键验收。

## 当前任务：移动端进度与质量检查（已完成）

1. [x] 恢复根目录与 `mobile/` 连续性文档，核对版本库状态
2. [x] 盘点移动端代码、构建产物、隧道与文档实际状态
3. [x] 静态审查 MobileBridge、PWA、Electron 生命周期与打包配置
4. [x] 执行构建、离线契约测试及本地端到端冒烟
5. [x] 汇总完成度、问题分级、修复建议并同步连续性文档

## 当前下一步（移动端检查）

先修复公开配对码端点、集成版公网 Origin 配置和项目卡片点击；随后补可重复的 BFF/PWA 自动测试，再做公网真机验收。

## 当前任务：卡住 session 恢复与移动流式修复（已完成）

1. [x] 恢复 `019f85e6…` session 压缩摘要并确认 JSONL 未损坏
2. [x] 修复 idle/active running 语义，补 BFF 状态回归
3. [x] 增加项目/会话列表运行状态轮询与异步视图防串页
4. [x] 修复多轮 assistant/tool 流式段落消失、乱序、闪烁和 thinking 不显示
5. [x] 增加 PWA 流式 reducer 回归测试
6. [x] 核对并修正 `qwen3.8-max-preview` 上下文/输出元数据
7. [x] 重启 standalone BFF，完成本地/公网验收、独立复审和提交

## 当前任务：移动端全链路复检（已完成）

1. [x] 确认当前会话真实模型与手机模型切换请求一致
2. [x] 执行 TypeScript、BFF、PWA 流式、静态脚本和契约回归测试
3. [x] 验证本地/公网健康、鉴权、SSE、缓存头、Tunnel/watchdog 状态
4. [x] 审查 PWA 更新生命周期、移动视口、智能滚动和运行状态刷新
5. [x] 独立复审 BFF/运行时与 PWA/体验，汇总问题分级
6. [x] 修复确定性问题并重新验证；不重启当前 pi-web
7. [x] 更新 findings/progress/STATUS_HANDOFF 并提交

## 当前下一步（移动端）

用户继续真机体验验收 v5；若输入区仍有设备特有偏移，记录手机浏览器/安装模式/键盘状态后针对该设备调整。

## 移动端稳定性加固（已完成）

1. [x] session store 改为 tokenHash + 原子写，并无损迁移现有登录
2. [x] 增加 BFF 重启持久化与明文 token 防泄露回归
3. [x] watchdog 分层检查 pi-web/BFF/public API，并精确管理 pi-mobile connector
4. [x] standalone BFF 本地故障自愈，integrated/未知进程拒绝误杀
5. [x] 公网连续两次失败（约 6 分钟）后恢复，忽略单次波动
6. [x] cloudflared 传输改为 auto 适应不同代理节点
7. [x] 重建安装版/便携版并通过 package parity

## 当前外部阻塞

当前代理/路由到 Cloudflare tunnel edge 同时出现 HTTP/2 TLS EOF 与 QUIC dial timeout；本地 62809/62810 健康。需代理节点/路由恢复，watchdog 会在链路可用后自动恢复公网。
