---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# 0081 — 容器生命周期：状态表，没有编排器

## 状态 {#status}

已接受，**带有与 [ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md) 已为这一切片声明的同类切分**：表和状态机存在；真正指挥 Docker 容器的东西不存在，而决定它将如何存在的也不是本文档。

本 ADR **修订 [ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)**，关闭其"O que este ADR NÃO faz"一节所声明的那一半——"容器状态需要表……这一波唯一的迁移名额属于另一个阶段"——并触及 [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md) 的领域，后者仍然有效，两者都不编辑它。

## 背景 {#contexto}

ADR 0065 交付了不需要数据库的那一半：Arquiteto 的镜像决定（`artifact.project_image`，在 event log 中）以及它为 Code 标签页打开的关口（RN-105）。它明确说明了缺少什么：

> **O ciclo de vida do container (25b).** Provisionar, parar, reciclar,
> limpar; o que acontece quando a imagem muda; o que sobrevive a restart; o
> worktree do agente passando a viver dentro do container.
>
> O motivo é concreto e não é falta de desenho: **estado de container
> precisa de tabela**. Id do container, status, imagem em uso, quando
> subiu, a qual versão do artefato corresponde — nada disso é evento, é
> estado mutável, e forçá-lo no event log seria usar a ferramenta errada
> porque a certa estava ocupada. O slot único de migration desta onda
> pertence a outra fase.
>
> Entregar meio provisionamento seria pior que não entregar: **um
> container que sobe e não recicla é pior que nenhum**.
> — ADR 0065

PROGRAMA 28 到达这一波时，迁移名额为这张表空出来了。在写任何一行代码之前，有一个问题必须通过调查而不是假设来回答：**产品中是否已有某个服务能够指挥 Docker 容器？**

在 `docker/docker-compose.yml` 中逐行核实的答案是：没有。没有任何服务（`api`、`engine`，以及开发用的那些）挂载 `/var/run/docker.sock`，也没有任何服务以 `privileged: true` 运行。这不是一个可以顺手修正的遗漏——而是缺少一个真正的安全决定，而真正的安全决定不会作为一张表的副作用诞生。在容器中挂载 Docker socket 是已知的提权到主机 root 的途径；在用户没有明确授权、后果没有摆上桌面的情况下授予它，将是 ADR 0065 已经记录不会在网络和资源上犯的同一个错误："决定一次，而不是逐条命令决定"——而"决定一次"的前提是有人在做决定，而不是一个基础设施 ADR 出于方便替人选择。

## 决策 {#decisão}

### 表是一个尚不存在的编排器的**契约** {#a-tabela-é-o-contrato-de-um-orquestrador-que-ainda-não-existe}

`project_containers`（迁移 `0046`）记录项目容器的可变**状态**：`status`（显式状态机，见下文）、`image_version`（本行所对应的 `artifact.project_image` 版本——绝不是 `image`/`rationale`/`network` 的副本，它们仍然只存在于 event log 中）、`container_id`（Docker 守护进程中的真实 id，在编排器存在之前始终为 `NULL`）、**声明**的资源上限（`cpus`/`memory_mb`/`pids_limit`，镜像该行诞生时生效工件的 `RecursosDoContainer`）以及 `failure_reason`。

每个**项目**一行（`project_id` 唯一）——与 engine 中 `dev_agent_states` 的设计相同（ADR 0045）：同一时间只有一个生效的容器，移除后重新开通会复用同一行，而不是在其中积累历史。不可变的历史已经有它的位置——event log——这张表不试图同时扮演两者。

### 状态机 {#a-máquina-de-estados}

`provisioning → running ⇄ stopped`，`failed` 可从 `provisioning`/`running`/`stopped` 到达，而 `removed` 是唯一只能通过重新开通离开的状态（`removed → provisioning`）。没有哪个状态是真正的终态：即使 `removed` 也允许再次启动，因为项目可能用 Arquiteto 修订过的镜像重新开通。在 `apps/api/src/domain/containers/container-lifecycle.ts` 中校验，与 `session-state-machine.ts` 和 `pr-gate-state-machine.ts` **相同**的格式——允许转换表、纯函数、类型化错误（`InvalidContainerTransitionError`），由用例翻译为 409。

**第一次**转换是特殊的：在第一次以 `to: 'provisioning'` 调用之前不存在任何行，而它只有在 Arquiteto 已经决定镜像时才被接受（RN-105）——这与已经保护 Code 标签页的是同一个关口，在源头应用，而不是重复一份。那一刻生效决定的版本和资源被**冻结**在新行中；之后对工件的修订不会追溯改变一个已开通实例所承诺的东西——重新开通时才会再次读取工件。

### 不调用 Docker——两个用例都不 {#nenhuma-chamada-a-docker--em-nenhum-dos-dois-casos-de-uso}

