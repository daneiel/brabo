---
traducao_de: 2f301391630d5be632e27036026760d416d43da1
---

# ADR 0114 — 在开发引导中检测原生 Ollama：只问一次，持久化到 `.env`，把 compose 的服务放到 profile 之后

- **状态：** 已接受
- **日期：** 2026-08-26
- **背景：** 关闭在本地开发引导中发现的一个真实端口冲突，冲突双方是 compose 的 `ollama` 服务与开发者机器上已在运行的原生 Ollama 安装
- **参考（不编辑）：** [ADR 0025](0025-fase5-deploy-kubernetes-kustomize.md)（决策 10——`pnpm dev` 和 `make deploy-local` 有意共享端口）、[ADR 0100](0100-rag-search-e-modelos-garantidos-no-boot.md)（引入了本 ADR 放到 profile 之后的 `ollama`/`ollama-model-loader` 这一对）

## 背景 {#contexto}

`scripts/dev/preflight.mjs` 早已存在，用于在 `docker compose up` 之前捕获已知的端口冲突：`pnpm dev` 和 `make deploy-local` 有意共享 3000/4000/8080 端口（ADR 0025，决策 10），而 Docker 那句含糊的 `port is already allocated` 既不说明谁占着端口，也不说明该怎么办。preflight 读取 `docker compose config`，与 `docker ps` 和 `ss -tlnp` 交叉比对，并按名字报告每一个冲突。

`OLLAMA_PORT`（默认 `11434`）就在这同一组里——而它也是*原生* Ollama 安装的默认端口，开发者可能出于无关的原因早已在自己的机器上运行着它。与 k3d 的冲突不同，这个冲突有一个通用冲突报告所不知道的正当解法：复用原生守护进程，而不是在容器中再跑一个。像其他冲突一样被报告为 "port 11434 ← ollama (unknown process)"，修复看起来就像一个需要绕开的问题，而真正的答案是"让它复用"。

## 决策 {#decisão}

### 1. 在特殊处理之前确认它确实是 Ollama {#1-confirmar-que-é-mesmo-o-ollama-antes-de-tratá-lo-de-forma-especial}

`detectarOllamaNativo`（`scripts/dev/preflight.mjs:234`）只有当对 `http://localhost:<porta>/api/tags` 的实时 GET 以 Ollama 一贯返回的形式响应时（即使还没有下载模型，`{"models":[]}`，通过 `ehOllama` 核对，`preflight.mjs:159`），才把该端口当作特例。这里短超时（1.5 秒）很重要：它在任何容器启动之前运行，所以在这里卡住就会卡住整个 `docker compose up`。端口上任何不以 Ollama 方式响应的东西都落入早已存在的通用冲突报告——本决策只触及占用者被证实就是本 ADR 所讨论之物的那一种情况。

### 2. 只问一次，没有 TTY 时采用默认值，并记录决定以免再问 {#2-perguntar-uma-vez-aplicar-o-padrão-sem-tty-e-registrar-a-decisão-para-não-perguntar-de-novo}

`perguntarUsoDoOllama`（`preflight.mjs:198`）会问 "Detectamos Ollama já rodando na porta N. Usar essa instância? [S/n]"——但只在 `process.stdin.isTTY` 时。`bootstrap.sh` 的菜单项有意在后台运行命令，并把 stdin 重定向自 `/dev/null`，以免正在运行的命令抢走菜单本身正在读取的方向键；一个试图从已关闭的流中读取一行的提问会永远卡住。没有 TTY 时，函数在日志中记录原因并直接返回默认值（是）——这与产品其余部分在某个决定需要人、但可能没人在看时所用的守卫形式相同。

答案写入 `.env`，只要 `OLLAMA_MODE` 还在那里就再也不问：一旦这个键存在，`detectarOllamaNativo` 就在一开始立即退出（`preflight.mjs:236`）。`pnpm dev` 的正常循环中没有任何东西会再问——重新打开这个问题的唯一方式是决策 5 中的新菜单项。

