# pi-plugins

面向 [Pi](https://pi.dev) 的插件工作区。当前提供基于上游 **pi-subagents v0.67.0** 的可选统一抽屉：保留上游执行能力，将人类操作集中到 `/subagents`，精简斜杠补全。

## 从本仓库安装 Subagents

使用 `vendor/pi-subagents`，**不需要同时安装或加载官方 npm 包**。上游历史和许可证保留在子模块中；定制功能由本仓库的可重放补丁保存，不依赖另一个远程 fork。

> 实验状态：类型检查、166 项相关单元测试、45 项集成测试及离线 Pi 加载通过，但独立审查尚未完成，上游进程清理测试存在 `kill EPERM` 失败。发布源码不代表已完全验收或自动切换本机安装。完整验证和限制见[维护说明](patches/pi-subagents/README.md)。

### 1. 获取源码并应用定制补丁

需要 Git、npm 和兼容的 Pi 环境；当前验证宿主为 Pi 0.85.1、Node 24。

```sh
git clone --recurse-submodules https://github.com/FYZAFH/pi-plugins.git
cd pi-plugins

# 先检查：有本地修改时停止，不要覆盖。
git -C vendor/pi-subagents status --short
# 将哈希与 patches/pi-subagents/base.json 核对。
shasum -a 256 patches/pi-subagents/unified-drawer.patch

git -C vendor/pi-subagents apply --check ../../patches/pi-subagents/unified-drawer.patch
git -C vendor/pi-subagents apply ../../patches/pi-subagents/unified-drawer.patch
(cd vendor/pi-subagents && npm ci --ignore-scripts && npm run typecheck)
```

已有 checkout 可用 `git submodule update --init vendor/pi-subagents` 初始化。**补丁只应用一次**；本机开发目录已经应用，不要重复执行。不要使用 reset/clean 丢弃自己的改动。

### 2. 配置 Pi 加载本地包

将 `~/.pi/agent/settings.json` 中原有的 pi-subagents 包条目替换为下面的对象，路径改成你实际克隆位置。保留其他包及设置，不要整份覆盖配置。

```json
{
  "packages": [
    {
      "source": "/absolute/path/to/pi-plugins/vendor/pi-subagents",
      "skills": ["skills/pi-subagents/SKILL.md"],
      "prompts": []
    }
  ],
  "subagents": {
    "disableBuiltins": true,
    "commandMode": "compact"
  }
}
```

首次安装、尚无同名包时，也可以先运行：

```sh
pi install "$(pwd)/vendor/pi-subagents"
```

再将添加的条目改成上面的过滤配置。**已有官方 npm 包或其他本地副本时，不要直接追加第二个条目**，应替换原 source，避免重复注册工具。项目 `.pi/settings.json` 中的同类配置也需检查。

- 只加载通用 `pi-subagents` Skill，不加载附带 prompt 模板。
- 内置角色禁用；同名 agent overrides 和项目设置可能覆盖禁用规则，需检查已有配置。
- 自定义角色放在 `~/.pi/agent/agents/` 或项目 `.pi/agents/`；需要时可使用上游 `create` 接口创建。
- `inheritSkills` 属于角色配置；需要明确禁止继承时，在角色中写 `inheritSkills: false`。
- `commandMode: "compact"` 仅精简人类 TUI 补全并启用抽屉；模型工具接口、显式旧命令及 RPC 兼容性保留。删除此键或设为 `"full"` 可恢复上游显示方式。

结束正在运行的任务后，新开 Pi 会话加载配置。输入 `/subagents` 或按 `Ctrl+Alt+F` 打开；当前入口先展示 Fleet，按 Esc 进入分类菜单，再按 Esc 关闭。

## 跟随上游更新

版本、补丁校验值和更新步骤位于 [patches/pi-subagents/](patches/pi-subagents/README.md)。不要直接用 `pi update` 更新另一个 npm 副本，或在带本地修改的子模块内强制 reset。

主仓库需要记录 `.gitmodules`、上游版本 gitlink 和完整补丁；**gitlink 本身不会保存子模块里未提交的 UI 改动**。升级时在干净副本重放补丁、验证后更新基线与补丁。

## 旧自研插件

旧 `packages/subagent` 已退出活动工作区，不再维护或加载。旧运行历史不能当作新框架的可恢复子会话。当前 `packages/` 为空，测试应在 `vendor/pi-subagents` 中执行，而不是运行没有输入包的根 workspace 测试。
