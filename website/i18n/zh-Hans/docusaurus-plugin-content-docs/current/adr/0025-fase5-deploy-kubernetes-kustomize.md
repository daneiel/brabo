---
traducao_de: 5caf47d7db6498d5fe8053e4452379fd992e8c0b
---

# ADR 0025 — 阶段 5（第 2 次会话）：使用 Kustomize 部署 Kubernetes、队列指标与本地 overlay

- 状态：已接受
- 日期：2026-07-26
- 阶段：5（第 2 次会话——范围第 3 项，外加 HPA 所需的指标）
- 继承：[ADR 0024](0024-fase5-imagens-producao-ci.md)，它交付了生产镜像和 CI，并记录了五个
  限制——其中第一个（“`VITE_*` 是编译期的；解决它是下一次会话 Kubernetes 的前提”）在这里
  得到解决。

## 背景 {#contexto}

第 1 次会话之后，三个镜像已有生产路径，CI 也在执行它，但**没有任何部署产物**：没有
manifest，没有 chart，也没有 `docs/runbooks/`。阶段 5 的第 3 项要求在 Kubernetes 上部署，
engine 的 HPA 按 Oban 队列深度伸缩，验收标准是可执行的——`make deploy-local` 在一个干净的
集群上结束时所有 pod 都 Ready，smoke 通过，人为填满队列会触发 HPA。

难的部分不是写 YAML。而是**把 engine 扩展到多于一个副本，是阶段 1–4 的代码所不支持的操作**，
下面五个障碍中有三个之所以存在，只是因为本次会话引入了 HPA。

## 决策 {#decisões}

### 1. Kustomize base+overlays，而不是 Helm {#1-kustomize-baseoverlays-não-helm}

对需求中所要求的标准逐一作答：

- **所需的模板化**：低。我们自己的组件有四个，没有条件、没有循环、没有 sub-chart。各环境之间
  变化的是值（URL、StorageClass、副本数、CIDR），而不是结构。一门模板语言是在为用不到的灵活性
  付费。
- **按环境的 overlay**：这是 Kustomize 的原生形式，而且 overlay 是合法的 YAML——
  `kubectl apply --dry-run=server` 和 `kubeconform` 在集群存在之前就能检查它们。Helm 的
  `values.yaml` 只有在渲染之后才变成 YAML；审查 values 的 diff 是在审查输入，而不是结果。
- **升级体验**：`kubectl apply -k` 加上按 workload 的 `kubectl rollout undo`，以 git 作为事实
  来源。我们有意放弃了 `helm
  rollback` 和 release 的概念：作为交换，不存在会与仓库产生分歧的 release 状态，而那是多人
  操作 Helm 时最常见的失败模式。

**第三方组件继续通过 Helm 安装。** External Secrets Operator、CloudNativePG、Prometheus、
prometheus-adapter 和 metrics-server 由 `deploy/k8s/bootstrap.sh` 用
`helm upgrade --install` 安装，版本固定在 `deploy/k8s/helm/charts.env` 中。用 Kustomize 重写
它们等于维护上游 manifest 的一个 fork——纯粹的工作而没有收益。分工是：**operator 用 Helm，
应用用 Kustomize。**

### 2. engine 是 Deployment，不是 StatefulSet {#2-engine-é-deployment-não-statefulset}

StatefulSet 提供两样东西，这里一样都用不上：

**每副本一个 PVC 会是明确的错误。** dev agent 的 worktree 位于
`<PROJECT_WORKSPACES_ROOT>/<project_id>/.worktrees/<agent_id>`，在**api 挂载的同一个卷**
中——api 创建 bare repo，把绝对路径写入 Postgres，engine 从数据库读取这个路径并在 `git push`
中原样使用（ADR 0024，决策 5）。给每个副本各自的卷会打破 push 所依赖的路径一致性。worktree
不是每个副本的状态：它是项目的状态，由 workspace 锁守护（ADR 0017）。

**不需要稳定的网络标识。** HTTP 流量经由 Service 进入，Service 做负载均衡；而 `DNSCluster`
通过一个 headless Service（`engine-headless`）发现对等节点，这在 Deployment 上同样可行。

