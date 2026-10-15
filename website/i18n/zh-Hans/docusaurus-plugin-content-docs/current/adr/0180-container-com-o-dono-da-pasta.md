---
traducao_de: 8f0223952822af7ecfc40540dfed2f87c0ecda61
---

# ADR 0180 — 项目容器以文件夹所有者身份运行，由 api 测量

## 状态 {#status}

**已接受。** 2026-09-29（AT-247，故事 HS-071，史诗 EP-030，第 27 轮）。基于 [ADR 0130](0130-broker-de-container.md)（broker、五层隔离以及**计算得出**的规格）和 [ADR 0144](0144-a-segunda-raiz-do-broker.md)（broker 服务 `mounted`）。不编辑它们：**在规格中增加一个字段**，并说明为什么它不打开任何口子。

## 背景 {#context}

在 2026-09-29 的真实使用中测得：某个项目容器的 `docker inspect` 显示 `User=` 为空（root）和 `CapDrop=[ALL]`。挂载在 `/work` 的项目文件夹是运维者 uid（1000）的 `755`。**没有** `CAP_DAC_OVERRIDE` 的 root 不能写入其他 uid 的文件夹，而 `--cap-drop ALL` 恰恰拿走了这个能力。结果：`npm install` 在所有 dev agent 和 QA 自动化中都报 `EACCES`；只有 `write_file` 能用，因为它通过 engine 进程在**主机**上、容器之外写入。

在真实 Docker 中重现（`node:22-bookworm-slim`、`--cap-drop ALL`、uid 1000 的 `755` 文件夹）：以 root 执行 `touch` 得到 `Permission denied`；用 `--user 1000:1000` 则可以写。用一个在 `/etc/passwd` 中没有条目的 uid 时，`HOME` 是 `/`，`npm` 在 `//.npm` 处死掉。

`DockerPort` 有五个操作，绑定是**一个**标记了类型的文件夹，而该类型没有 `privileged`/`cap_add`/自由的 `-v`（ADR 0130）。任何修复都必须在这个范围内。

## 决策 {#decision}

1. `EspecificacaoDeContainer` 增加 `usuario?: { uid, gid }`。CLI 适配器把它转换为 `--user <uid>:<gid>` 和 `--env HOME=/tmp`（常量：没有 passwd 的 uid 会得到 `HOME=/`）。没有 `usuario` 时，`run` 逐字节与之前相同。
2. **由 api 测量**，因为它能到达该文件夹（按身份挂载的基础目录，或受管根目录）：`GET /internal/projects/:id/container-spec` 改为返回 `usuarioDaPasta`（文件夹的 `stat`；如果无法测量、项目是 `runner` 或所有者是 root，则为 `null`）。broker 从**这个**上下文组成 `usuario`——绝不从请求体：`start` 没有请求体，`pedidoDeExecValidado` 会忽略任何额外字段。
3. broker **重新校验**（`usuarioValidado`）：整数在 1..2^31-1 之间，`0` 被拒绝并点名该字段。root 是**缺省**；显式的 `--user 0` 会是一次无人决定的放宽。
4. `exec` **不增加字段**：`docker exec` 继承容器的用户。
5. 适用于 `container` 和 `mounted`（api 测量各自挂载的文件夹）；`runner` 模式不经过 broker，不变。

## 后果 {#consequences}

- **不打开隔离的口子。** 进程对主机的权力比以前**更少**（非 root 而不是 root），`--cap-drop ALL` 仍然存在，也没有调用方可以写入用户、能力、挂载或网络的字段。
- 考虑过的第二个选项——还回 `DAC_OVERRIDE`/`CHOWN`/`FOWNER`——被**拒绝**：它放宽了 ADR 0130 固定的隔离，并且保留 root。
- 第三个选项——由 broker 自己做 `stat`——需要把项目文件夹挂载到 broker 中（目前它只有 socket）——在一个等同 root 的进程中增加更多攻击面。api 已经能到达它们。
- 对运维者**不是** BREAKING：不可读或属于 root 的文件夹会回落到“和以前一样”。**已经**创建的容器在重建之前不会改变（`--user` 属于 `run`）；下一次 `container_start` 就会正确启动。
- 文件夹所有者 ≠ dev agent 应有的身份，这不是产品会做的区分：目标是在运维者已经能写的地方写入。
- **未测量：** Docker Desktop（macOS/Windows），那里 bind-mount 的 uid 映射不同；Docker rootless；带 `root_squash` 的 NFS 上的文件夹。
