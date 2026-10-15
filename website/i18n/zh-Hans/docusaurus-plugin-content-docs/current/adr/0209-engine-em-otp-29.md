---
traducao_de: 660c5d03bfdbd1589e922ea13f2e31c74ea9a13a
---

# ADR 0209 — engine 升级到 Elixir 1.20.4 / OTP 29.1.1

## 状态 {#status}

**已接受。** 2026-10-02（AT-398；所有者于 10月2日的决定，“subir o engine para OTP 29.1.x”）。更换 [ADR 0024](0024-fase5-imagens-producao-ci.md) 中固定的运行时（决策 10：Dockerfile 和 CI 中使用相同的 Elixir 版本），但不编辑它——**单一**版本的规则仍然有效，改变的是版本本身。

## 背景 {#context}

自 AT-361 起，engine 的 `Dockerfile.prod` 运行在 Alpine 3.24.2 与 OTP 27.3.4.18 之上（hexpm 不在 3.24 上发布 27.1.2），而开发和 CI 停留在 Elixir 1.17.3 / OTP 27.1.2 / Alpine 3.20.3。CI 中 engine 的构建开始在约 10% 的运行中中止（#821 之前 0/57，之后 5/49），报错：

```
sys_signal_stack.c:101:sys_sigaltstack(): Internal error
```

测得的原因：Alpine 3.24 的 musl 1.2.6 在带 AMX 的主机上拒绝 ERTS 27 请求的固定大小的信号备用栈（`SIGSTKSZ` = 8192）（erlang/otp#11349）。修复——按 `sysconf(_SC_MINSIGSTKSZ)` 确定大小（提交 `3a94587176`/`fc35c2496c`）——**只**从 OTP 29.1 开始存在。同样的缺陷会让**生产**中的 engine 在带 AMX 的服务器上启动即死：CI 的间歇性失败只是机器抽签的结果。

把 Alpine 退回 3.22 可以消除症状，但会把镜像冻结在一条不再获得安全修复的线上；未予采纳。

## 决策 {#decision}

1. engine 在开发、生产和 CI 中运行 **Elixir 1.20.4 / OTP 29.1.1**。镜像是 `hexpm/elixir:1.20.4-erlang-29.1.1-alpine-3.24.2`，按**索引**的 digest 固定（`sha256:ad851f40…`，ADR 0159/0178），在 `Dockerfile.prod` 的 builder 和开发用 `Dockerfile` 中是**同一个**。生产运行时仍是 `alpine:3.24.2`（builder 的 musl 与运行时的一致）。Elixir 1.20 是唯一一条有 hexpm 针对 OTP 29.1 的镜像和构建的版本线。
2. `ELIXIR_VERSION`/`OTP_VERSION` 在声明它们的三个工作流（`ci.yml`、`golden-set-rag.yml`、`golden-set-qa.yml`）中一起升级，`mix.exs` 改为要求 `~> 1.20`。
3. “Build, scan e smoke” 作业会打印主机是否有 AMX（`grep -c amx_tile /proc/cpuinfo`）：在带 AMX 的主机上为绿，就证明缺陷没有回来，而不是抽签的运气。
4. `mix.lock` 中的依赖没有任何变化：`mix deps.get` + `mix compile --warnings-as-errors` 在新版本上通过。Elixir 1.20 的类型检查器指出了 `Engine.Agents.FilaDeMensagens.acordar/3` 中的一个死子句——启动 agent 失败会**抛出**，而不是作为值返回——它通过按 agent 容纳错误得到修正，而不是被静默。

## 后果 {#consequences}

- **开发的代价：** engine 的 `_build`/`deps` 卷是用 OTP 27 编译的。Mix 会自动重新编译用其他 Elixir 版本构建的内容，所以 `docker compose up -d --build engine` 就够了；如果卷坚持保留旧产物，就对 engine 的两个卷执行 `docker volume rm`。由于是自动重编译，该变更对运维者**不是** breaking。
- 在 Docker 之外运行 engine 的人需要 Elixir 1.20.4 / OTP 29.1.1（`mix format --check-formatted` 取决于版本，ADR 0024 决策 10）。
- Dependabot `docker`：有了 OTP 29.1 + Alpine 3.24，不再有坏掉的组合，也没有添加任何 `ignore`。它可能提议更新的 OTP 29.1.x 的 `hexpm/elixir` tag——它们都包含该修复。一个把版本**降**到 OTP < 29.1 且 Alpine ≥ 3.24 的提议会重新引入缺陷，应在评审中拒绝。
- Kubernetes 中的滚动发布会短暂地混合 OTP 27 和 29 的节点：Erlang 分布式接受相差两个大版本的节点对。
