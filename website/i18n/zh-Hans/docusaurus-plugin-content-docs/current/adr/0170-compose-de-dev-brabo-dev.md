---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0170 — 开发用 compose 改名为 `brabo-dev`，开发环境拒绝在安装旁边启动

## 状态 {#status}

**已接受。** 维护者于 2026-09-27 的决定（AT-173）：“两者都要”——开发用的专有名称**以及**守卫。引用 [ADR 0150](0150-instalador-de-uma-linha.md)（安装 compose，它诞生时声称与开发用的 `name` 不同）和 [ADR 0152](0152-backup-de-volumes-contra-compose.md)（重要的卷）。两者都不编辑。

## 背景 {#context}

2026-09-19 测得：`docker/docker-compose.yml`（开发）和 `docker/docker-compose.install.yml` 都声明了 `name: brabo`。安装 compose 的注释说的恰恰相反——*"`name` diferente
do compose de dev de propósito: os dois podem coexistir na mesma máquina"*——而这并不属实。对 Docker 而言，一台既有安装**又**有 checkout 的机器只有**一个**项目：容器（`brabo-api-1`、`brabo-postgres-1`……）、网络（`brabo_default`）以及同名的卷（`brabo_pgdata`、`brabo_neo4j_data`、`brabo_git_local_repos`、`brabo_project_workspaces`……）都是同一套。

三个后果，第一个已测得：

- 在一个 compose 上启动另一个，会**重建**另一个的容器并把它们连到对方的数据库——一个安装的数据库接收了开发的迁移；
- `scripts/dev/reset-total.sh` 在 `brabo` 项目的 Postgres 中执行 `DROP SCHEMA … CASCADE`——也就是说，它会删除安装的数据库；
- 其中一个的 `docker compose down` 会把另一个也关掉。

**生产** compose（`docker-compose.prod.yml`）本来就是 `brabo-prod`，不在此讨论之列。

## 决策 {#decision}

**1. 开发 compose 改名为 `brabo-dev`。** 容器 `brabo-dev-<serviço>-1`，网络 `brabo-dev_default`，卷 `brabo-dev_<chave>`。可观测性 overlay（`docker-compose.observability.yml`）重复这个名称，因为**最后一个** `-f` 的 `name:` 胜出，那里的不同值会把整个栈移到另一个项目；它的 Alloy 按 `com.docker.compose.project=brabo-dev` 过滤。

**安装的**仍然是 `brabo`。这是已有安装使用的名称，更改它会在下一次更新时让每个安装与自己的卷断开——代价会落在从未读过这个仓库的人身上。改名的是开发者这一边，他们读 CHANGELOG，也有 runbook。

**2. 守卫，在 `preflight.mjs` 和 `reset-total.sh` 中。** 当机器上存在任何状态（`docker ps -a`）的容器，其标签 `com.docker.compose.project.config_files` 指向**安装** compose（`docker-compose.install.yml`，或资产名 `brabo-install-compose.yml`）时，两者都会**拒绝**，并点名找到的容器以及每个文件的 `down`（不带 `-v`）。并且当开发 compose 按脚本的调用方式会解析为项目 `brabo`（`.env` 或环境中的 `COMPOSE_PROJECT_NAME=brabo`）时也拒绝。在 reset 中，守卫是**第一**步，甚至在 preflight 之前，拒绝以 `RESET NÃO COMEÇOU` 输出。

标准是标签中的**文件**，而不是项目名称：安装在任何 `-p` 下都能被识别，正是这一点让守卫对名称解决不了的情况有用——手动用 `-p brabo` 启动的开发 compose、`COMPOSE_PROJECT_NAME`，以及带 `name: brabo` 的旧 checkout（它没有这个守卫，但**新**的 checkout 会拒绝继续它造成的事故）。

这把尺子存在于**两个**地方，JS（`scripts/dev/instalacao-na-maquina.mjs`）和 bash（`scripts/dev/reset-total-lib.sh` 中的 `recusar_se_ha_instalacao`），因为 reset 的 spec 在 PATH 中使用一个假的 `node` 运行，需要证明脚本本身会拒绝。两者都由旁边的 spec 演练。

不响应的 Docker **不会**导致拒绝：preflight 说明守卫没有运行并继续（没有 Docker，`up` 什么也启动不了），而在 reset 中，在第一个效果之前的 `build` 同样会失败。

**3. 已经在开发的人的迁移：提示，绝不拒绝，绝不删除。** 下一次 `pnpm dev` 会创建**空**的 `brabo-dev_*` 卷；数据仍在 `brabo_*` 中。当 preflight 发现带有**只有**开发 compose 才声明的键（`*_node_modules`、`engine_build`/`deps`/`mix`/`hex`）的 `brabo_*` 卷时会**提示**——这个列表从两个 compose 文件**派生**，绝不复制——并且在不断言其归属的情况下，把两者共有的键（`pgdata`、`neo4j_data`、`git_local_repos`、`project_workspaces`……）分开列出，它们可能属于某个安装。复制（逐个卷，`cp -a`，Postgres 停止时）或重新开始的步骤在 runbook 的 “Moving a dev environment to brabo-dev” 中。没有任何脚本删除卷。

## 后果 {#consequences}

- **开发者只需操作一次**（所以分支是 `breaking/`）：在**不带** `-v` 的情况下关闭旧栈（`docker compose -p brabo -f docker/docker-compose.yml
  down`），并选择复制数据或重新开始。在完成之前，旧 compose 占着端口，preflight 会准确地说明这一点，而不是给出 `port is already allocated`。
- **在有安装的机器上开发，开始需要先关闭安装**（不带 `-v` 的 `down`：卷和数据保留，`up -d` 会把它带回来）。这是按**存在**设防的声明代价，由维护者选择：分开的名称已经让常见情况下的共存变得安全，但守卫恰恰是为不常见的情况而存在的——一个只看名称冲突的守卫会放过旧 checkout 以及安装停止时手动的 `-p`。**同时**运行两者无论如何仍然不可能：它们发布相同的端口。
- 仅凭自身，无法区分带共有键的孤立 `brabo_*` 卷属于旧的开发环境还是安装——提示会说明这一点，而不是断言。runbook 教人如何询问（容器的 `config_files`、独有的键、机器上是否有过安装）。
- 在**开发**语境中引用 `brabo-api-1`、`brabo-postgres-1`、`brabo-ollama-1`、`brabo_pgdata`……的文档和命令，改为引用 `brabo-dev-*`。谈论**安装**的那些（`install.sh` 测量的卷 `brabo_project_workspaces`、安装中 broker 的根）保持原样，因为它们仍然属实。历史叙述（旧的 CHANGELOG、已接受的 RN 和 ADR）不被重写。
- 本地 Prometheus 的 `pod` 标签改为 `brabo-dev-api-1`/`brabo-dev-engine-1`，即容器的真实名称；没有任何仪表盘按 `pod` 的值过滤，只是分组。
