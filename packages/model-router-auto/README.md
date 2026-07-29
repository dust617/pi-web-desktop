# Model Router Auto

> 面向 [Pi Coding Agent](https://github.com/agegr/pi-web) 的**智能模型路由与编排扩展** —— 在推理边界自动将任务路由到最合适的 LLM，无需手动切换模型。
>
> 此目录是 Pi Web Desktop 内置的可审查子项目。它不包含实际 Provider、模型映射、认证信息、会话状态、遥测或日志；这些运行态数据只保留在本机并由 `.gitignore` 排除。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](#license)

## ✨ 核心特点

### 🧠 推理边界路由
不在 token 输出中途换模型，只在每次推理请求的边界做路由决策。保证对话连贯性，同时让每个推理步骤都用上最合适的模型。

### 📊 局势感知分析
纯函数分析器实时评估当前工作状态：
- **阶段识别**：自动判断当前处于规划（plan）、执行（execute）、诊断（diagnose）、验证（verify）哪个阶段
- **停滞检测**：通过工具失败连续次数、同错误签名重复次数、测试增量等多维信号识别停滞，而非简单计数对话轮数
- **错误签名归一化**：将引号串、路径、数字等变量归一化，准确识别"同因错误"

### 🎯 多角色模型分工
通过配置文件将不同能力角色映射到不同模型：

| 角色 | 用途 | 推荐模型类型 |
|------|------|-------------|
| `fast` | 简单问答、格式化 | 轻量快速模型 |
| `executor` | 代码编写、工具调用 | 编码专用模型 |
| `planner` | 任务规划、架构设计 | 强推理模型 |
| `diagnostician` | 错误诊断、根因分析 | 强推理模型 |
| `reviewers` | 代码审查（多模型投票） | 多个不同模型 |

### 🔒 权限与安全引擎
- **Fail-closed 设计**：权限判断失败时默认拒绝，而非放行
- **动词分类**：区分只读命令（`grep`、`ls`）与写操作，只读命令不触发关键词拦截
- **workspace 路径约束**：写操作限制在项目目录内
- **日志脱敏**：自动过滤 Bearer token、API key、密码等敏感字段

### 📈 遥测与基线对照
- **Telemetry v2**：结构化事件日志（route_intent / route_outcome / task_completion），支持 decisionId 关联
- **Holdout 基线**：可配置固定模型对照组，用于评估动态路由的实际收益
- **日志轮转**：自动管理 `.1` ~ `.5` 轮转文件，防止磁盘占满

### 🔍 监督模式（Supervisor Hint）
扩展以**监督模式**运行：不注册 Provider、不拦截工具调用，只维护会话状态并在必要时生成短时（≤120s）、绑定 session 的能力下限提示（`high` / `ultra`），由底层路由器完成具体模型选择。

### ✅ 验证沙箱
代码审查在隔离沙箱中运行：超时控制、取消支持、事件退订、`noExtensions` 隔离，防止审查过程影响主会话。

## 📁 项目结构

```
.pi/extensions/
├── auto-orchestrator/
│   ├── index.ts              # 扩展入口（监督模式）
│   ├── analyzer.ts           # 局势分析（纯函数）
│   ├── policy.ts             # 路由策略（优先级链）
│   ├── router-supervisor.ts  # Supervisor hint 生成
│   ├── route-executor.ts     # 路由执行与模型切换
│   ├── permission-policy.ts  # 权限分类引擎
│   ├── permission-gate.ts    # 权限拦截门
│   ├── verifier.ts           # 审查沙箱
│   ├── state.ts              # 会话状态管理
│   ├── state-reducer.ts      # 状态归约（不可变）
│   ├── state-repository.ts   # 状态持久化
│   ├── telemetry.ts          # 遥测 v2（脱敏+轮转）
│   ├── config.ts             # 配置加载与校验
│   ├── error-signature.ts    # 错误签名归一化
│   ├── test-signal.ts        # 测试结果信号解析
│   ├── context-builder.ts    # 上下文构建
│   ├── runtime-adapter.ts    # 运行时适配层
│   ├── events.ts             # 事件定义
│   ├── tools.ts              # 工具定义
│   └── types.ts              # 类型定义
├── pi-router-telemetry/
│   └── index.ts              # 路由器遥测扩展
scripts/
├── holdout-stats.mjs         # Holdout 基线对照统计
├── label-task-complete.mjs   # 任务完成标签（人工/测试验证）
└── apply-pi-model-auto-supervisor-patch.mjs  # Supervisor hint 补丁
test/                         # 完整单元测试（13 个测试文件）
```

## 🚀 快速开始

### 环境要求

- [Pi Coding Agent](https://github.com/agegr/pi-web) ≥ 0.8.0
- Node.js ≥ 22
- TypeScript ≥ 5.6

### 安装

```bash
# 先安装内置 Pi Web 的依赖；智能路由会将其作为 peer dependency 使用
npm --prefix resources/pi-web ci

# 再安装子项目依赖
npm --prefix packages/model-router-auto ci

# 类型检查
npm run check

# 运行测试
npm test
```

### 配置

从匿名模板创建**仅本机使用**的配置，再将其中的示例模型替换为 `pi --list-models` 中实际可用的模型：

```bash
cp .pi/orchestrator.example.json .pi/orchestrator.json
```

`orchestrator.json` 已被忽略，绝不能提交。示例模板不包含任何实际 Provider、模型、认证或使用记录。

### 应用 Supervisor 补丁（可选）

如需启用 supervisor hint 功能：

```bash
npm run router:patch        # 应用补丁
npm run router:patch:check  # 检查补丁状态
```

## 🧪 测试

```bash
npm test          # 运行全部测试
npm run gate      # 完整门禁：ci + check + test
npm run data:check  # Holdout 数据准入检查
```

## 📐 路由策略优先级

```
硬能力要求 > 上下文窗口 > 安全约束 > 停滞升级 > 阶段匹配 > 模型黏性 > 成本优化
```

- **熔断机制**：`maxSwitchesPerTurn` 只限制成本型切换（DOWNSHIFT/KEEP），安全/复核路由（VERIFY/DIAGNOSE/PLAN）不受熔断影响
- **模型黏性**：`modelStickinessTurns` 内保持同一模型，减少无意义切换
- **阶段转移表**：非法阶段转移自动回退到当前阶段

## 📄 License

MIT