后果：共享的 PVC 是 **ReadWriteMany**。这不是偏好，而是要求——api 和 engine 写同一个卷，并且
可能落在不同的节点上。

### 3. prometheus-adapter，而不是 KEDA {#3-prometheus-adapter-não-keda}

保留 Kubernetes 原生的 HPA，少一个 operator。代价是真实的：一条 discovery 规则
（`deploy/k8s/helm/prometheus-adapter-values.yaml`）和一个聚合的 APIService，后者是整个
安排中最脆弱的部分。

让代价可以接受的是测试：**adapter 的失败模式是无声的。** 如果规则不匹配，HPA 停在
`<unknown>`，干脆不伸缩，而 pod Ready、其他一切都是绿的。因此 `deploy/k8s/smoke.sh` 不信任
HPA——它直接查询 `external.metrics.k8s.io`，如果它不提供该指标就失败。

### 4. 五个必须在代码中修复的障碍 {#4-cinco-impedimentos-que-precisaram-ser-corrigidos-no-código}

这些不是对阶段 1–4 的可选重构。它们是“YAML 能 apply”与“系统能工作”之间的差别，其中三个只
因 HPA 而存在。

#### 4.1. `force_ssl` 重定向了探针 {#41-force_ssl-redirecionava-as-probes}

`apps/engine/config/prod.exs` 在 `force_ssl` 的排除列表中把 `paths: ["/health"]`
**注释掉了**。kubelet 通过 **pod 的 IP** 调用探针，而不是通过 `localhost`，因此按主机的排除
覆盖不到它：`/live` 和 `/ready` 会对 `https://` 返回 **301**，pod 永远不会 Ready。整个部署
会卡在一行被注释的代码上。

#### 4.2. worktree 清理删掉了另一个副本的活跃工作 {#42-a-poda-de-worktree-apagava-trabalho-vivo-de-outra-réplica}

`Engine.Dev.WorktreeCleanup.live_agents/1` 查询的是 `Engine.Dev.Registry`，它是**节点
本地的**。engine 只有单副本时，“在 Registry 中存活”和“存活”是同义词。当卷在副本之间共享时，
副本 A 扫描副本 B 的 agent 的 worktree，在自己的 Registry 中找不到它们，于是**把它们当作孤儿
删除**——而 dev agent 还在往里写。

修复：事实来源改为 `dev_agent_states`，它在构造上就是全局的（重新水合正是从它开始），且在
agent 结束时删除对应行。这个集合在单节点上等价，在 N 个节点上是正确的。

#### 4.3. `Engine.Sessions.Monitor` 在任何 `:DOWN` 时都删除 `session_states` {#43-enginesessionsmonitor-apagava-session_states-em-qualquer-down}

`Engine.Dev.Monitor` 已经区分节点关闭与 agent 结束（`forget?/1`）；会话的 monitor 却没有。
而且后果比竞态更糟：由于监督树的关闭顺序会在 Monitor **之前**关掉 `SessionSupervisor`，
Monitor 会存活下来处理每个 `:DOWN`，删除所有活跃会话**并把它们以 `closed_abnormally`
报告给 api**。每次 rollout 和每次缩容都会恰恰把健康的会话标记为异常。

修复不是照抄 `Dev.Monitor`：那里 `{:shutdown, _}` 总是意味着节点关闭，这里
`{:shutdown, :heartbeat_timeout}` 是合法的结束，对应行**必须**删除，否则会话会永远重新水合。

#### 4.4. 没有 Erlang 集群时 `:global.trans` 什么也串行化不了 {#44-globaltrans-sem-cluster-erlang-não-serializa-nada}

`Engine.Actions.Workspace.ensure!` 用 `:global.trans` 按项目串行化 workspace 的初始化，而它
只有在节点组成集群时才是全局的。没有集群，两个副本会在共享卷的同一个目录中并发执行
`git init`。`DNSCluster` 自阶段 1 起就在监督树中，由 `DNS_CLUSTER_QUERY` 控制——缺的是让它
指向 headless Service，并固定分布式的端口（`inet_dist_listen_min/max`），以便 NetworkPolicy
可以放行它。

