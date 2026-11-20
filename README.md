# dsh-plugins

个人 DeepSeek Harness（DSH）插件合集，一个仓库管理、一份发布流程。

| 包 | 作用 | 形态 |
| --- | --- | --- |
| [`packages/fixer`](packages/fixer) `icex-dsh-fixer` | 左侧输入锚点导航 + 双击右 Option 唤起窗口 | Web 客户端 + 原生 helper |
| [`packages/memory`](packages/memory) `icex-dsh-memory` | 跨会话记忆：开场注入摘要 + `memory` 工具 | Host 插件，无依赖 |

## 安装

DSH 从本地目录安装 bundle：在 **Plugins** 里选本地目录，或把它加进 profile 的依赖与 bundles。

```sh
git clone https://github.com/icexxxxxx/dsh-plugins.git
cd dsh-plugins
```

然后对需要的包：

```sh
# 方式一：Plugins 界面里选择 packages/fixer 或 packages/memory
# 方式二：写进 profile
#   "icex-dsh-fixer": "link:/path/to/dsh-plugins/packages/fixer"
#   "icex-dsh-memory": "link:/path/to/dsh-plugins/packages/memory"
#   并把包名加进 dsh.profile.bundles
```

两个包互相独立，可以只装其中一个。`memory` 的数据不在这个仓库里，见下。

## 各自的数据

- `fixer`：设置存在浏览器 `localStorage`；原生 helper 的日志在 `/tmp/icex-dsh-fixer-summon-<uid>.log`。
- `memory`：`~/.dsh/memory/MEMORY.md`（全局）和 `<cwd>/.dsh/memory/MEMORY.md`（项目），纯 Markdown，可手改、可版本化。

## 开发

两个包都是"无构建步骤"的 ESM：改完文件重载插件即可（`memory` 是 host 侧，重载或重启生效；`fixer` 的客户端半重载页面生效）。

```sh
# 语法检查
node --check packages/fixer/client.js
node --check packages/memory/index.js
```

## License

MIT