### 3. `escreverEnv`——本仓库中第一个*写入* `.env` 而不只是读取它的东西 {#3-escreverenv--a-primeira-coisa-neste-repositório-que-escreve-o-env-não-só-o-lê}

所有现有的触及 `.env` 的脚本（`reset-total.sh` 对 `*_TEST_KEY` 的查找、本文件自己的 `lerEnv`）都只是用 grep 取出一个值。在此之前没有任何东西需要*更新*一个值，所以没有可在这个方向复用的 bash 模式。`escreverEnv`（`preflight.mjs:118`）用 Node 编写，因为更新需要一个面向行的 bash 工具不额外小心就给不了的性质：读取文件，当某行的键已存在时就地重写该行，不存在时把键追加到末尾，并保持所有注释和其他所有键不变。在"是，使用"路径上，它写入 `OLLAMA_MODE=host` 和 `OLLAMA_HOST=http://host.docker.internal:<porta>`；在"否"路径上，它写入 `OLLAMA_MODE=container` 以及一个新的 `OLLAMA_PORT`，从 `11500` 往上扫描找到（`proximaPortaLivre`，`preflight.mjs:178`），这样容器就得到一个空闲端口，而不会与它刚被告知不要去碰的原生实例冲突。

### 4. 把 `ollama`/`ollama-model-loader` 放到 compose 的 profile 之后 {#4-pôr-ollamaollama-model-loader-atrás-de-um-profile-do-compose}

这两个服务（由 ADR 0100 引入）改为 `profiles:
["local-llm"]`（`docker/docker-compose.yml:82,119`）——与 `docker-compose.prod.yml` 为等价的一对在字面名称 `llm` 下已在使用的模式相同（不同的文件，所以字面量不必一致）。带 profile 的服务在单纯的 `docker compose up` 中不会启动，而这正是 `OLLAMA_MODE=host` 所需要的：不是"启动了但无法访问"，而是从未启动，因此从不争夺端口，也从不耗费内存去加载一个没有任何东西会查询的模型。

### 5. `scripts/dev/perfil-ollama.sh` 在每条命令运行的那一刻决定 `--profile local-llm` {#5-scriptsdevperfil-ollamash-decide---profile-local-llm-no-momento-em-que-cada-comando-roda}

一个小脚本，而不是在三个地方重复的 `grep`：除非 `.env` 已经写着 `OLLAMA_MODE=host`，它就打印 `--profile local-llm`，否则什么都不打印。它被仅有的两个启动**整个**栈而不是某个具名服务的 `docker
compose` 调用方使用——"Docker › Deploy › All" 和 "Docker › Create"（`bootstrap.sh`，菜单项 `1.1.1`/`1.2`）——通过 `$(bash scripts/dev/perfil-ollama.sh)`，在命令树的源码中**转义**写成 `\$(...)`，以便在菜单项*执行*时而不是在构建树时求值（与 Database ›
Delete 命令中对 `\${POSTGRES_USER}` 已在使用的转义相同）。Api/Engine/Web（`1.1.2`–`1.1.4`）各针对一个服务，从不触碰 `ollama`，所以保持原样。

### 6. "Docker › Reconfigurar Ollama"（`1.5`）重新打开这个问题 {#6-docker--reconfigurar-ollama-15-reabre-a-pergunta}

`scripts/dev/reconfigurar-ollama.sh` 无条件地从 `.env` 中删除 `OLLAMA_MODE` 和 `OLLAMA_HOST`，而 `OLLAMA_PORT` *只在*被遗忘的模式是 `container` 时删除——在 `host` 模式下，这个端口是由原生安装 Ollama 的人写入的，而不是由本机制写入的，删除它会让下一次启动悄悄忘记一个从来不属于本功能的值。该菜单项不需要确认界面：它最多改动 `.env` 的三行，对数据没有任何破坏性，这与其他非平凡但非破坏性的菜单项（Generate、Migrate、Seed）已遵循的尺度相同。