#### 4.5. web 的 URL 是编译期的 {#45-as-urls-da-web-eram-compile-time}

ADR 0024 中记录的债务。Vite 把 `import.meta.env.VITE_*` 内联到 bundle 中，因此每个环境都需要
自己的镜像——这与晋升通过 CI 的那个产物正相反。现在 nginx 的 entrypoint 根据容器的环境生成
`/config.js`，`apps/web/src/lib/runtime-config.ts` 读取它，并保留 `VITE_*` 作为
`pnpm dev:web` 的回退，那里没有 nginx。

决定实现方式的两个细节：

- `config.js` 的 `Cache-Control: no-store` 放在 `map $uri` 中，**绝不**放在子块的
  `add_header` 中——这是 ADR 0024 决策 7 记录的 nginx 陷阱（子块中的 `add_header` 会丢弃所有
  继承的 header）。
- 空值视为缺失。`envsubst` 对未定义的变量写入 `""`，而在 JavaScript 中 `'' ?? default` 是
  `''`：没有这个处理，ConfigMap 中缺一个键就会让应用指向空的源，并以一个对原因只字不提的
  CORS 错误失败。

### 5. 探针：三个不同的问题 {#5-probes-três-perguntas-diferentes}

两个服务中原本只有一个 `/health`，而它会查询数据库。这对 readiness 是对的，对 liveness 是
**错的**：在 Postgres 变慢时，绑定数据库的 liveness 会同时重启所有副本——降级变成完全宕机，
而执行者正是 kubelet 自己。

| | startup | liveness | readiness |
|---|---|---|---|
| api | `/live` | `/live` | `/health`（数据库） |
| engine | `/live`，宽窗口 | `/live` | `/ready`（数据库 + 重新水合） |
| web | `/healthz` | `/healthz` | `/healthz` |
| keycloak | `:9000/health/started` | `:9000/health/live` | `:9000/health/ready` |

**“只有在重新水合之后才 Ready”不再是一种涌现的性质。** 这个保证原本就存在，但是隐式的：两个
重新水合器在监督树中位于 `Endpoint` 之前，而 `Supervisor.start_link/2` 是顺序的。这在 Docker
中足够；在 Kubernetes 中不够，因为探针需要**区分**“仍在重新水合”与“就绪”，而没有可观察的
信号时，唯一的差别就是端口关闭——kubelet 会把它读作 pod 已死。现在 `Engine.Readiness` 在
`:persistent_term` 中标记每个阶段，`/ready` 读取它，这也让这条规则变得可测试，而不是依赖一个
任何未来的重新排序都会悄无声息地打破的顺序。

### 6. 指标：`oban_queue_depth`，按 `state` 划分维度 {#6-a-métrica-oban_queue_depth-dimensionada-por-state}

通过 `telemetry_metrics_prometheus_core` 在 engine 的 `/metrics` 上暴露——只有聚合器加上
`scrape/1`，由已有的 router 提供。PromEx 会带来自己的 plug 和 HTTP 服务器，外加一个 Grafana
仪表盘上传器，那是第 5 项的工作。

测量是对 `engine.oban_jobs` 的 SQL 聚合，而不是 `Oban.check_queue/1`：后者返回的是**本地**
生产者的状态，而 HPA 的问题是整个集群中有多少工作在等待——这是表的属性，而不是节点的属性。

**过滤条件 `state="available"` 是必须的。** 三个 worker 会自我重新调度
（`OutboxDrainWorker` 每 2s，`WorktreeCleanupWorker` 每 60s，
`AnamneseSchedulerWorker`），插入自己的后继者：在正常状态下这张表**从来**不空，总有处于
`scheduled` 的 job。一个统计整张表的 HPA 会把空闲的系统读作饱和，并让 engine 永远保持在最大
副本数。

该指标还会**显式地归零**已经清空的队列。没有这一点，gauge 会变得黏滞：一个排空的队列从查询中
消失，Prometheus 继续提供最后的值，HPA 会为并不存在的积压维持副本。

