# pi-plugins

面向 [Pi](https://pi.dev) 的模块化插件集合。每个插件独立打包、独立安装，通过可选的公开接口协作，而不是相互强制依赖。

## 插件

| 目录 | 用途 | 状态 |
| --- | --- | --- |
| [`packages/subagent`](packages/subagent) | 通用子 Agent 委派与执行 | 实验版 0.2，支持可选 Agent Profile，可独立安装 |

## 当前方向

优先实现一个基于 Pi 原生能力的轻量 Subagent 框架，以及一份通用委派指南。不预设角色库，不绑定特定开发流程。

未来可能加入任务规划与进度更新（todo / update_plan）和专用监控面板。这些是独立模块，不是 Subagent 的前置依赖。

模块边界见 [架构约定](docs/architecture.md)。所有面向模型的提示词、工具说明与 Skill 使用英文。

## 使用 Subagent

```bash
git clone https://github.com/FYZAFH/pi-plugins.git
cd pi-plugins
pi install ./packages/subagent
```

安装插件目录，而不是仓库根目录。暂未发布到 npm；不要与另一个注册 `subagent` 工具的扩展同时启用。

能力与限制见 [插件文档](packages/subagent/README.md)。已通过离线 SDK、Pi 扩展集成和独立打包加载测试；尚未验证真实模型服务与交互式终端体验。

## 开发验证

```bash
npm ci --ignore-scripts
npm run typecheck
npm test
```

测试使用离线模型替身，不使用真实模型密钥、不修改全局 Pi 配置。
