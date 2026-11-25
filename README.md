# dsh-plugins

个人 DeepSeek Harness（DSH）插件合集，一个仓库管理、一份发布流程。

| 包 | 作用 | 形态 |
| --- | --- | --- |
| [`packages/plugin-center`](packages/plugin-center) `icex-dsh-plugin-center` | 侧栏插件中心：一键安装、更新、启停、移除 icex 插件，可开自动更新 | Host + Web 页面 |
| [`packages/fixer`](packages/fixer) `icex-dsh-fixer` | 左侧输入锚点导航、编辑已发消息并分支重发、双击右 Option 唤起窗口 | Web 客户端 + 原生 helper |
| [`packages/memory`](packages/memory) `icex-dsh-memory` | 跨会话记忆：开场注入摘要 + `memory` 工具 | Host 插件，无依赖 |

## 最快安装

给别人用只需要一条命令，装好插件中心后其余都在页面里点：

```sh
dsh plugin --profile desktop add icex-dsh-plugin-center
```

重启 DSH，侧栏出现「插件中心」。页面里列出 fixer、memory 和插件中心自己，未安装的点「安装」，有新版本点「更新」，也能直接启用/停用/移除；顶部的自动更新开关会按间隔静默升级已勾选的插件。

单独安装其余插件也可以：

```sh
dsh plugin --profile desktop add icex-dsh-memory
dsh plugin --profile desktop add icex-dsh-fixer
```

本地开发时才用源码目录：把依赖写成 `link:/path/to/dsh-plugins/packages/<name>`，并把包名加进 profile 的 `dsh.profile.bundles`。

## 各自的数据

- `plugin-center`：配置在 `~/.dsh/plugin-center/config.json`（自动更新开关、间隔、各包勾选状态、上次检查结果）。
- `fixer`：设置存在浏览器 `localStorage`；原生 helper 的日志在 `/tmp/icex-dsh-fixer-summon-<uid>.log`。
- `memory`：`~/.dsh/memory/MEMORY.md`（全局）和 `<cwd>/.dsh/memory/MEMORY.md`（项目），纯 Markdown，可手改、可版本化。

## 作为插件源给其他人用

仓库根目录的 [`index.json`](index.json) 是 DSH 插件市场索引（format 1），已用 DSH 自带的 `parseMarketIndex` 校验通过。

在 DSH 的 **Plugins → Discover** 里添加索引地址，或在 profile 的 `cordis.patch.yml` 里：

```yaml
- id: plugin-market
  name: "@deepseek-ai/dsh-plugin-market"
  config:
    indexes:
      - https://raw.githubusercontent.com/icexxxxxx/dsh-plugins/main/index.json
      # 国内网络可用镜像：
      - https://cdn.jsdelivr.net/gh/icexxxxxx/dsh-plugins@main/index.json
```

之后在 Discover 里搜 `icex` 就能看到三个插件，点安装即可。

## 发布

三个包在以 `v*` 打 tag 时由 GitHub Actions 发布到 npmjs（见 [.github/workflows/publish.yml](.github/workflows/publish.yml)）。版本号统一：`node scripts/release.mjs patch|minor|major|x.y.z`，脚本会跑全部测试、升版本、重生成 `index.json`、打 tag、推送并验证 npm 与索引。