### 7. 网络：需求中的列表是不完整的 {#7-rede-a-lista-do-enunciado-está-incompleta}

范围要求“web→api、api→db、engine→api、engine→db；别无其他”。照字面应用，这份列表会让系统
运行着却是坏的。我们实现了 ingress 和 egress 的 `default-deny`，外加**恰好系统所使用的
流量**，即：

| 流量 | 为什么在这里 |
|---|---|
| api → keycloak | 创建会话需要 client-credentials token。**列表中缺失** |
| api → engine | 创建会话通过内部 HTTP 调用 engine。**列表中缺失** |
| engine → keycloak | 根据 JWKS 校验收到的 token |
| engine → api | 写入事件、创建任务、报告结束 |
| engine ↔ engine | Erlang 分布式（见 4.4） |
| prometheus → engine:4000 | **没有它 HPA 永远收不到指标** |
| 全部 → kube-dns | 没有 DNS 什么都解析不了，其余都无关紧要 |
| api/engine → db | 按标签 `brabo.dev/role: database`；在 prod 中按 `ipBlock` |

而 `web→api` **不是 pod 的流量**：web 是提供静态内容的 nginx，调用 api 的是浏览器，来自集群
外部。给 web 的 pod 开 egress 只会放松策略，而不会启用任何东西。

强制执行的保留意见：NetworkPolicy 只有在 CNI 实现它时才有效。k3s 自带内置的控制器；**kind 的
kindnet 不实现 NetworkPolicy**，会悄无声息地忽略这些 manifest。因此 bootstrap 默认使用 k3d，
即使只安装了 kind；当集群不做强制执行时，smoke 会报告。

### 8. 默认使用外部 Postgres，dev/staging 使用 CloudNativePG {#8-postgres-externo-por-padrão-cloudnativepg-para-devstaging}

base 不知道数据库在哪里：连接只通过 Secret 中的 `DATABASE_URL` 传入。本地 overlay 在**单独的
namespace**（`brabo-db`）中启动一个 CloudNativePG 的 `Cluster`，因为应用 namespace 的
`default-deny` 会需要针对 operator 的 egress 规则——那与应用毫无关系。规则 `allow-db-egress`
能跨越 namespace，因为它按标签匹配，而不是按名称。

### 9. Secrets：默认 ESO，sealed-secrets 作为回退 {#9-secrets-eso-por-padrão-sealed-secrets-como-fallback}

版本管理的 manifest 中没有任何机密。base 中的 `ExternalSecret` 在每个环境中都一样；变化的只是
`SecretStore`，它是机密路径上唯一按 overlay 声明的资源。在本地，store 从一个源 Secret 读取，
该 Secret 由 `bootstrap.sh` 用 `openssl rand` **以命令式**创建。

推论：Keycloak 的 `realm.json` 变成了**模板**。原文件以明文携带 client 的 secret，而把它放进
ConfigMap 正是范围所禁止的“明文 manifest 中的 secret”。一个 initContainer 用 ESO 的值把它
渲染到内存型的 `emptyDir`，如果有任何占位符残留，就**大声失败**——导入一半的 realm 会以绿色
启动，直到登录时才出问题。

### 10. 本地 overlay 没有 ingress：使用 compose 端口上的 NodePort {#10-overlay-local-sem-ingress-nodeports-nas-portas-do-compose}

本地 overlay 把 NodePort 映射到 **3000/4000/8080/8088**，正是 `docker-compose.prod.yml` 的
端口。这样开发 realm 和 `docker/smoke.sh` 的默认值无需转换就依然有效，也免去了 ingress
controller 和 DNS 解析——它们会占用开发机的内存，并带来一整类离线故障（`nip.io` 之类需要
互联网）。ingress 只存在于 staging/prod 中。

出于同样的原因，Prometheus 只用服务器 chart 本身，没有 Alertmanager、Pushgateway、
node-exporter 或 Grafana：kube-prometheus-stack 放不下，而以代码方式提供的仪表盘属于第 5 项。

