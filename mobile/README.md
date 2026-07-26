# mobile/ — 移动端（安卓互通）子项目

> **所有移动端相关的文件都放在这个文件夹里，避免与桌面端文件混淆。**

本目录是 [Pi Web Desktop](../README.md) 的移动端子项目：把手机变成桌面 Pi Web 的远程遥控器（查看项目/会话/实时输出，发消息、中止、切换模型）。

## 架构概览

```
手机 PWA（添加到主屏幕）
   │  同源 fetch + EventSource（安全 Cookie）
   ▼
Cloudflare Named Tunnel（可选，固定 HTTPS 域名，手机免 VPN）
   ▼
127.0.0.1:62810  ← MobileBridge BFF（实现见 ../src/mobile-bridge.ts）
   · PWA 静态资源 + 配对码登录
   · /mobile/api/v1/* 白名单代理（过滤敏感字段）
   · SSE 适配、心跳、断线清理
   ▼
127.0.0.1:<动态端口>  ← 锁定版本 pi-web
```

## 约定

- 本文件夹是移动端子项目的唯一存放地：文档、测试、PWA 资源都放这里或子目录。
- **不要**把移动端文件散落到仓库根目录。
- 移动端**不修改** `resources/pi-web/`（pi-web 锁死版本）。
- 互通桥代码合并进桌面端 `src/`（`src/mobile-bridge.ts`）；该部分虽在 `src/`，但属于移动端功能，相关说明以本文件夹为准。

## 关键文件

| 文件 | 说明 |
|---|---|
| `README.md` | 本说明 |
| `tests/bff.test.mjs` | BFF 接口/认证/安全测试 |
| `tests/runtime.test.mjs` | 运行时集成测试 |
| `tests/pwa-stream.test.mjs` | PWA SSE 流式测试 |
| `tests/pwa-navigation.test.mjs` | PWA 导航/返回测试 |
| `tests/pwa-shell.test.mjs` | PWA 壳/缓存测试 |
| `tests/package-parity.test.mjs` | 打包一致性（ASAR parity） |

PWA 静态资源位于 [`../resources/mobile/`](../resources/mobile/)（`index.html` / `sw.js` / `manifest.json` / 图标）。

## 安全要点

- BFF 默认**仅绑定 127.0.0.1**；公网需经 Cloudflare Tunnel 并设置 `PI_MOBILE_ORIGIN`。
- Cookie 认证（`HttpOnly` + `SameSite=Strict`），变更接口强制 Origin 校验。
- 认证令牌仅存 SHA-256 哈希；接口不转发敏感字段；历史 8 MiB 硬上限。

## 运行测试

```bash
npm run test:mobile     # 在仓库根目录执行
npm run test:package
```
