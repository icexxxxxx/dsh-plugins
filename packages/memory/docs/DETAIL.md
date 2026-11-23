# Icex DSH Memory

给 DeepSeek Harness 加一层跨会话记忆。只做三件事：把事实存成可读的文件、在会话开始时注入一段有预算的摘要、给模型一个写入口。

## 存储

两个作用域，都是纯 Markdown，可以手改、可以进 git：

| 作用域 | 路径 | 用途 |
| --- | --- | --- |
| global | `~/.dsh/memory/MEMORY.md`（`$DSH_HOME` 优先） | 用户偏好、跨项目约定 |
| project | `<cwd>/.dsh/memory/MEMORY.md` | 只在这个工作目录生效的项目事实 |

一行一条：

```
- [pref] 回答要结论先行，不要铺垫 <!-- id=4c1a2b src=session-5f0adb65@42 at=2026-11-20 -->
```

- `kind`：`pref` / `project` / `pitfall` / `decision` / `tool`
- `id`：由内容与日期派生的 6 位短 id，`replace` / `forget` 用它定位
- `src`：产生这条事实的会话与事件序号；记忆指回原始日志，冲突时以日志为准
- `at`：写入日期

`add` 会做一次近似查重（同作用域、词集 Jaccard ≥ 0.85），命中时返回已有条目而不是新增；`replace` / `forget` 按行原地修改，文件里其他手写内容保持不动。

## 注入

每次 agent 创建时（`agent/created`）读取两个作用域，拼成一条 `<memory-context>` 消息，通过 `agent.inject` 放进收件箱：

- 只注入一次，不随每步变化；不动系统提示前缀，避免打掉 provider 的 KV cache
- 作为 `agent/inbox/spliced` 事件进日志，可在会话里回看"这次到底给了模型哪些记忆"
- 预算：全局 620 字符 / 项目 1000 字符，各取最近 8 / 12 条；装不下的条目收起并显式写"…N more"，不静默截断
- 内容为空的会话不注入

## 工具

`memory`，一个工具五个 action：

| action | 参数 | 行为 |
| --- | --- | --- |
| `add` | `text`, `kind`, `scope` | 查重后追加一行，带 `src` 与日期 |
| `replace` | `id`, `text`, `kind` | 原地替换该条 |
| `forget` | `id` | 删除该条 |
| `search` | `query`, `scope` | 本地词集打分，返回最多 10 条 |
| `list` | `scope` | 最近 20 条 |

写入约束：单条 ≤200 字符、拒绝疑似密钥（`sk-…`、`token=`、私钥等）、`add` 自动查重。文件写入走"临时文件 + rename"，避免并发写坏。

## 整理（自动 + 手动）

插件自己完成，不依赖任何定时器或后台进程：**每次会话开始检查一次**，距上次整理超过 `consolidateIntervalDays`（默认 7 天）就顺手跑一遍。

整理只做两件确定性的事，不调用模型、不删除内容：

1. **合并近似重复**：同一作用域内相似度 ≥ `dedupeSimilarity`（默认 0.85）的条目只留一条，被合并的进归档。
2. **控制条数**：单作用域超过 `maxEntries`（默认 60）时，最旧的条目移进 `MEMORY.archive.md`，不是删掉。

被移走的条目全部写在同目录的 `MEMORY.archive.md` 里，随时可以捞回来。运行结果记录在 `~/.dsh/memory/.state.json`（上次时间 + 本次报告），并用 `.consolidate.lock` 防止两个会话同时整理。

想立刻整理就调工具：`memory` + `action: consolidate`，返回合并和被归档的条数。

可调参数（写在 bundle 的 config 里，全部可选）：

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `consolidateIntervalDays` | `7` | 两次自动整理的最小间隔天数 |
| `maxEntries` | `60` | 每个作用域保留的最大条数，超出部分归档 |
| `dedupeSimilarity` | `0.85` | 判定重复的相似度阈值（0.5–0.99） |


## 候选记忆（自动捕获）

光靠模型自觉会漏，所以插件在旁边做一层低成本的捕获：

- 监听会话里的用户消息（只认 `source.kind = user`，跳过 runtime-context / skill-catalog 这类注入内容）
- 命中「记住 / 以后 / 不要 / 必须 / 约定 / 偏好 / always / never …」且不超过 400 字时，把原话截到 200 字写进 `~/.dsh/memory/pending.jsonl`
- 队列最多 50 条，超过 14 天自动过期；同样的原话只存一次
- 下次会话的摘要里会多一段 `[candidates]`，最多列 3 条，并写明「用 memory add 转正，其余用 memory action=dismiss 丢掉」
- `memory add` 成功后，与新增事实高度相似的候选会自动出队

工具新增两个 action：`candidates`（列出待确认项）和 `dismiss`（按 id 丢弃）。


## 设置页编辑

插件在 **Plugins → Icex DSH Memory** 的配置区里提供一个「记忆」板块：

- 作用域切换：**全局**（`~/.dsh/memory/MEMORY.md`）或**项目**（填一个工作目录，编辑 `<dir>/.dsh/memory/MEMORY.md`）
- 直接编辑整个文件，保存后原子写入，下个会话开始时生效
- 显示条数、文件路径、未保存状态；保存时同样拦截疑似凭证，单文件上限 256 KiB

接口是 `GET/POST /api/icex-memory?scope=global|project&dir=<abs>`，只对已认证的本机浏览器 Peer 开放。


## 安装

```sh
cd ~/codes/icex-dsh-memory
# 在 Plugins 里用本地目录安装，或把该目录作为一个 bundle 加进 profile 的 dsh.profile.bundles
```

插件自行从运行中的 app 里加载 `@deepseek-ai/dsh-tools`；通过 `link:` 安装也不需要在本仓库跑 `pnpm install`。找不到时降级为"只注入 + 用文件工具编辑"，不会报错中断会话。

## 验证

1. 新开一个会话，问"你的记忆里有我吗"——应能看到注入的摘要（也可在会话日志里找 `agent/inbox/spliced`）。
2. 说一条长期偏好，确认模型调用 `memory add`；检查 `~/.dsh/memory/MEMORY.md` 多了一行带 `src` 的条目。
3. 再开一个新会话，确认该条目出现在开场摘要里。
4. 说"这条不用了"，确认走 `forget` 或 `replace`，文件里对应行消失或更新。
5. 用 context 面板对比：注入 token 应 ≤ 1.5k；同一会话多轮之间 `cacheRead` 不应因记忆抖动。

## 已知边界

- **只注入一次**：同一会话内新增的记忆不会中途重新注入，下个会话才生效（这是为了缓存稳定）。
- **不做 LLM 蒸馏**：什么时候写由模型判断，整理只做确定性的去重与归档，不改写措辞、不调用模型；检索也是词集打分，没有 embedding。
- **不做向量召回**：需要原始对话细节时，用官方 opt-in 的 `dsh-tool-session-query`（`session_search`，作用域为 cwd 完全相同）。
- **project 作用域按工作目录精确匹配**：在子目录开新会话不会继承父目录的项目记忆。
- 超过预算的旧条目不会自动淘汰，只是不进入摘要；需要长期维护时手动 `list` + `forget`。
