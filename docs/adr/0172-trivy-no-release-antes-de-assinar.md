# 0172 — O release escaneia com Trivy o que publica, por digest, antes de assinar

## Status

**Accepted.** Decidido pelo mantenedor em 2026-09-27 (AT-179): **escaneia e
reprova**. Referencia o [ADR 0119](0119-imagens-publicadas-no-ghcr-por-digest.md)
(as imagens publicadas por digest), o
[ADR 0149](0149-assinatura-dos-artefatos-publicados.md) (a assinatura `cosign`
keyless por digest) e o [ADR 0162](0162-broker-publicado-e-oferecido-pelo-instalador.md)
(a quinta imagem). Não edita nenhum deles.

## Context

O Trivy só existia no job `images` do `ci.yml`, que escaneia um build LOCAL do
PR (`brabo-api:prod` no daemon do runner). O `release.yml` constrói de novo,
empurra para o GHCR, registra os digests em `.release/images.json` e assina —
sem scan nenhum. A investigação da AT-110 mediu por que isso não é o mesmo
artefato: o cache `type=gha` que um PR grava não é legível de uma tag (dos 663
caches `buildkit` do repositório, todos estavam em `refs/pull/N/merge`), então a
tag constrói FRIA, e o `apk upgrade` do estágio final roda de novo e pode trazer
outro conjunto de pacotes. A AT-110 fechou o lado do PR (`no-cache-filter =
["runtime"]` no bake), mas a imagem que o instalador baixa continuava a única
que ninguém escaneava.

## Decision

1. **Onde.** No job `release` do `release.yml`, depois de `Registrar as imagens
   publicadas` e **antes** de `Instalar o cosign`/`Assinar as imagens
   publicadas`. A ordem é o mecanismo: imagem reprovada não recebe assinatura, e
   sem assinatura o `install.sh` não a instala.
2. **Sobre o quê.** Sobre o DIGEST de cada imagem registrada no
   `.release/images.json` (`repositorio@sha256:…`), lido do registry
   (`--image-src remote`) — nunca por tag, pelo mesmo motivo da assinatura: a
   tag é ponteiro móvel e o digest é o que foi publicado. A lista sai de
   `scripts/ci/trivy-do-release.ts referencias`, que reprova manifesto vazio ou
   digest malformado.
3. **A régua reprova.** HIGH ou CRITICAL **com correção disponível** reprova o
   job. As flags são as do `ci.yml`, byte a byte: `--scanners vuln --severity
   HIGH,CRITICAL --ignore-unfixed --ignorefile .trivyignore.yaml
   --skip-db-update --exit-code 1`. Quem decide é o código de saída do Trivy,
   nunca uma segunda régua em TypeScript — ela divergiria da dele no primeiro
   `Status` novo. Todas as imagens são escaneadas antes de reprovar, para o log
   nomear QUAIS falharam.
4. **O que não tem correção é relatado.** Um segundo scan por imagem, sem
   `--ignore-unfixed` e com `--exit-code 0`, gera JSON;
   `scripts/ci/trivy-do-release.ts resumo` monta o markdown (os dois números
   por imagem e a lista do que não tem correção), que vai para o resumo do job
   e é anexado à Release como `trivy-sem-correcao.md`. Esse passo roda ANTES
   do portão, para o resumo existir também quando o portão reprova.
5. **Sem allowlist nova.** O único arquivo de exceções é o `.trivyignore.yaml`
   que o `ci.yml` já usa — curado, com as três condições no topo e
   `expired_at` em toda entrada. Não usá-lo faria o release aplicar uma régua
   MAIS dura que a do PR, sobre as mesmas exceções que o mantenedor já
   aceitou: medido, o `engine` da `v6.1.0` teria 56 achados corrigíveis, todos
   nos binários de scanner de terceiro que aquele arquivo documenta. O spec
   reprova um segundo `--ignorefile`, `--skip-files`, `--skip-dirs`, `--vex`,
   `--ignore-policy` ou `--ignore-status`.
6. **Mesma versão, declarada duas vezes, guardada.** `TRIVY_VERSION` e
   `TRIVY_SHA256` entram no `env:` do `release.yml` com o valor do `ci.yml`.
   Um lugar só não coube: `env:` de workflow não se importa de outro arquivo, e
   uma action composta para duas variáveis seria um terceiro lugar a manter. O
   binário é baixado por `curl` e passa por `sha256sum -c` antes de extrair,
   como no `ci.yml`. Sem action nova (nenhum `uses:` entrou).
7. **A prova.** O `release.yml` só roda em tag final, então nenhum PR o
   executa — a situação do `install-e2e.yml`. `scripts/ci/trivy-do-release.spec.ts`
   guarda, a cada PR: o portão depois do registro e antes do cosign; nenhum
   `continue-on-error`/`always()` no caminho; as flags de régua iguais às do
   `ci.yml`; o relatório sem `--ignore-unfixed` e com `--exit-code 0`; versão e
   hash iguais; `curl` → `sha256sum -c` → `tar`; o asset na `gh release
   create`. Provado por mutação: tirar `--ignore-unfixed` do portão ou mover o
   `cosign-installer` para antes dele deixa o spec vermelho.

## Consequences

- **Reprovar deixa imagem publicada sem assinatura.** O push acontece antes do
  scan (é ele que cria o digest), então uma tag reprovada deixa `:X.Y.Z` e
  `:<sha>` no GHCR, sem assinatura, sem Release e sem `images.json` anexado. É
  o estado certo — o instalador recusa imagem sem assinatura —, mas é um
  resíduo público. Refazer é corrigir a base e cortar tag nova; a republicação
  por `workflow_dispatch` da mesma tag reconstrói e reescaneia.
- **A próxima tag pode nascer vermelha por CVE publicada depois do PR.** O
  scan da tag usa a base de vulnerabilidades do dia da tag, não a do PR. É o
  ponto: o que chega ao instalador é julgado com o que se sabe no dia em que
  chega. Medido em 2026-09-27 contra os digests da `v6.1.0`: `api` e `web`
  reprovariam hoje por `CVE-2026-45447` (HIGH, `libcrypto3`/`libssl3`
  `3.3.7-r0` → `3.3.7-r1`), CVE posterior àquela tag; `engine` e `backup`
  passam; nada HIGH/CRITICAL sem correção. Uma tag nova constrói frio e roda
  `apk upgrade`, então deve trazer o `3.3.7-r1` — o que não se provou aqui,
  porque exigiria cortar uma tag.
- **Custo de tempo.** Medido localmente sobre os quatro digests da `v6.1.0`:
  13 s de download da base e ~17 s para os oito scans (portão e relatório),
  por rede. No runner o número real só existe na primeira tag; o job segue com
  `timeout-minutes: 30`, contra 4–11 min das três últimas releases.
- **O `.trivyignore.yaml` passa a valer também para o que é publicado.** Uma
  entrada que expira (`expired_at: 2026-10-31` nas atuais) reprova o PR E a
  tag seguinte. A disciplina de revisar a lista não muda; o que muda é que
  esquecê-la agora trava a publicação, não só o merge.
- **Duplicação declarada.** Versão, hash e flags existem em dois workflows. O
  spec reprova a divergência; quem sobe o Trivy sobe nos dois no mesmo PR.
