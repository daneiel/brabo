---
id: fase-28-pasta-do-usuario
title: FASE 28 — a pasta do usuário
sidebar_label: FASE 28 — pasta do usuário
sidebar_position: 15
description: O recorte da FASE 28 — base consentida no bootstrap, mounted como padrão local, e um agente local que declara capacidades. As decisões estão nos ADRs 0146 e 0147.
keywords: [fase 28, pasta do usuário, base de projetos, runner, espelho, capacidades]
---

# FASE 28 — a pasta do usuário

> Este documento é o **recorte** da fase: o que ela persegue, o que ela recusa,
> e em que ordem. As **decisões** moram nos [ADR 0146](../adr/0146-base-consentida-no-bootstrap.md)
> e [ADR 0147](../adr/0147-agente-local-com-capacidades.md) — o que estiver aqui
> e não estiver lá é intenção, não decisão.

## O problema

O produto tem três modos de execução desde o [ADR 0104](../adr/0104-execution-mode-tres-valores-e-workspace-verificado-pelo-runner.md),
e nenhum deles entrega a coisa mais simples que um usuário espera: **abrir o
editor e ver o trabalho acontecendo numa pasta dele**.

| modo | pasta do usuário | o que custa |
|---|---|---|
| `container` | não existe | o código mora num volume que ele nunca abre |
| `mounted` | sim, sob `BRABO_PROJECTS_BASE` | **invisível na prática**: sem a variável o modo nem é oferecido, e nada no produto pede que ela seja configurada |
| `runner` | sim, pasta real | binário, `chmod +x` manual, pareamento, e Docker como pré-requisito duro (RN-507/508) |

O `mounted` é o caso mais instrutivo. O [ADR 0141](../adr/0141-base-unica-dos-projetos-montados.md)
construiu a base única e o [ADR 0142](../adr/0142-validacao-de-workspace-montado-adiada.md)
tornou possível sugerir um caminho que ainda não existe — mas nenhuma das duas
coisas chegou à tela. `GET /workspaces/:workspaceId/projects-base` existe, é
consumido por ninguém no web, e por isso o modo que já estava pronto continua
fora do alcance de quem instala o produto.

## O desenho, em três camadas

Cada camada com um mecanismo só, e nenhuma inventando autoridade nova:

| camada | onde | mecanismo |
|---|---|---|
| consentimento | `pnpm bootstrap`, uma vez, no host | escolhe a base, grava `BRABO_PROJECTS_BASE`, prova o compartilhamento do Docker Desktop |
| pasta viva | dentro da base | bind por identidade (ADR 0141) — zero sincronização |
| destino fora da base | opcional, por projeto | capacidade `espelho` do agente local: uma direção, nunca apaga |

A terceira camada existe por uma razão física: **bind mount não atravessa rede
nem alcança caminho fora do que foi montado.** Para escrever numa pasta
arbitrária do host só há três saídas — rodar api/engine nativamente, ter um
processo vivo no host, ou o navegador escrever pela File System Access API. A
segunda é a única contínua, e o `brabo-runner` já é esse processo.

## Consentimento de configuração ≠ aprovação de ação

O ponto que os dois ADRs precisam declarar, e que decide o desenho do espelho:

A escrita do espelho **não** passa por `proposed_action`, porque não é um agente
pedindo para agir — é o sistema escrevendo num caminho que o próprio usuário
declarou ao criar o projeto. Sincronizar por comando de terminal seria o
contrário: cairia no escopo de caminho do [ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md),
viraria fila de aprovações rotineiras, e corroeria justamente o teto que dá
sentido ao clique.


## Numeração — contada, não herdada

> As contagens em prosa do repositório estão em deriva conhecida. `CONTRIBUTING.md`
> diz "68 ADRs"; o frontmatter de `docs/adr/index.md` diz "108". Nenhuma sessão
> desta fase confia em número escrito em prosa.

O método, que toda sessão desta fase repete antes de reservar qualquer número:

