# 关键发现

- 本机有 `@agegr/pi-web@0.7.16` 与 `@earendil-works/pi-coding-agent@0.80.10`，没有 Electron 或 Qoder CLI 可执行文件。
- Pi Web 是 Next.js 服务，默认端口 30141；本机该端口当前已被占用，因此桌面壳必须选择空闲回环端口并以健康探测判断就绪。
- Pi Web 已提供项目会话、工作目录文件浏览和图片附件；非图片外部文件拖入应由桌面扩展补齐。
- Electron 页面必须启用 `contextIsolation` 与 sandbox、禁用 `nodeIntegration`；只通过最小预加载桥暴露文件选择、外部附件和原生菜单操作。
- Qoder Agent SDK 已确认存在，但用户明确排除，不进入本项目。

