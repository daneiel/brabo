---
traducao_de: af448f7079e9400a7098c2181f8eb48a105e637c
---

# ADR 0172 — 发布在签名之前按 digest 用 Trivy 扫描它所发布的东西

## 状态 {#status}

**已接受。** 维护者于 2026-09-27 决定（AT-179）：**扫描并拒绝**。引用 [ADR 0119](0119-imagens-publicadas-no-ghcr-por-digest.md)（按 digest 发布的镜像）、[ADR 0149](0149-assinatura-dos-artefatos-publicados.md)（按 digest 的 keyless `cosign` 签名）和 [ADR 0162](0162-broker-publicado-e-oferecido-pelo-instalador.md)（第五个镜像）。都不编辑。

## 背景 {#context}

Trivy 只存在于 `ci.yml` 的 `images` 作业中，它扫描 PR 的一个**本地**构建（runner 守护进程中的 `brabo-api:prod`）。`release.yml` 重新构建，推送到 GHCR，在 `.release/images.json` 中登记 digest 并签名——没有任何扫描。AT-110 的调查测量了为什么这不是同一个工件：PR 写入的 `type=gha` 缓存不能被 tag 读取（仓库的 663 个 `buildkit` 缓存全都在 `refs/pull/N/merge` 中），所以 tag 是**冷**构建，最终阶段的 `apk upgrade` 会再次运行，并可能带来另一组包。AT-110 关闭了 PR 这一侧（bake 中的 `no-cache-filter =
["runtime"]`），但安装程序下载的镜像仍然是唯一没人扫描的那个。

## 决策 {#decision}

1. **在哪里。** 在 `release.yml` 的 `release` 作业中，在 `Registrar as imagens
   publicadas` 之后、`Instalar o cosign`/`Assinar as imagens
   publicadas` **之前**。顺序就是机制：被拒绝的镜像不会得到签名，而没有签名 `install.sh` 就不会安装它。
2. **针对什么。** 针对 `.release/images.json` 中登记的每个镜像的 **DIGEST**（`repositorio@sha256:…`），从 registry 读取（`--image-src remote`）——绝不按 tag，理由与签名相同：tag 是可移动的指针，而 digest 才是被发布的东西。列表来自 `scripts/ci/trivy-do-release.ts referencias`，它拒绝空清单或格式错误的 digest。
3. **尺子会拒绝。** **有可用修复**的 HIGH 或 CRITICAL 会让作业失败。标志与 `ci.yml` 的逐字节相同：`--scanners vuln --severity
   HIGH,CRITICAL --ignore-unfixed --ignorefile .trivyignore.yaml
   --skip-db-update --exit-code 1`。决定的是 Trivy 的退出码，绝不是 TypeScript 中的第二把尺子——它会在第一个新的 `Status` 上与 Trivy 的产生分歧。在拒绝之前扫描所有镜像，以便日志点名**哪些**失败了。
4. **没有修复的会被报告。** 每个镜像第二次扫描，不带 `--ignore-unfixed`，带 `--exit-code 0`，生成 JSON；`scripts/ci/trivy-do-release.ts resumo` 组装 markdown（每个镜像的两个数字以及没有修复的列表），它进入作业摘要，并作为 `trivy-sem-correcao.md` 附加到 Release。这一步在闸门**之前**运行，以便闸门拒绝时摘要也存在。
5. **没有新的允许清单。** 唯一的例外文件是 `ci.yml` 已经使用的 `.trivyignore.yaml`——经过策展，顶部有三个条件，每个条目都有 `expired_at`。不使用它会让发布对维护者已经接受的同样例外应用一把比 PR **更严**的尺子：测得 `v6.1.0` 的 `engine` 会有 56 个可修复的发现，全都在该文件记录的第三方扫描器二进制中。spec 会拒绝第二个 `--ignorefile`、`--skip-files`、`--skip-dirs`、`--vex`、`--ignore-policy` 或 `--ignore-status`。
6. **同一版本，声明两次，受到守护。** `TRIVY_VERSION` 和 `TRIVY_SHA256` 以 `ci.yml` 的值进入 `release.yml` 的 `env:`。一个地方放不下：工作流的 `env:` 不能从另一个文件导入，而为两个变量写一个组合 action 会是第三个要维护的地方。二进制通过 `curl` 下载，并在解压前经过 `sha256sum -c`，与 `ci.yml` 中一样。没有新的 action（没有任何 `uses:` 进入）。
7. **证明。** `release.yml` 只在最终 tag 上运行，所以没有 PR 会执行它——与 `install-e2e.yml` 的情况相同。`scripts/ci/trivy-do-release.spec.ts` 在每个 PR 中守护：闸门在登记之后、cosign 之前；路径上没有 `continue-on-error`/`always()`；尺子的标志与 `ci.yml` 的相同；报告不带 `--ignore-unfixed` 且带 `--exit-code 0`；版本和哈希相同；`curl` → `sha256sum -c` → `tar`；`gh release
   create` 中的资产。通过变异证明：从闸门中去掉 `--ignore-unfixed`，或把 `cosign-installer` 移到它之前，都会让 spec 变红。

## 后果 {#consequences}

- **拒绝会留下已发布但未签名的镜像。** 推送发生在扫描之前（正是它创建 digest），所以被拒绝的 tag 会在 GHCR 中留下 `:X.Y.Z` 和 `:<sha>`，没有签名，没有 Release，也没有附加的 `images.json`。这是正确的状态——安装程序拒绝没有签名的镜像——但它是一个公开的残留物。重做就是修正基础镜像并切一个新 tag；通过 `workflow_dispatch` 重新发布同一个 tag 会重新构建并重新扫描。
- **下一个 tag 可能因 PR 之后公布的 CVE 而以红色诞生。** tag 的扫描使用 tag 当天的漏洞库，而不是 PR 的。这正是要点：到达安装程序的东西，用它到达那一天所知的信息来评判。2026-09-27 针对 `v6.1.0` 的 digest 测得：`api` 和 `web` 今天会因 `CVE-2026-45447`（HIGH，`libcrypto3`/`libssl3`
  `3.3.7-r0` → `3.3.7-r1`）而被拒绝，这是那个 tag 之后的 CVE；`engine` 和 `backup` 通过；没有无修复的 HIGH/CRITICAL。新 tag 冷构建并运行 `apk upgrade`，所以应该会带来 `3.3.7-r1`——这里没有证明，因为那需要切一个 tag。
- **时间成本。** 在本地针对 `v6.1.0` 的四个 digest 测得：下载库 13 秒，八次扫描（闸门和报告）约 17 秒，经网络。在 runner 上真实的数字只会在第一个 tag 出现；作业保持 `timeout-minutes: 30`，而最近三个发布用时 4–11 分钟。
- **`.trivyignore.yaml` 开始也对被发布的东西有效。** 一个过期的条目（当前的是 `expired_at: 2026-10-31`）会让 PR **和**下一个 tag 失败。审阅列表的纪律不变；改变的是，忘了它现在会卡住发布，而不只是合并。
- **声明的重复。** 版本、哈希和标志存在于两个工作流中。spec 拒绝分歧；升级 Trivy 的人在同一个 PR 中升级两处。