`RegistrarTransicaoDeContainerUseCase` 和 `ObterCicloDeVidaDoContainerUseCase` 做的正是它们的名字所说的：写入和读取。两者都不调用 `docker run`、`docker stop`、Docker Engine API 或任何 Docker 客户端——产品代码中不存在 Docker 客户端。真正的编排器存在时，是它来**消费**这张表：先对守护进程采取行动，然后才调用 `RegistrarTransicaoDeContainerUseCase` 记录发生了什么——绝不反过来，理由与 `TransitionSessionUseCase.activate` 在写入 `active` **之前**调用 engine 相同：表不应在某样东西没有运行时说它在运行。

### 与 workspace 模式的一致性（ADR 0072） {#coerência-com-o-modo-do-workspace-adr-0072}

`workspace_mode: 'local'` 的项目不启动容器——它在一贯的 **agent** 容器中运行，只是目录变了（RN-169）。为 `local` 项目请求转换会在触及表之前以 400 拒绝：一致性不是"表允许任何项目处于任何状态，UI 之后再过滤"，而是用例在源头拒绝。

### 没有新的 HTTP 路由 {#nenhuma-rota-http-nova}

Onda 4 中还没有任何东西通过 HTTP 消费这张表——交互式终端（25b/Onda 5）是明显的候选，而在确切知道它需要读什么之前决定路由的形式，就是在猜测契约。两个用例对容器模块暴露，一旦有真实使用者就可以接上路由。

## 后果 {#consequências}

**开始存在的东西。** 一个唯一且经过测试的地方，用来回答"这个项目的容器处于什么状态"并记录一次经过校验的转换——这是**任何**将来编排器的前提，没有它，编排器要么得发明自己的状态存储，要么得重新打开这个决定。

**保持原样的东西——不打折扣。** 终端策略中"在里面 agent 是自由的"那一半，ADR 0065 已经说它没有改变，现在**仍然**没有改变。ADR 0055（路径作用域、狭窄的白名单）逐字继续有效。这张表中一个 `running` 的容器不会改变终端允许执行什么，因为今天没有任何终端命令被路由到由它管理的容器内部——表和命令执行是两个尚未相互接触的系统。Z 和 AD 发现（动词白名单不收敛）仍因一贯的原因保持开放：关闭它们需要物理隔墙（一个隔离执行的真实编排器），而不是一张描述隔墙意图的表。

**声明而不隐藏的东西。** 今天没有任何进程会自行转换这张表——目前每一次转换都是外部的（测试，或一次手动调用）。这是预期的：表在使用者之前诞生，而不是之后。真正的编排器被设计的那一天——权限受限的 sidecar、独立的守护进程或其他形式——是一个独立的安全决定，要让用户知道授予的是什么，正如 ADR 0065 已对网络和资源所要求的。本文档既不预先作出它，也不走捷径。

## 考虑过的替代方案 {#alternativas-consideradas}

**在 api 或 engine 中挂载 `/var/run/docker.sock`，在这一切片中就"让它真正工作"。** 以最直接的论据拒绝：这是一个安全决定（已知的提权到主机 root 的途径），在这一切片中没有人要求，而为了让一张表"看起来完整"而顺手作出它，正是 FASE 13 已经点名的错误——不是放宽动词白名单，但属于同一类捷径：用保证换方便来获得功能。

**现在不建表，等编排器设计好。** 以 ADR 0065 自己给出的理由拒绝：迁移名额稀缺（每波一个），而表是任何编排器设计的前提而非附件——在没有地方写状态的情况下设计编排器，之后会在一个真实使用者等待的压力下产出同一张表。

**把状态作为 event log 中的第二种事件（`container.status_changed`）保存，而不是表。** 以把它与 `artifact.project_image` 区分开的同一论据拒绝：这是**状态**（每次一个值），不是历史**事实**。每次读取都从事件投影出"当前状态"，会在 event log 之上重新实现一张表，付出间接的代价却一无所得——这与 ADR 0065 的"Alternativas consideradas"在推迟这张表时已经记录的结论相同。

## 参考 {#referências}

- [ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md) — 镜像决定和关口，本文档不重复，只引用。
- [ADR 0055](0055-escopo-de-caminho-na-politica-de-terminal.md) — **继续**按原样有效的终端策略；这里没有任何一行改变。
- [ADR 0072](0072-projeto-local-ou-container.md) — `workspace_mode`，决定项目是否有容器生命周期。
- [ADR 0045](0045-reagendamento-por-evento-do-dev-agent.md) — 持久化的状态机（`dev_agent_states`），其设计（每个 agent 一行，`status` 在列之外校验）被本表在容器上镜像。
- [RN-105](../business-rules/autenticacao.md#rn-105), [RN-169](../business-rules/autenticacao.md#rn-169),
  [RN-243](../business-rules.md#rn-243)–[RN-248](../business-rules.md#rn-248).
- `docs/explanation/achados-execucao-real.md` — Z 和 AD 发现，本文档明确**不**关闭它们。
- `apps/api/src/domain/containers/container-lifecycle.ts`、`apps/api/src/application/use-cases/containers/registrar-transicao-de-container.use-case.ts`、`apps/api/src/application/use-cases/containers/obter-ciclo-de-vida-do-container.use-case.ts`、`apps/api/src/db/migrations/0046_chilly_forgotten_one.sql`。
