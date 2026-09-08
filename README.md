# pi-plugins

面向 [Pi](https://pi.dev) 的模块化插件集合。每个插件独立打包、独立安装，通过可选的公开接口协作，而不是相互强制依赖。

## 插件

| 目录 | 用途 | 状态 |
| --- | --- | --- |
| [`packages/subagent`](packages/subagent) | 通用子 Agent 委派与执行 | 设计与调研，尚不可安装 |

## 当前方向

优先实现一个基于 Pi 原生能力的轻量 Subagent 框架，以及一份通用委派指南。不预设角色库，不绑定特定开发流程。

未来可能加入任务规划与进度更新（todo / update_plan）和专用监控面板。这些是独立模块，不是 Subagent 的前置依赖。

模块边界见 [架构约定](docs/architecture.md)。