```bash
# ADRs — arquivos, não prosa
ls docs/adr/ | grep -cE '^[0-9]{4}-.*\.md$'

# RNs — cabeçalhos, nos três arquivos que compartilham a numeração
git grep -h -E '^### RN-' -- 'docs/business-rules.md' 'docs/business-rules/*.md' \
  | grep -oE 'RN-[0-9]+' | sort -u | wc -l
```

Medido no início da sessão 1, contra `dev`: **144 ADRs** (maior `0145`, com um
buraco em `0062`) e **371 RNs** (maior `509`, zero âncoras duplicadas). Daí
`0146` e `0147`.

**A faixa reservada para a fase é RN-511 a RN-520**, e o salto sobre a RN-510 é
deliberado. Contar apenas `dev` devolveria 510 — mas a RN-510 já estava alocada
numa branch de trabalho que ainda não tinha mergeado. Reservá-la aqui recriaria
exatamente a colisão que aconteceu com a RN-505, quando duas PRs alocaram o
mesmo número com dois minutos de diferença e a âncora `{#rn-505}` ficou
duplicada por semanas.

Vale registrar por que aquela colisão sobreviveu tanto tempo: **`docs:build`
não pega âncora duplicada.** `onBrokenAnchors: 'throw'` reprova link para
âncora que *não existe*; com duas âncoras iguais o Docusaurus resolve a primeira
e a segunda fica inalcançável, em silêncio. Contar só o que está em `dev` é
condição necessária e não suficiente — é preciso contar também o que está em voo.

## As sessões

Uma entregável cada, na ordem. O prompt completo de cada sessão é escrito ao
final da anterior, com o que ela tiver descoberto.

| # | entregável | depende de |
|---|---|---|
| 1 | este documento + ADR 0146 + ADR 0147 + faixa de RN reservada | — |
| 2 | base consentida no `bootstrap.sh`/`preflight.mjs`, `.env.example`, prova de compartilhamento | 1 |
| 3 | wizard oferece `mounted` por padrão quando a base existe | 2 |
| 4 | broker no compose local conforme o veredito do ADR 0146 | 2 |
| 5 | capacidades declaradas no protocolo do agente local (sem espelho ainda) | 1 |
| 6 | capacidade `espelho`: escopo próprio, uma direção, nunca apaga | 5 |
| 7 | instalação como serviço de usuário, parar/remover, revogação server-side | 6 |
| 8 | estado do espelho na web (última sync, contagem, erro) | 6 |
| 9 | E2E, `docs:check`, docmap e CHANGELOG fechados | 8 |

## O que esta fase NÃO toca

Declarado nos dois ADRs, e repetido aqui porque é o que dá sentido ao resto:

- `decide.ts` e os tetos absolutos — nenhum teto ganha exceção, nem configurável
- `proposed_action` como origem de todo efeito externo de agente
- a imutabilidade do event log
- o portão da imagem nos três modos ([ADR 0135](../adr/0135-portao-de-imagem-nos-tres-modos.md))
- as cinco operações e a spec computada do broker ([ADR 0128](../adr/0128-porta-de-docker-e-a-prova-de-empacotamento.md)/[0130](../adr/0130-broker-de-container.md))
- o enum `project_execution_mode` — nenhum modo novo nasce nesta fase

## Lacunas que a fase encosta e não resolve

- **credencial de git descartada no caminho `docker exec` em modo `runner`** —
  `apps/runner/src/index.ts:318-320`; `packages/docker-port` não tem campo `env`,
  por decisão do ADR 0130. Declarada nos ADRs 0130/0145, não corrigida aqui.
- **symlink de dentro do projeto apontando para fora** não é detectado por
  `decide()`, que é puro e não faz I/O — ADR 0055. `apps/runner/src/guard.ts:9-31`
  declara-se best-effort pelo mesmo motivo.
- **BRB-005** — os artefatos publicados (imagens do GHCR, binários do runner)
  não são assinados. Um instalador de uma linha sem assinatura é pior que o
  download atual, e é por isso que a sessão 7 não ganha instalador de uma linha.
- **BRB-031** — `chmod +x` manual na configuração pelo navegador. Some como
  efeito colateral se a instalação passar a vir do bootstrap versionado.
- **exclusividade `{project_id, machine_id}`** adiada até haver um segundo dev
  simultâneo real — ADR 0137.
