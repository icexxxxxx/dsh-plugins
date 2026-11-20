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

## 作为插件源给其他人用

仓库根目录的 [`index.json`](index.json) 是 DSH 插件市场索引（format 1），已经用 DSH 自带的 `parseMarketIndex` 校验通过。

**方式一：加索引（推荐）**

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

之后在 Discover 里搜 `icex` 就能看到两个插件，点安装即可。

**方式二：手动装某个包**

索引里的版本目前指向 git（npm 首发还在审核），安装论证就是：

```sh
dsh plugin --profile desktop add "git+https://github.com/icexxxxxx/dsh-plugins.git#7fec08d6571e30e6b9636f45fca8f66578fabc85&path:/packages/memory"
```

等 npm 审核通过，索引里换成 `type: npm` 的版本，安装就退化成 `icex-dsh-memory@0.2.0`。

要求：对方机器上有 `git`（pnpm 需要它拉取源码），网络能到 GitHub（或走自己的代理）。

## 发布

两个包在以 `v*` 打 tag 时由 GitHub Actions 发布到 npmjs（见 [.github/workflows/publish.yml](.github/workflows/publish.yml)）。

首次需要两步（我没法替你完成，都属于账号级操作）：

1. 在 npmjs.com 建一个 Scope 为空的 **Automation** token（或 Granular token，勾选两张包的读写）。
2. 把它存成仓库 secret：`gh secret set NPM_TOKEN --repo icexxxxxx/dsh-plugins`。

之后：

```sh
git tag v0.2.1 && git push origin v0.2.1
```

发布成功就能一条命令安装：

```sh
dsh plugin --profile desktop add icex-dsh-memory
dsh plugin --profile desktop add icex-dsh-fixer
```

## 开发

两个包都是"无构建步骤"的 ESM：改完文件重载插件即可（`memory` 是 host 侧，重载或重启生效；`fixer` 的客户端半重载页面生效）。

```sh
# 语法检查
node --check packages/fixer/client.js
node --check packages/memory/index.js
```

## License

MIT
