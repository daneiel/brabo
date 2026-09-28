# 0174 — O binário standalone do runner deixa de prometer o Mac Intel

## Status

**Accepted.** Decidido pelo mantenedor em 2026-09-27 (AT-065, HS-035).
Referencia o [ADR 0112](0112-binario-standalone-do-runner-via-bun-build-compile.md)
(o binário standalone via `bun build --compile`, nascido com cinco alvos), o
[ADR 0106](0106-distribuicao-do-runner-via-tsup-e-npm-publish.md) (o pacote
npm, que passa a ser o caminho do Mac Intel) e o
[ADR 0149](0149-assinatura-dos-artefatos-publicados.md) (o `checksums.txt`
assinado que cobre os binários). Não edita nenhum dos três.

## Context

O ADR 0112 prometeu cinco alvos — `linux-x64`, `linux-arm64`, `darwin-x64`,
`darwin-arm64`, `win32-x64` —, cada um construído no seu runner nativo. O
`darwin-x64` **nunca publicou**, e a causa está medida em duas camadas:

1. **Não há runner Intel utilizável.** O label `macos-13` aponta para uma
   imagem que o GitHub aposentou (changelog de 2025-09-19, fim em dez/2025).
   Nas três tags que existem (`v4.0.0`, `v4.0.1`, `v5.0.0`) o job ficou
   **24h00m01s** na fila e foi cancelado pelo teto do Actions — o MESMO número
   nas três, ou seja, nunca foi agendado. Num ensaio por `workflow_dispatch`
   (2026-09-13, run `34769280227`) ficou 30 min na fila, de novo sem runner.
2. **O substituto agenda, constrói e reprova.** O label Intel que o GitHub
   oferece no lugar, `macos-15-intel`, agenda em 3–22 s (cinco runs) e
   CONSTRÓI o binário, mas reprova no `--self-test-pty`: sob o Bun, o `onData`
   do `node-pty` nunca entrega a saída do processo filho — bug aberto do
   runtime, [oven-sh/bun#25822](https://github.com/oven-sh/bun/issues/25822),
   sem release corrigida. A MESMA prova passa sob **Node** no mesmo runner
   (run `34770476634`).

A segunda medição mudou a natureza da pendência: o bloqueio deixou de ser
runner (pagar um runner Intel não resolveria) e passou a ser o Bun. Sobravam
duas saídas — esperar o Bun corrigir e então trocar o label, ou tirar a
plataforma —, e o `CLAUDE.md` a registrava como decisão de dono.

Enquanto isso, a promessa de cinco alvos custava em quatro lugares: a matriz
enfileirava um job que nunca rodava; `ALVOS_ESPERADOS` fazia todo
`checksums.txt` anunciar, para sempre, a falta de um alvo que já se sabia que
não viria ([RN-565](../business-rules.md#rn-565)); o proxy
`GET /runner-releases/binary` aceitava `darwin-x64` só para responder 502
`plataforma_nao_publicada`; e o `install.sh` pedia ao GitHub um asset que dá
404 — com a mesma saída de "a Release não publica", indistinguível de uma
Release incompleta.

## Decision

**A plataforma sai.** O binário standalone passa a prometer QUATRO alvos, e o
Mac Intel fica com o caminho npm — `npm install -g @brabo/runner`, que roda
sob Node, onde a prova do `node-pty` passa.

- `build-runner-binaries.yml` tira `darwin-x64` da matriz e de
  `ALVOS_ESPERADOS`. O `checksums.txt` passa a declarar ausência só do que é
  falha de verdade.
- O proxy `GET /runner-releases/binary` aceita os quatro, e recusa
  `darwin-x64` com **400 próprio** — não com o "plataforma inválida" genérico —
  nomeando este ADR e o comando npm, sem chamar o GitHub.
- O `install.sh`, em `darwin-amd64`, **não tenta baixar**: diz em texto que o
  Mac Intel não tem binário, que o resto da instalação está de pé e qual é o
  comando npm, e deixa `RUNNER_BIN` vazio — o mesmo sinal pelo qual o
  fechamento ([RN-547](../business-rules.md#rn-547)) já relatava a pendência da
  chave e do serviço. A instalação em si continua suportada no Mac Intel (o
  `cosign` pinado para `darwin-amd64` fica), só o binário do agente local sai.
- O navegador continua **detectando** `darwin-x64` — detectar Mac Intel é
  verdade, e é o que permite dizer o caminho certo —, mas o passo do binário
  não pede o download: falha de antemão, e cai no mesmo best-effort
  (`falhaDoBinario` → comando npm) da [RN-473](../business-rules.md#rn-473).
- `scripts/ci/alvos-do-runner.spec.ts` amarra os quatro lugares que enumeram
  alvos, em três linguagens: a matriz, a lista da api, o `case` do instalador
  e a do navegador. Tirar (ou devolver) um alvo num e esquecer outro reprova.

## Alternatives considered

- **Esperar o Bun e trocar o label para `macos-15-intel`.** Mantém a promessa
  sem prazo, e trocar o label sozinho não faz o alvo publicar — só troca 24 h
  de fila por um job vermelho a cada tag. Continua sendo o caminho de volta
  (abaixo), não a decisão de hoje.
- **Construir o `darwin-x64` por cross-compilação a partir do `darwin-arm64`.**
  O ADR 0112 recusou cross-compilar addon nativo, e o `self-test-pty` não
  rodaria na arquitetura-alvo — publicaria um binário que ninguém provou.
- **Pagar runner Intel.** A medição mostrou que o bloqueio é o runtime, não a
  máquina: o mesmo `macos-15-intel` hospedado constrói e reprova.

## Consequences

- A promessa do binário standalone é de quatro alvos, e a Release continua
  recebendo **dois** (`linux-x64`, `linux-arm64`) até uma tag exercitar as
  correções de `win32-x64` e `darwin-arm64` que já estão na `dev`. Esta decisão
  não mexe nisso.
- Quem usa Mac Intel precisa de Node instalado para ter o agente local. O
  `install.sh` e o painel do navegador dizem isso em texto; nenhum dos dois
  instala o Node por conta própria.
- **Não medido, e declarado:** o issue do Bun foi aberto em darwin ARM64. É
  provável que o `darwin-arm64` esbarre no mesmo defeito depois do conserto do
  `spawn-helper`. Se acontecer, este ADR é o precedente, não a resposta
  automática — decidir o `darwin-arm64` é outra decisão.
- **Caminho de volta:** quando o Bun corrigir o `onData` do `node-pty` numa
  release, religar o alvo é ADR novo que troca o label para `macos-15-intel`,
  roda o ensaio por `workflow_dispatch` com `tag` vazia, e devolve
  `darwin-x64` aos quatro lugares que o spec amarra.
