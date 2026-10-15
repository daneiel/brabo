---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0152 — 针对 compose 的卷备份与恢复

## 状态 {#status}

**已提议。** 它之所以存在，是因为 [FASE 29](../explanation/fase-29-instalacao-de-uma-linha.md) 需要迁移之前的安装，而文档为此指出的路径并不适用。

## 背景 {#context}

当前的备份覆盖**一个**数据库，在**一个**地方运行：

- `docker/backup/backup.sh` 执行 `pg_dump --format=custom | aws s3 cp -`（`:124-140`），直接送到 S3 而不落盘，按数量保留（`:160-182`），并在每次执行时在 `backup_runs` 中写一行，无论成功还是失败（`trap registrar EXIT`，`:44-80`）。
- `docker/backup/restore.sh` 恢复到一个**测试**数据库（`brabo_restore_test`，`:18`），验证三件事——表的列表、备份窗口内关键表的计数，以及 `session_events` 的 `seq` 的密集连续性（`:139-224`）——并且**从不触碰源**（`:8-9`）。
- `make test-restore` → `deploy/k8s/test-restore.sh`，它需要 `kubectl`、一个集群以及命名空间中的 CronJob `brabo-backup`（`:56-58`）。

三个后果，都已测得：

1. **通过 compose 的安装的迁移没有路径。** `test-restore` 是 Kubernetes；没有针对 compose 的等价目标，而 `docker-compose.prod.yml` **没有 `backup` 服务**（镜像由 bake 构建，只在 k8s 中使用）。
2. **备份只覆盖 Postgres。** `docker/backup/` 中没有任何东西触及 `neo4j_data`、`git_local_repos`、`project_workspaces`、`ollama_data` 或 `brabo_projects_base`（`docker-compose.prod.yml:474-486`）。
3. 它还要求 **S3**——五个必需变量（`backup.sh:11-15`）。在单机安装中，为了能够迁移而要求一个 bucket，就是要求安装程序刚刚说过不需要的基础设施。

## 决策 {#decision}

### 1. 在复制之前对卷进行分类 {#1-classificar-os-volumes-antes-de-copiá-los}

容易犯的错误是“备份所有的卷”。这七个不是同一种东西，同等对待它们会浪费空间并掩盖重要的东西：

| 卷 | 性质 | 决定 |
|---|---|---|
| `pgdata` | **事实来源**——事件日志、动作，一切 | 已被 `pg_dump` 覆盖；继续是逻辑转储，而不是文件复制 |
| `git_local_repos` | **事实来源**——`LocalGitProvider` 的 bare repo | **纳入**，这是本 ADR 的发现 |
| `neo4j_data` | **派生**——图是从事件日志投影的记忆（[ADR 0099](0099-neo4j-grafo-de-conhecimento-e-templates.md)），绝不是事实来源 | **不纳入**：缺的是**重新投影**，而不是备份 |
| `project_workspaces` | **派生**——`WorktreeManager` 从 bare 重新创建的 worktree | 不纳入 |
| `ollama_data` | **可重新获取**——可以再次下载的模型 | 不纳入 |
| `brabo_projects_base` | **属于用户**，不属于产品 | 不纳入，安装程序也从不删除它（[ADR 0150](0150-instalador-de-uma-linha.md)） |

**`git_local_repos` 是真正的漏洞。** provider 为 `local` 的项目的 *bare* 仓库就在里面；失去这个卷就是失去 agent 产出的代码，而今天**没有任何备份**覆盖它。它不能从 Postgres 重建——事件日志保存的是叙述，而不是 git 的对象。

### 2. 本地目的地，S3 可选 {#2-destino-local-s3-opcional}

备份开始接受 S3 之外的**磁盘目的地**。在单机安装中，一个目录是诚实的目的地；为了迁移而要求 bucket，就是要求安装程序不需要的基础设施。

五个 S3 变量不再是必需的，而成为它们在实践中本来就是的东西：**其中一个**目的地的配置。

### 3. 一条针对 compose 运行的恢复路径 {#3-um-caminho-de-restore-que-roda-contra-compose}

**没有集群**的 `test-restore` 等价物诞生了：用 `docker compose run` 启动备份镜像，恢复到测试数据库，并运行 `restore.sh:139-224` 的**相同三项验证**。没有任何新的验证逻辑——改变的是外壳，而不是判断。

`deploy/k8s/test-restore.sh` 保持**不变**：这是两个环境的两个外壳，统一它们会让 compose 那个依赖 `kubectl`。

### 4. 图的重新投影是 Neo4j 的答案 {#4-a-reprojeção-do-grafo-é-a-resposta-para-o-neo4j}

从备份恢复 `neo4j_data` 会在一个恢复到另一时间点的 Postgres 旁边恢复一个可能过时的投影——两个派生自不同时刻的状态，没有任何东西调和它们。对派生记忆的正确答案是从来源重新投影。

本阶段**不构建**重新投影：它声明这是路径，并且在它存在之前，迁移后的安装以**空**图诞生——这是已知的降级（RAG 仍在 pgvector 中，它存在于 Postgres 中并随转储而来），而不是数据丢失。

### 5. 安装程序使用这一点，而不是猜测 {#5-o-instalador-usa-isto-e-não-adivinha}

ADR 0150 的迁移路径是：**备份 → 确认 → 删除 → 安装 → 恢复**，恢复由决策 3 证明。没有好的备份，安装程序**不**进入删除步骤。

## 本 ADR 明确拒绝的内容 {#o-que-este-adr-recusa-explicitamente}

- **复制所有的卷。** 按决策 1：七个中有三个是派生的或可重新获取的，复制它们给人覆盖的印象，却不增加可恢复性。
- **`pgdata` 的文件复制。** 复制运行中的 Postgres 的数据目录会产生一个可能无法恢复的备份；逻辑转储继续。
- **恢复 `neo4j_data`。** 按决策 4。
- **针对源数据库做恢复。** `restore.sh` 从不触碰源（`:8-9`），这一属性不会为了迁移的方便而让步。
- **与 `deploy/k8s/test-restore.sh` 统一。**

## 后果 {#consequences}

- 现有安装的迁移开始有**已证明**的路径，安装程序也获得了删除卷的权利——因为它证明了自己能把它们带回来。
- **`git_local_repos` 进入备份**，这是本 ADR 在安装范围之外带来的不同：今天该卷的任何丢失就是代码的丢失，在任何环境中都是，而之前没有人记录过。
- 迁移后的安装在重新投影存在之前以**空图**诞生。已声明，并点名了影响：依赖图的读取会降级；RAG 不受影响。
- 备份获得第二个目的地，随之也有第二条失败路径——磁盘满。在两种情况下，`backup_runs` 中的行继续由已存在的 `trap` 写入。