## 后果 {#consequências}

**一个隐藏了端口的 profile 也隐藏了真实冲突，所以检测路径必须自己补上。** 当 `ollama` 位于未激活的 profile 之下时，`docker compose config` 默认不再列出端口 `11434`——原本能捕获"有别的东西占着 11434"的通用逐端口循环就会看不到它，这相对于本 ADR *之前*存在的行为是一次静默回退。`detectarOllamaNativo` 自己堵上了这个缺口：当端口被某个响应形式不同于 Ollama 的东西占用时，它返回一个与通用循环产出格式完全相同的冲突条目，落入同一份报告。

**从 `api` 中移除 `depends_on: ollama` 是被迫的改动，不是偶然的。** 当一个不在未激活 profile 中的服务依赖一个在其中的服务时，Compose 会以 "depends on undefined service" 拒绝整个文件——在动真实文件之前已在隔离沙箱中测试确认，而这会破坏每一次 `docker compose` 调用（`up`、`down`、`ps`，甚至 `preflight.mjs` 自己调用的 `config`）。对 compose 的目的而言，这个依赖本来就是残留：`api` 在运行时、在 agent 的轮次中调用 Ollama，从不在自身启动时调用，所以启动顺序没有丢失任何东西。

**"Docker › Destroy" 也经过同样的条件 `--profile`。** 不带 `--profile` 的 `docker compose down` 会忽略属于未激活 profile 的容器——如果 `ollama`/`ollama-model-loader` 是在 `local-llm` 下启动的，单纯的 `down` 会让它们继续运行，并可能让网络处于"仍在使用"状态。`bootstrap.sh` 的 `CMD["1.3"]` 现在通过与 `up` 路径相同的辅助脚本 `scripts/dev/perfil-ollama.sh` 解析，因此 Destroy 恰好拆除对应 `up` 所启动的东西——由 `bootstrap.spec.ts` 的用例 "Docker › Destroy também passa pelo perfil do Ollama" 覆盖。

**已声明、未在此修正：项目自己空闲的 `ollama` 容器可能被误认为原生安装。** 如果开发者切换到 `OLLAMA_MODE=container` 却没有先停掉容器，`detectarOllamaNativo` 无法区分"这个端口上有一个原生安装"和"项目自己上一次运行留下的 `ollama` 容器仍在这个端口上"——在这种情况下它会再问一次。没有实现：这个顺序并不常见（不先停栈就重新配置），而且超出了产生这个功能的需求范围。

**`.env` 中的追加顺序没有经过整理。** 当三个键都还不存在时，`escreverEnv` 把它们追加到文件末尾，而不是放在 `.env.example` 已在其周围说明它们的 `OLLAMA_PORT`/`OLLAMA_HOST` 块旁边。这是外观问题，不是正确性问题——无论落在文件何处，值都同样有效。

## 考虑过的替代方案 {#alternativas-consideradas}

- **继续把被占用的端口报告为通用冲突，让开发者通过 `.env` 手动解决。** 被拒绝：这是一种常见且无害的情形，不是错误——把它与"k3d 集群在运行"或"一个无关的进程占着这个端口"贴上同样的标签，会让开发者每次启动栈时都去绕开一个只需一行就能修正的东西。
- **静默检测并复用原生实例，不问。** 依据产品对不属于自己的配置一贯坚持的同一原则被拒绝（CLAUDE.md：产品绝不在没有明确决定的情况下覆盖用户配置）——即使是低风险的开发便利，也要有一个只问一次的明确问题，而不是开发者事后读 `.env` 才发现的静默默认值。
- **让 `ollama`/`ollama-model-loader` 不在任何 profile 中，只是在 `host` 模式下不再发布端口。** 被拒绝：容器仍然会启动，仍然会把模型加载进内存，仍然会耗费没有任何东西会查询的 CPU/内存——profile 阻止它们启动，这才是"改用原生实例"的真正含义。