### 11. HPA 的验收标准如何被执行 {#11-como-o-critério-de-aceite-do-hpa-é-exercitado}

`make hpa-test` 往一个**未在 Oban 配置中声明**的队列插入处于 `available` 的 job。没有配置
生产者，就没有人消费它们：它们会一直处于 `available`，直到被删除，而这正是要观察的条件。
其他方案因副作用而被否决——插入 `default` 队列会让 engine 执行它们（测量的是排空，而不是积压），
暂停队列会在测试期间改变系统行为，而创建一个 no-op worker 会把测试代码放进领域中。

## 后果 {#consequências}

- 存在真实的 Kubernetes 部署，可以用一条命令验证，而“镜像能在 compose 中启动”与“系统能在
  集群中工作”之间的距离不再是不可见的——共五个缺陷，全都是无声的。
- engine 真正支持了多于一个副本，而不只是在 manifest 中。
- 同一个 web 镜像可服务于任何环境；ADR 0024 的第 1 号债务已偿还。
- `bandit` 从 1.12.0 升到 1.12.3（在已声明的 `~> 1.5` 范围内）：本次会话的 `mix deps.get`
  报告了 EEF-CVE-2026-65623（HIGH，分片 WebSocket 中的 CPU 二次方爆炸）——而 engine 正通过
  websocket 提供 Phoenix 通道。

## 已知限制（已记录，未解决） {#limitações-conhecidas-registradas-não-resolvidas}

1. **关闭时没有会话排空。** 这是阶段 5 的第 4 项，不在本次会话的六项之中。manifest 已经预留了
   `terminationGracePeriodSeconds` 和 `preStop` 的挂钩点，修复 4.3 也防止了缩容破坏状态——但
   一个下线的副本仍会在没有原因为 `node_shutdown` 的 `closing` 过渡的情况下结束它所承载的
   会话。因此 engine 的 `scaleDown.stabilizationWindowSeconds` 为 600：缩容的代价明显高于维持。
2. **没有任何镜像发布到 registry。** CI 使用 `load: true`，固定 tag `:prod`。staging/prod 的
   overlay 已经带有现成的 `images:` 字段，值为 `REPLACE_WITH_DIGEST`——按 digest 发布是它们的
   前提，而不是本地的前提。
3. **Keycloak 仍处于 `start-dev`**，继承自 ADR 0024（限制 4）。变化的是机密不再是明文。生产
   模式、外部数据库和固定主机名仍不在范围内。
4. **本地 overlay 使用 ReadWriteOnce**，而不是 RWX。之所以可行，是因为集群只有一个节点，而
   RWO 的意思是“一个**节点**”，而不是“一个 pod”。base 仍是 RWX，这才是正确的；放松要求的是
   overlay，而在真实集群中，这种配置会把 api 和 engine 放到不同的节点上，push 会以
   `remote unpack failed` 失败。
5. **staging 和 prod 的 overlay 没有被**除 `kustomize build` + `kubeconform` 之外的任何测试
   执行。它们依赖托管 Postgres、RWX 的 StorageClass、机密提供者和 registry——这些在开发机上都
   不存在。`REPLACE_ME` 占位符是刻意的：在那里放一个看似合理的默认值会比占位符更糟，因为它会
   被忽略过去。
6. **`k3d image import` 不会导入 initContainer 的 busybox。** 它以
   `content digest ... not found` 失败——`docker pull` 产生一个带证明 manifest 的多架构索引，
   节点上的 `ctr` 会拒绝它。bootstrap 把这个镜像的导入视为可选，让 kubelet 从 registry 拉取它
   （我们已经为 chart 依赖互联网）。对于**我们自己的**镜像，导入仍是必需的：它们不存在于任何
   registry 中，在那里失败是真正的错误——脚本开始检查输出，因为 `k3d` 即使失败也以代码 0 退出。
7. **本地 overlay 的 Postgres 中没有 pgvector。** 该扩展只由 `docker/postgres/init.sql` 创建，
   从不经由 migration（已验证）；目前不存在任何 `vector` 列。当第一个出现时，CloudNativePG 将
   需要带有该扩展的镜像。
