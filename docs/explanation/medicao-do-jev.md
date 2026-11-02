---
id: medicao-do-jev
title: Medição do roteador de ferramentas Jev
description: "O replay que pergunta ao Jev, para cada passo de agente já gravado no event log local, qual ferramenta ele teria oferecido — a concordância, a curva de confiança, a latência e o custo que produziu em 2026-09-29, e uma segunda rodada que separa a régua, a entrada e o ritmo do próprio agente na distância até 90%, com tamanhos de amostra e o que o replay não enxerga; e a comparação ao vivo com e sem da AT-239 — instrumento, protocolo, regra de decisão e estimativa de custo escritos antes de qualquer execução, e a execução de 2026-10-01 (40 execuções, US$ 0,52) — restringir: o roteador compensou no Haiku e perdeu no DeepSeek, cujo cache de prompt ele quebra."
---

# Medição do roteador de ferramentas Jev {#measuring-the-jev-tool-router}

> AT-237 (EP-029, HS-063). Uma **medição fora do produto**: nada em
> `apps/` importa este código, nada é gravado no banco, e nenhum ganho de
> produto é afirmado aqui — isso é da AT-239, que compara turnos com e sem o
> roteador. O roteador medido é o que a AT-235 especifica; as decisões de que
> ele depende são da AT-236.
>
> Medido em 2026-09-29 contra a instância local de dev (projeto compose
> `brabo-dev`), repositório em `d48f99f8ec`. A **segunda rodada** — variantes do
> `state`, classes de equivalência, divisão ajuste/validação, top-2 e a
> distância por causa — está [mais abaixo](#second-round-2026-09-29-where-the-gap-is).

## O que existe {#what-exists}

Tudo mora em `scripts/jev/` e roda com o Node do repositório (type
stripping, sem passo de build, **sem dependência nova**).

| arquivo | papel |
|---|---|
| `catalogo.exs` | despeja, a partir do próprio código do engine, o catálogo de ferramentas de cada agente (`spec/0` de toda ferramenta: nome e descrição) e a identidade (`Engine.Harness.Agents.identity/1`) |
| `catalogo.json` | o despejo, versionado — regenere quando um catálogo mudar (comando no cabeçalho do `.exs`) |
| `passos.ts` | puro: event log → **passos**, e o `state` de cada passo |
| `jev.ts` | puro: o pedido à Decisions API e a leitura da resposta |
| `medicao.ts` | puro: concordância, intervalos de Wilson, a curva de confiança, latência, custo, o relatório em Markdown |
| `replay.ts` | a CLI da primeira rodada: três `SELECT`s, um pedido por passo, um JSONL fora do checkout |
| `dados.ts` | segunda rodada: os dados brutos (eventos, linhas de uso, tarefas, histórias, mapas de módulos, desfechos de ações) e o cache do retrato |
| `equivalencia.ts` | segunda rodada: as classes de equivalência E1–E3, fixadas antes de rodar, e o classificador de comandos de terminal |
| `kickoff.ts` | segunda rodada: a primeira mensagem do laço dos dev agents e dos gates, portada do Elixir do engine (um spec confere o texto fixo contra os arquivos `.ex`) |
| `variantes.ts` | segunda rodada: as variantes do `state` e a fronteira de execução; cada campo nomeia sua fonte no engine |
| `divisao.ts` | segunda rodada: a divisão ajuste/validação, por execução |
| `cliente.ts`, `medicao2.ts`, `analise.ts` | segunda rodada: a chamada (guarda as probabilidades), as tabelas de top-k / cascata / por causa, e a CLI `jev:analise` |

### Passo, não chamada de ferramenta {#step-not-tool-call}

O roteador é consultado **uma vez por chamada ao modelo de chat**, antes de
`provider.chat` (AT-235). Um passo pode carregar várias chamadas de ferramenta —
dez `emit_artifact` numa resposta do Criativo, `terminal` + `read_file` numa
resposta de dev — então perguntar ao Jev uma vez por `tool.call` faria perguntas
que o produto nunca faz, com um `state` que já contém as chamadas irmãs do mesmo
passo.

O event log não tem marcador de passo (AT-235, lacuna 1), então a fronteira vem de
`token_usage`: a api grava uma linha por chamada de LLM **antes** de o engine gravar
os `tool.call`s daquela resposta. Todo `tool.call` da mesma sessão e do mesmo ator
entre duas linhas consecutivas é o mesmo passo. Daí saem três rótulos:

- um passo com **uma** ferramenta (uma ou mais chamadas dela): rótulo = essa ferramenta;
- um passo **heterogêneo** (duas ferramentas diferentes): acerto = a escolha do Jev é
  uma delas — mas restringir o menu a uma ferramenta cortaria o resto;
- um passo **sem** `tool.call` depois da sua linha: o modelo respondeu em texto (ou
  falhou). É o único rótulo que `responder_sem_ferramenta` pode receber por este
  método — o brief não esperava nenhum; a fronteira de passo dá sete.

Os instantes são comparados como **texto** UTC de largura fixa com microssegundos: a
linha de uso e o primeiro `tool.call` de um passo às vezes caem no mesmo milissegundo.

### O `state` enviado {#the-state-sent}

O formato da AT-235, recortado do que existia **antes** do passo: `agente`;
`pedido` — para agentes conversacionais, a última `chat.message` escrita pelo
**usuário**; para dev agents e gates de tarefa, o título da tarefa de
`dev.working`; `contexto` — a identidade do agente mais a linha de
`agent_instructions` do projeto, quando existe (duas camadas do prompt de sistema,
não o prompt montado inteiro); `passos_recentes` — as últimas 6 chamadas daquele
ator naquela sessão, argumentos e resultado cortados em 500 caracteres. A
pergunta é um `choice` cujos `criteria` são o `{name: description}` do catálogo
mais o reservado `responder_sem_ferramenta`.

O pedido vai para `POST https://openrouter.ai/api/alpha/decisions` com o modelo
`typesafe/jev-1.13`. Uma correção à AT-235, medida: **`questions` é um
objeto indexado pelo id da pergunta**, não uma lista — a forma de lista recebe
`400 expected record, received array`. A resposta é
`answers.<id>.{choice, probabilities, confidence}`, `usage.{input_tokens,
output_tokens, cost}`, um `id` (`gen-dec-…`) e um retrato datado em `model`
(`typesafe/jev-1.13-20260917` em toda resposta desta execução).

## A amostra {#the-sample}

| | |
|---|---|
| instância | dev local (`brabo-dev`), projeto `test`, 4 sessões com passos (uma quinta sessão, `core-api`, não tem nenhum) |
| período | 2026-09-29 06:19:11 → 07:57:22 UTC |
| lido | 879 eventos (502 `tool.call`), 307 linhas de `token_usage` de agentes |
| passos | 305 de agentes do catálogo; **302 perguntados** (os 3 do Psicólogo têm catálogo de uma ferramenta só e nunca seriam roteados — AT-235, condição c) |
| rótulos | 295 passos com ferramenta (36 heterogêneos), 7 sem |
| rótulos suspeitos | 157 dos 295 passos têm uma chamada cujo resultado mostra falha (`ok: false`, texto começando com `falhou`/`erro`, `exit` ≠ 0) ou que nunca recebeu resultado — a ferramenta chamada pode ter sido a errada |

Foram feitas duas execuções completas (a segunda é a relatada; o banco ganhou um
passo da Anamnese entre elas). Entre as execuções, nos 301 passos comuns às
duas, o Jev deu **a mesma escolha em 283 (94%)**; |Δ confiança| médio de 0,029,
o maior 0,16. A amostra é um projeto pequeno, um dia, um modelo de chat
(`~deepseek/deepseek-flash-latest`); toda taxa abaixo carrega seu intervalo de
Wilson de 95%, e a maioria dos intervalos por agente é larga demais para ordenar agentes.

## Concordância por agente {#agreement-by-agent}

"Concordância" = a escolha do Jev é uma ferramenta que o modelo chamou naquele passo.
"Repetir a anterior" é uma linha de base gratuita: oferecer a última ferramenta que o
mesmo ator usou no passo anterior.

| agente | opções | passos com ferramenta | heterogêneos | concordância (IC 95%) | sem suspeita | quando o Jev escolheu ferramenta | linha de base "repetir a anterior" | passos sem ferramenta |
|---|---|---|---|---|---|---|---|---|
| anamnese | 5 | 8 | 0 | 3/8 = 38% (14–69%) | 3/8 | 3/3 | 4/4 | — |
| appsec | 6 | 6 | 2 | 0/6 = 0% (0–39%) | 0/6 | 0/1 | 0/5 | — |
| arquiteto | 9 | 5 | 2 | 1/5 = 20% (4–62%) | 1/5 | 1/2 | 1/4 | 3/3 |
| criativo | 3 | 5 | 0 | 3/5 = 60% (23–88%) | 3/5 | 3/4 | 1/4 | 2/2 |
| dev-board-engine | 9 | 24 | 3 | 12/24 = 50% (31–69%) | 1/3 | 12/24 | 20/23 | — |
| dev-game-session | 9 | 38 | 2 | 20/38 = 53% (37–68%) | 5/14 | 20/38 | 25/37 | — |
| dev-input-keyboard | 9 | 25 | 3 | 12/25 = 48% (30–67%) | 5/10 | 12/25 | 18/24 | — |
| dev-lead | 4 | 1 | 1 | 0/1 | — | — | — | — |
| dev-persistence | 9 | 34 | 3 | 24/34 = 71% (54–83%) | 4/12 | 24/34 | 26/33 | — |
| dev-piece-catalog | 9 | 37 | 5 | 21/37 = 57% (41–71%) | 4/11 | 21/37 | 31/36 | — |
| dev-retro-renderer | 9 | 26 | 0 | 13/26 = 50% (32–68%) | 5/14 | 13/26 | 19/25 | — |
| dev-scoring | 9 | 38 | 1 | 19/38 = 50% (35–65%) | 4/15 | 19/38 | 29/37 | — |
| infra | 5 | 2 | 1 | 0/2 | 0/1 | — | 1/1 | 0/1 |
| infra-workflows | 3 | 2 | 0 | 0/2 | 0/2 | — | 0/1 | — |
| po | 10 | 8 | 2 | 6/8 = 75% (41–93%) | 6/8 | 6/6 | 0/7 | 1/1 |
| qa-automacao | 7 | 20 | 5 | 4/20 = 20% (8–42%) | 2/9 | 4/20 | 14/19 | — |
| qa-estrategia | 6 | 16 | 6 | 0/16 = 0% (0–19%) | 0/15 | — | 7/15 | — |
| **todos** | | **295** | **36** | **138/295 = 47% (41–52%)** | 43/138 = 31% (24–39%) | 138/258 = 53% (47–59%) | **196/275 = 71% (66–76%)** | 6/7 = 86% (49–97%) |

## A curva de confiança, sob a regra decidida {#the-confidence-curve-under-the-decided-rule}

A AT-236 decidiu (respostas 7 e 12) que o roteador **só restringe** o menu,
e que `responder_sem_ferramenta` — com qualquer confiança — manda o catálogo
**inteiro** na v1. Então um passo só é *restringido* quando a confiança está no
limiar ou acima **e** a escolha é uma ferramenta; todo o resto se comporta como hoje.
O erro que custa é a restrição à ferramenta **errada**.

| limiar | menu restrito a 1 | cai no catálogo inteiro | certos entre os restringidos (IC 95%) | restringido à ferramenta errada | passos heterogêneos cortados |
|---|---|---|---|---|---|
| 0.00 | 258 | 37 | 138/258 = 53% (47–59%) | 120 | 18 |
| 0.30 | 191 | 104 | 110/191 = 58% (51–64%) | 81 | 13 |
| 0.40 | 126 | 169 | 76/126 = 60% (52–68%) | 50 | 10 |
| 0.50 | 73 | 222 | 50/73 = 68% (57–78%) | 23 | 5 |
| 0.60 | 43 | 252 | 29/43 = 67% (53–80%) | 14 | 4 |
| 0.70 | 17 | 278 | 14/17 = 82% (59–94%) | 3 | 2 |
| 0.80 | 7 | 288 | 7/7 = 100% (65–100%) | 0 | 0 |
| 0.90 | 2 | 293 | 2/2 = 100% (34–100%) | 0 | 0 |

O relatório imprime a mesma curva por grupo (dev agents, agentes conversacionais,
gates e os outros agentes de `ToolLoop`). Os dev agents seguem a tabela acima
(0.70: 11/14; 0.80: 6/6). Os agentes conversacionais, quando o Jev escolheu uma
ferramenta com qualquer confiança, acertaram em 10/12 passos; ele escolheu
`responder_sem_ferramenta` em 9 dos 21 passos deles com ferramenta, o que pela
resposta 12 é inofensivo.

**Limiar.** Nenhum limiar da grade tem o limite inferior do intervalo em 90% ou
acima, no geral ou em qualquer grupo. O único ponto sem restrição errada é
**0.80**, e ali o roteador age em 7 de 295 passos (2%) — com limite inferior de
65%. Esta amostra não sustenta um limiar; se um for fixado a partir dela, 0.80 é o
valor para o qual ela aponta, com essa cobertura. A resposta 4 da AT-236 pede o
custo de cada tipo de erro, que este replay não consegue precificar.

## Latência e custo {#latency-and-cost}

| | |
|---|---|
| latência (302 pedidos, sequenciais, da máquina do mantenedor) | p50 306 ms, p95 410 ms, máx 550 ms; **0 acima de 2 000 ms** (primeira execução: 286 / 409 / 512) |
| tokens de entrada por pedido | 538 a 3 220, mediana 1 710 |
| custo por `usage.cost` | US$ 0,021964 para 302 passos — **US$ 0,0000727 por passo** |
| custo cobrado | `GET /api/v1/generation` para cada um dos 302 ids: `total_cost` soma os mesmos US$ 0,021964 (razão 1,000) |

O delta de `GET /api/v1/key` em torno de cada execução **não** bateu: +US$ 0,0349
contra 0,0219 declarados na primeira execução, +0,0185 contra 0,0220 na segunda.
A chave é compartilhada e o contador dela atrasa: ao longo de toda a sessão da AT-237 o
`usage` dela subiu de US$ 1,830 para US$ 2,052 (+0,222) enquanto as gerações deste
replay foram cobradas em US$ 0,044, então outro trabalho gastava na mesma chave ao
mesmo tempo. O delta não é medida de uma execução; o registro por geração é. Total gasto pela AT-237, as duas execuções e as
sondagens de formato: cerca de US$ 0,044, contra um teto de US$ 2,00.

## O que o replay não enxerga {#what-the-replay-cannot-see}

- **A primeira mensagem do laço.** Um agente de `ToolLoop` (dev agents, gates,
  Anamnese, Infra-Workflows) começa por uma mensagem de usuário montada em código — a
  tarefa, a história, o mapa de módulos — que nunca chega ao event log. O
  replay tem só o título da tarefa para dev agents e gates de tarefa, e nada
  para `qa-estrategia`, `appsec`, `anamnese` e `infra-workflows`. O `state` do
  produto levaria essa mensagem. O 0/16 de `qa-estrategia` (o Jev respondeu
  `responder_sem_ferramenta` todas as vezes) mede a cegueira do replay tanto
  quanto o Jev; essas linhas são limite inferior e não devem decidir nada.
- **O resto do prompt de sistema.** `contexto` é a identidade e a linha de
  instrução do projeto, não o prompt montado (regras de negócio, estado da
  tarefa, arquivos).
- **Se o rótulo está certo.** O modelo que escolheu a ferramenta não é verdade
  de referência; 157 passos estão marcados como suspeitos e relatados à parte ("sem
  suspeita"). A concordância é menor nos passos limpos (31%) do que no geral
  (47%): os passos suspeitos são, na maioria, chamadas `terminal` falhando de dev
  agents, que o Jev também tende a escolher — então passos mal rotulados não explicam
  a discordância.
- **O efeito.** Um menu restrito muda o que o modelo faz a seguir; o
  replay só compara uma escolha com uma gravada. Se os turnos ficam mais curtos,
  mais rápidos ou mais baratos é a AT-239.

## Dois achados fora dos números {#two-findings-outside-the-numbers}

- **Passos heterogêneos são comuns:** 36 de 295 (12%). Restringir o menu a
  uma ferramenta transforma cada um deles em pelo menos dois passos — a lacuna 1 da AT-235,
  agora contada.
- **O risco de sincronização do catálogo da AT-235 (lacuna 3) é real, com outro nome:**
  `GET /api/v1/models` não lista `typesafe/jev-1.13`, mas lista
  `typesafe/jev-router` — um roteador de chat, com preço `-1`. A sincronização de modelos
  o importaria como modelo de chat (inativo). Registrado aqui, não alterado.

## Segunda rodada (2026-09-29): onde está a distância {#second-round-2026-09-29-where-the-gap-is}

> Pedida pelo dono depois da primeira rodada: repetir a medição, tentar chegar a
> **pelo menos 90%**, e dizer exatamente onde está a distância. **Não alcançado.** Nos
> passos de validação, o top-1 do Jev é **73% por equivalência (IC 95% 66–79%,
> n = 160) e 66% estrito (58–73%)**; o top-2 dele chega a 90% (84–94%). O resto
> desta seção é o protocolo, os números e uma leitura à mão dos 43 erros de top-1
> que sobram. Mesma instância, mesma ressalva da primeira rodada: um projeto
> pequeno, um dia, um modelo de chat; nenhum ganho de produto é afirmado (isso é a
> AT-239). Repositório em `bc7f4c0738`, branch `test/replay-do-jev-v2`.

### Protocolo (escrito antes de qualquer execução) {#protocol-written-before-any-run}

- **Só o que o produto consegue produzir em runtime, antes do passo.** Nada
  do passo-alvo entra no `state`: nem a ferramenta que ele chamou, nem os argumentos,
  nem o resultado, nem o texto que o modelo escreveu naquele mesmo passo (`Passo.texto` é
  lido só de passos *anteriores*; `variantes.spec.ts` afirma, para toda
  variante, que a chamada, o argumento, o resultado e o texto do passo-alvo estão ausentes).
  Cada campo novo tem a fonte no engine, citada no cabeçalho de
  `scripts/jev/variantes.ts`.
- **Classes de equivalência fixadas em `scripts/jev/equivalencia.ts` antes de rodar**,
  a partir da semântica das ferramentas, e relatadas ao lado da regra estrita (a
  da primeira rodada, para que os 47% continuem comparáveis). Três camadas cumulativas:
  **E1** `terminal` cujo comando só lê/lista/busca (`ls`, `find`,
  `cat`, `pwd`, `grep`, `head`, `git status/log/diff`… — um comando composto
  conta pelo segmento mais forte, execução > escrita > leitura) ≡
  `read_file`/`search_workspace`; **E2** `read_file` ≡ `search_workspace`;
  **E3** `terminal` que escreve arquivo (redirecionamento, heredoc, `tee`, `sed -i`,
  `cp`, `mv`, `touch`) ≡ `write_file`. Assimétricas de propósito: o Jev escolher
  `terminal` só serve a uma chamada `terminal`, e um comando que *executa*
  (`npm`, `node`, `rm`, `mkdir`, `git commit`…) não equivale a nada além de
  `terminal`. **A manchete é a regra completa (E1+E2+E3), com a regra estrita
  ao lado.** Nada foi reclassificado depois de ver um resultado; os 3 erros que as
  classes ainda erram são contados como tais abaixo.
- **Ajuste × validação por execução, não por passo.** Um grupo é uma execução de
  `ToolLoop` (a tarefa de um dev agent, uma rodada de gate) ou, para agentes
  conversacionais, a sessão inteira do agente. Os grupos são ordenados por um hash do nome e cada
  um vai para a metade que tem menos passos até ali — determinístico e cego a qualquer
  resultado. 328 passos elegíveis: **167 de ajuste, 161 de validação** (o n abaixo conta
  passos com ferramenta: 161 e 160). As variantes foram iteradas só no ajuste;
  a validação foi perguntada depois, uma vez por variante. **Um incidente, declarado:**
  depois das primeiras execuções de ajuste descobri que `skip_proficiency` /
  `emit_proficiency` da Anamnese também encerram o laço, e os acrescentei à lista de
  fronteiras de execução usada para *montar o state*. Usar a lista corrigida para a divisão
  também teria movido 154 dos 167 passos de ajuste para a validação, então a divisão
  mantém a lista que tinha antes do primeiro pedido (`FERRAMENTAS_DE_FIM_DA_DIVISAO`)
  e só o state usa a corrigida. As quatro variantes de state que dependem
  da fronteira foram perguntadas de novo no ajuste (US$ 0,075, guardados como `.descartado`
  no registro de gastos).
- **Retrato congelado.** O banco de dev continuou recebendo passos de outro trabalho
  durante a sessão (335 linhas de uso no fim contra 333 no começo); a
  análise roda sobre o retrato de 333 linhas e os eventos até os mesmos
  números de sequência (`--dados-cache`). Os 26 passos novos desde a primeira rodada
  (302 respondidos → 328 elegíveis) são todos passos da **Anamnese** da metade de ajuste.
- **Teto de gasto** de US$ 1,00 sobre a soma de `usage.cost`, conferido antes de todo
  pedido contra o total acumulado do diretório de saída (`.jsonl` e
  `.descartado`). Gasto: **US$ 0,414** em 4 604 pedidos (ver "Latência e custo").

### A amostra {#the-sample-1}

| | ajuste | validação |
|---|---|---|
| passos (com ferramenta / sem) | 167 (161 / 6) | 161 (160 / 1) |
| dev agents (`ToolLoop`) | `dev-piece-catalog` 37, `dev-retro-renderer` 26, `dev-input-keyboard` 25 | `dev-game-session` 38, `dev-scoring` 38, `dev-persistence` 34, `dev-board-engine` 24 |
| gates e outros `ToolLoop` | `anamnese` 32, `qa-automacao` 20, `appsec` 3 | `qa-estrategia` 16, `appsec` 3, `infra-workflows` 2, `anamnese` 2 |
| conversacionais | `po` 8, `criativo` 5, `arquiteto` 5 | `infra` 2, `dev-lead` 1 |

A validação é dominada pelos dev agents (134 de 160 passos com ferramenta) e por um
gate (`qa-estrategia`, 16). A metade de ajuste carrega 32 passos da Anamnese, que o
Jev responde com `responder_sem_ferramenta` quando o agente usou
`skip_proficiency` (30 de 32): sem eles o ajuste fica em 94/129 = 73% por
equivalência, o mesmo da validação.

### Variantes tentadas (todas) {#variants-tried-all-of-them}

`tokens` é o tamanho mediano da entrada; latência em ms (p50 / máx), pedidos
sequenciais da máquina do mantenedor. Só passos com ferramenta.

| variante | o que acrescenta à anterior | ajuste estrito → equivalência (top-2) | validação estrito → equivalência (top-2) | tokens | latência |
|---|---|---|---|---|---|
| `original` | nada — o `state` da primeira rodada | 39% → 48% (83%) | 49% → 58% (82%) | 1 687 | 322 / 780 |
| `kickoff` | `pedido` = a primeira mensagem do laço, reconstruída do código do engine | 55% → 58% (89%) | 65% → 73% (91%) | 1 867 | 318 / 612 |
| **`escopo`** | passos recentes só da execução corrente (`ctx.messages` recomeça a cada `ToolLoop.run`) | **57% → 59% (89%)** | **66% → 73% (90%)** | 1 867 | 312 / 814 |
| `resultados` | resultados/argumentos até 2 000 caracteres | 53% → 55% (91%) | 62% → 69% (88%) | 2 011 | 314 / 699 |
| `texto` | o texto do modelo de passos anteriores | 53% → 55% (91%) | 64% → 73% (93%) | 2 090 | 315 / 685 |
| `progresso` | contagens derivadas (passos até ali, chamadas por ferramenta, última ferramenta, testes rodados…) | 55% → 57% (91%) | 65% → 70% (93%) | 2 224 | 309 / 817 |
| `trilha` | `escopo` + a sequência inteira de ferramentas da execução (só nomes) | 53% → 57% (91%) | 64% → 71% (89%) | 1 936 | 310 / 614 |
| `fluxo` | `trilha` + uma pergunta que diz que os agentes trabalham em rajadas | 49% → 55% (92%) | 64% → 75% (93%) | 2 014 | 309 / 586 |
| `enxuto` | `trilha` com só as 2 últimas chamadas | 50% → 54% (89%) | 63% → 74% (91%) | 1 429 | 307 / 920 |
| `so_trilha` | `trilha` sem chamada recente nenhuma | 39% → 44% (80%) | 33% → 56% (83%) | 1 168 | 307 / 480 |
| `acoes` | `escopo` + o resultado dos comandos que esperaram aprovação (reconstruído do desfecho da ação) | 50% → 53% (91%) | 53% → 61% (89%) | 2 333 | 348 / 1 352 |
| `acoes_completo` | `acoes` + 2 000 caracteres + texto + progresso | 47% → 51% (92%) | 51% → 58% (92%) | 3 360 | 326 / 845 |

As seis linhas de `original` a `progresso` (a cascata abaixo) foram escritas
antes do primeiro pedido. As outras seis foram escritas depois, em resposta ao
que o ajuste mostrou, e são uma busca comum na metade de ajuste: `trilha`,
`fluxo`, `enxuto` e `so_trilha` tentam dar ao Jev o padrão da execução numa
forma mais fácil de ler; `acoes` e `acoes_completo` vieram de ver que muitos
passos recentes liam `(sem resultado gravado)` (comandos que esperaram aprovação).

A **vencedora é `escopo`**, escolhida no ajuste (melhor top-1, estrito e por
equivalência); a validação não foi usada para escolher. Duas coisas a
ler na tabela: as diferenças entre `kickoff` … `progresso` estão dentro dos
intervalos de confiança (±7 pontos), então não se mostra que "mais entrada" atrapalhe ou ajude
além do primeiro passo; e `fluxo` tem o melhor número de validação (75%) mas fica
abaixo da vencedora no ajuste (55% contra 59%), e é por isso que não foi a vencedora
— escolhê-la agora seria escolher pela validação.

De onde vem cada campo novo no engine (`apps/engine/lib/engine/…`):

| campo | fonte |
|---|---|
| `pedido` (dev) | `initial_message/2`, `dev/dev_agent_server.ex:484`; títulos de tarefa e história de `tasks`/`stories` |
| `pedido` (`qa-automacao`) | `initial_message/2`, `gates/qa_automacao_agent.ex:108`; tarefa do último `dev.awaiting_gate`, requisitos da história |
| `pedido` (`qa-estrategia`, `appsec`) | `gates/qa_estrategia_agent.ex:93`, `gates/appsec_agent.ex:79`; **a história não é recuperável do log**, então a mensagem diz isso e carrega o mapa de módulos |
| passos recentes por execução | `ToolLoop.Default.init/1` e `loop/1` (`harness/tool_loop.ex`): `messages` é montado por `run` |
| resultados completos, `texto` | as mensagens `tool` e `assistant` que `loop/1` acrescenta (`concluir_despacho/5`, `append(ctx, message)`); o log corta resultados em 2 000 |
| resultados de comandos aprovados (`acoes`) | `texto_do_desfecho/1`, `dev/dev_agent_server.ex:460`; o log não tem `tool.result` para eles, só `proposed_actions.execution_result` |
| `progresso`, `trilha` | contagens sobre as chamadas anteriores da execução nas mesmas `messages` |

Não portados, e dito em `kickoff.ts`: a Anamnese (a mensagem dela é montada
a partir de uma janela do log e da lista de membros, que o log não guarda),
`infra-workflows` (mapa de contexto), e os agentes conversacionais (o `pedido` deles
continua sendo a última mensagem do usuário).

### A cascata (validação, passos com ferramenta) {#the-cascade-validation-steps-with-a-tool}

Cada linha é a anterior mais uma peça, nos mesmos 160 passos.

| passo | n | top-1 (IC 95%) | top-2 (IC 95%) |
|---|---|---|---|
| entrada da primeira rodada, regra estrita | 160 | 78/160 = 49% (41–56%) | 118/160 = 74% (66–80%) |
| + E1 terminal-leitura ≡ leitura | 160 | 92/160 = 57% (50–65%) | 125/160 = 78% (71–84%) |
| + E2 `read_file` ≡ `search_workspace` | 160 | 93/160 = 58% (50–65%) | 131/160 = 82% (75–87%) |
| + E3 terminal que escreve ≡ `write_file` | 160 | 93/160 = 58% (50–65%) | 131/160 = 82% (75–87%) |
| + `pedido` = a primeira mensagem do laço | 160 | 116/160 = 73% (65–79%) | 145/160 = 91% (85–94%) |
| + passos recentes só da execução corrente | 160 | 117/160 = 73% (66–79%) | 144/160 = 90% (84–94%) |
| + resultados até 2 000 caracteres | 160 | 110/160 = 69% (61–75%) | 141/160 = 88% (82–92%) |
| + o texto do modelo de passos anteriores | 160 | 116/160 = 73% (65–79%) | 149/160 = 93% (88–96%) |
| + contagens derivadas | 160 | 112/160 = 70% (62–77%) | 148/160 = 93% (87–96%) |

Duas linhas carregam todo o movimento: as equivalências (+9 pontos) e a primeira
mensagem do laço (+15). Depois de `escopo` nada move o top-1 para fora do intervalo,
e os resultados reconstruídos para comandos aprovados (`acoes`) o baixam. Os 47% da
primeira rodada, na mesma entrada, são 58% sob as equivalências declaradas.

### A manchete {#the-headline}

Variante `escopo`, validação, 160 passos com ferramenta (mais 1 sem, que o
Jev errou):

| | |
|---|---|
| **top-1, regra de equivalência** | **117/160 = 73% (66–79%)** |
| top-1, regra estrita (comparável aos 47%) | 105/160 = 66% (58–73%) |
| top-2 (menu restrito a 2), equivalência / estrita | 144/160 = 90% (84–94%) / 134/160 = 84% (77–89%) |
| top-3, equivalência | 148/160 = 93% (87–96%) |
| linha de base "repetir a ferramenta anterior" (gratuita), equivalência / estrita | 122/149 = 82% (75–87%) / 108/149 = 72% (65–79%) |
| menu de 2 sem segunda chamada, {escolha do Jev, ferramenta anterior}, equivalência / estrita | 140/160 = 88% (81–92%) / 125/160 = 78% (71–84%) |
| sem a Anamnese (kickoff não reconstruído; pausada no produto) | 115/158 = 73% (65–79%) |

**O Jev não bate a linha de base gratuita.** Nos mesmos passos de validação,
"repetir a ferramenta anterior" faz 82% (72% estrito), acima dos 73% (66%) do Jev. A
única vantagem dele aparece na união: oferecer a escolha do Jev *e* a ferramenta anterior
chega a 88% (78% estrito), 15 pontos acima do Jev sozinho, sem chamada extra. Nenhuma
configuração chega a 90% no top-1, e nenhuma tem limite inferior em 90%.

Por agente (validação, equivalência): `dev-board-engine` 23/24 = 96% (80–99%),
`dev-persistence` 28/34 = 82% (66–92%), `dev-scoring` 31/38 = 82% (67–91%),
`dev-game-session` 28/38 = 74% (58–85%), **`qa-estrategia` 4/16 = 25% (10–49%)**,
`appsec` 1/3, `infra` 0/2, `infra-workflows` 0/2, `dev-lead` 0/1 (`qa-estrategia`
e `appsec` têm a primeira mensagem reconstruída mas sem a história; os outros
três não a têm reconstruída de jeito nenhum).

A confiança ainda não separa certo de errado:

| limiar | menu restrito a 1 | certos entre os restringidos (IC 95%) |
|---|---|---|
| 0.00 | 155/160 | 117/155 = 75% (68–82%) |
| 0.40 | 123/160 | 95/123 = 77% (69–84%) |
| 0.60 | 55/160 | 44/55 = 80% (68–88%) |
| 0.70 | 32/160 | 23/32 = 72% (55–84%) |
| 0.80 | 16/160 | 8/16 = 50% (28–72%) |
| 0.90 | 10/160 | 4/10 = 40% (17–69%) |

Acima de 0,7 a acurácia *cai*: os erros confiantes são os descritos abaixo
(o Jev tem certeza de que depois de escrever os testes vem rodá-los).

### A distância, por causa {#the-gap-by-cause}

Os 82 erros de validação da regra da primeira rodada, e o que cada peça da
cascata fez com eles (passos com ferramenta, n = 160):

| causa | passos | pontos | parcela da distância |
|---|---|---|---|
| **régua** — a escolha do Jev era equivalente (E1–E3, declaradas de antemão) | 15 | 9.4 | |
| **régua** — sobra: as classes ainda perdem um caso (3 passos, abaixo) | 3 | 1.9 | 22% (18 passos) |
| **entrada** — a primeira mensagem do laço (`kickoff`) | 23 | 14.4 | |
| **entrada** — `escopo` | 1 | 0.6 | |
| **entrada** — sobra: primeiras mensagens não reconstruídas, ou um resultado fora do log (7) | 7 | 4.4 | 38% (31 passos) |
| **o ritmo do agente**, não um campo do state (abaixo) | 29 | 18.1 | |
| **o Jev diverge sem que o state o justifique** (4) | 4 | 2.5 | 40% (33 passos) |
| total | 82 | 51.3 | |

Os 43 erros que sobraram depois da última peça recuperada foram lidos um a um (não uma
amostra): o state enviado, as ferramentas chamadas, o texto do próprio modelo naquele passo
(que o Jev nunca vê) e a escolha e a confiança do Jev. Resultado:

- **Régua, 3.** `dev-board-engine` `terminal`→`search_workspace`: o comando do
  agente era um `find … | sort; ls; for f in docs/*; do …cat` — só leitura, mas
  um laço `for` não está na lista de só leitura, então é pontuado como execução. Mais
  dois `read_file`→`terminal` em que o agente vinha lendo por
  `terminal` o tempo todo: equivalentes em qualquer leitura, mas as classes são
  assimétricas de propósito e isso não foi repontuado.
- **Entrada, 7.** Todos os erros de `infra` (2 passos), `infra-workflows` (2) e
  `dev-lead` (1) — cinco passos cuja primeira mensagem o porte não reconstrói —
  mais os dois `report_done`→`terminal` em que o resultado do último comando
  ("exit 0, a suíte passou") não está no log. A variante `acoes` reconstrói
  esses resultados e, no geral, deixou o Jev *pior* (61%): diante de um sandbox
  falhando, ele diz `report_blocked` onde o agente continuou tentando.
- **O ritmo do agente, 29.** O Jev nomeia a *próxima etapa* do fluxo e o
  agente fica mais um passo na atual:
  14 × `write_file`→`terminal` (o Jev: "os testes estão escritos, rode-os", 8
  deles com confiança ≥ 0,6, até 0,98; o agente escreveu mais dois ou três arquivos
  antes), 12 × `qa-estrategia` `read/search`→`emit_plano_de_teste` (o Jev
  salta para a ferramenta final do kickoff com confiança 0,25–0,56; o agente
  explorou ~15 passos antes de emitir), 2 × `appsec` o mesmo, 1 ×
  `terminal`→`report_blocked` depois de uma ação negada. Em todos eles a
  escolha do Jev é o que um leitor do log chamaria de próximo passo natural.
  O que decide "quantos arquivos a mais, quantas leituras a mais" é o plano do modelo,
  que não está em nenhum campo que o produto pudesse entregar ao roteador — ele existe, uma vez, no
  próprio texto do passo que se está prevendo.
- **O Jev diverge, 4.** `write_file`→`search_workspace` duas vezes com confiança
  0,25–0,26, `rag_search`→`terminal` duas vezes (0,24, 0,59). São os únicos passos
  em que o state não explica a escolha: 2,5% dos passos.

Então: de uma distância de 51 pontos entre os 49% da primeira rodada e 100%, cerca de **um quinto
era a régua, cerca de dois quintos era entrada que faltava ao replay** (e a
parte recuperável dela está recuperada), **e dois quintos é o ritmo do agente**,
com **5% dos passos um erro puro do Jev**. O que resta da entrada são no
máximo 4 pontos, e não é o que separa 73% de 90%.

### O que seria preciso para 90%, e quanto vale cada peça {#what-would-be-needed-for-90-and-what-each-piece-is-worth}

Passos de validação, 43 erros; 90% é 144/160, isto é, 27 acertos a mais.

| peça | passos no máximo | nota |
|---|---|---|
| terminar o porte da entrada (Anamnese, `infra-workflows`, primeiras mensagens dos conversacionais; a história de `qa-estrategia`) | até +7 → 79% | um limite superior: com a entrada completa o Jev não foi melhor aqui, e reconstruir resultados o piorou |
| apertar as classes (laços `for`, terminal-como-leitura no outro sentido) | +3 → 75% | é régua, não acurácia; decidir isso depois de ver os erros é o que o protocolo proíbe, então não está na manchete |
| o ritmo do agente | até +29 | não é campo do state; as únicas portas de entrada são um **menu de 2 que inclua a ferramenta anterior** (medido: 88%, 81–92%) ou o top-2 (90%, 84–94%) |

Lendo como decisão de produto, que é da AT-239: um roteador que precisa *escolher
uma* ferramenta fica em cerca de três quartos e abaixo da linha de base gratuita; um roteador
que *restringe o menu a duas* chega a nove em dez, e a ferramenta anterior é um
segundo nome tão bom quanto o segundo do próprio Jev. Esta seção não afirma nenhum dos
dois ganhos.

### Latência e custo (variante `escopo`) {#latency-and-cost-variant-escopo}

| | |
|---|---|
| tokens de entrada por pedido | p50 1 866, p95 2 557, máx 3 220 (a primeira rodada: mediana 1 710, máx 3 220) |
| latência (328 pedidos, sequenciais) | p50 317 ms, p95 449 ms, máx 814 ms; **0 acima de 2 000 ms** |
| custo | US$ 0,0000769 por passo (US$ 0,025233 para 328), e `GET /api/v1/generation` para cada um dos 328 ids soma os mesmos US$ 0,025233 (razão 1,000) |
| esta rodada inteira | US$ 0,414 por `usage.cost` — 12 variantes, 3 delas duas vezes em parte da metade de ajuste — contra um teto de US$ 1,00 |

As variantes mais ricas custam mais entrada (`acoes_completo`: mediana de 3 360 tokens, cerca de
US$ 0,00014 por passo contra 0,00008) e não compram nada; o state que vence é também o
barato. O teto de 2 000 ms da AT-236 tem folga de um fator de dois.

### O que esta rodada ainda não enxerga {#what-this-round-still-cannot-see}

- A **história** dos dois gates que rodam antes de qualquer código (`qa-estrategia`,
  `appsec`): o pedido que os inicia é interno e não vai para o log.
- A primeira mensagem da **Anamnese**, de `infra-workflows` e dos
  agentes conversacionais; e o prompt de sistema por trás de `contexto`.
- **Verdade de referência.** O rótulo continua sendo a ferramenta que o modelo de chat chamou, e a maioria
  dos 29 erros de ritmo são escolhas que um leitor humano chamaria de razoáveis, e
  é por isso que o top-2 e a união dizem mais do que o top-1.
- **Efeito.** Um menu restrito muda o que o modelo faz a seguir; AT-239.

## Menu de 2 opções (2026-09-29): restringir em vez de escolher {#menu-of-2-options-2026-09-29-restrict-instead-of-pick}

> Pedido pelo dono depois da segunda rodada, em que o top-1 do Jev (73%) ficou abaixo de
> 90% mas um menu de dois ({a escolha do Jev, a ferramenta anterior}) e o top-2 do Jev
> pareciam bons: **testar o menu de 2 opções**. Só um resultado cujo **limite inferior
> do intervalo de 95% seja pelo menos 90%** é um "sim" claro. **Não é: nenhuma política
> chega lá.** A melhor política de 2 opções, a P3, cobre **91% (85–94%)** dos
> passos de validação, isto é, a ferramenta certa está dentro do menu; o limite inferior
> é 85%, cinco pontos abaixo da linha. E isto é *cobertura*, um teto para a
> acurácia ponta a ponta (ver "O teto"), não a acurácia em si. Mesma
> instância, mesmas ressalvas das rodadas anteriores; nada aqui muda o produto
> (isso é a AT-239). Reproduza com `pnpm --filter @brabo/scripts jev:menu`.

### Políticas (escritas antes de rodar, em `scripts/jev/menu.ts`) {#policies-written-before-running-in-scriptsjevmenuts}

Uma política transforma a resposta do Jev num menu restrito. As decisões do dono
valem em toda parte: o Jev só **restringe** o menu, e quando ele responde
`responder_sem_ferramenta` o catálogo **inteiro** fica (AT-236); teto de
2 000 ms (0 de 328 pedidos o ultrapassaram na segunda rodada). Nada foi
reclassificado depois de ver um resultado; `menu.spec.ts` fixa o que cada política devolve.

| política | menu |
|---|---|
| P0 | o catálogo inteiro (âncora: 100% de cobertura, não restringe nada) |
| P1 | as duas ferramentas mais prováveis do Jev |
| P2 | {a escolha do Jev, a ferramenta anterior da mesma execução} |
| P3 | P2, mas se o Jev diz `responder_sem_ferramenta` (ou não há ferramenta anterior) o menu é o catálogo inteiro |
| P4 | {a escolha, a ferramenta anterior, a segunda do Jev} (até 3; só referência) |

Regras comuns a todas: uma resposta que falhou (timeout, erro, escolha fora das
opções) deixa o catálogo inteiro; uma ferramenta anterior que não está no
catálogo do agente é ignorada; um menu que sairia vazio é o catálogo inteiro.

**Cobertura** = a fração dos passos com ferramenta em que a ferramenta que o agente
de fato chamou está *dentro* do menu — estrita (mesmo nome) e por equivalência (as
classes E1–E3 da segunda rodada, então um menu com `read_file` cobre um `terminal`
que só lê). **Taxa de restrição** = a fração dos passos em que o menu
é menor que o catálogo do agente: uma política que quase nunca restringe é
trivialmente "100%" e inútil, então a cobertura também é dada *entre os passos
restringidos*. Variante `escopo` (a vencedora da rodada dois), metade de validação, 160 passos
com ferramenta (mais 1 sem).

### Os números (validação) {#the-numbers-validation}

| política | cobertura, equivalência (IC 95%) | estrita | restringe | cobertura entre os restringidos | ferramentas expostas, antes → depois | tokens de definição por chamada, antes → depois |
|---|---|---|---|---|---|---|
| P0 | 160/160 = 100% (98–100%) | 100% | 0/160 = 0% | — | 7.4 → 7.4 | 746 → 746 |
| P1 | 144/160 = 90% (84–94%) | 134/160 = 84% (77–89%) | 158/160 = 99% | 142/158 = 90% (84–94%) | 7.4 → 2.0 | 746 → 150 |
| P2 | 143/160 = 89% (84–93%) | 128/160 = 80% (73–85%) | 157/160 = 98% | 140/157 = 89% (83–93%) | 7.4 → 1.3 | 746 → 102 |
| **P3** | **145/160 = 91% (85–94%)** | 132/160 = 83% (76–88%) | 147/160 = 92% (87–95%) | 132/147 = 90% (84–94%) | 7.4 → 1.6 | 746 → 138 |
| P4 | 149/160 = 93% (88–96%) | 142/160 = 89% (83–93%) | 158/160 = 99% | 147/158 = 93% (88–96%) | 7.4 → 2.2 | 746 → 166 |

**Qual é a melhor.** A P3 é a que importa: a maior cobertura das
políticas de 2 opções, ela honra a regra do dono e restringe 92% dos
passos. **O limite inferior dela é 85,1%; o da P1 é 84,4%, o da P2 83,6%, o da P4 88,1%.**
A P4 é a mais próxima da linha, mas um menu de até 3 não é a pergunta que foi
feita. Toda política fica sem o "sim claro"; P1 e P3 caem *em* 90% na
estimativa pontual, os mesmos "90% (84–94%)" que a segunda rodada já tinha para o top-2 —
a ferramenta anterior não acrescenta nada à cobertura sobre o segundo palpite do próprio Jev, ela
só deixa o menu menor (1,6 ferramenta contra 2,0).

**Duas coisas que a tabela esconde.**

- **A P3 oferece uma ferramenta só em 98 dos 160 passos.** Quando a escolha do Jev *é*
  a ferramenta anterior, o menu tem um nome (P2: 108 de 160). Esses menus cobrem
  89 de 98 (91%). Os outros 49 passos restringidos têm menu de dois e cobrem 43
  (88%). Um "menu de 2" é, na maior parte do tempo, um menu de 1 sem escolha deixada ao
  agente: ele é forçado.
- **O intervalo é otimista.** Wilson trata os 160 passos como independentes,
  e eles não são: a validação é **10 execuções** (as tarefas de quatro dev agents, os
  gates `qa-estrategia`, `appsec` e `infra-workflows`, e a Anamnese, o Infra
  e o Dev Lead), e passos consecutivos de uma execução compartilham pedido, arquivos e resultados.
  Com tão poucos clusters o intervalo honesto é mais largo do que os impressos. Isso não
  muda a resposta (um "não" não melhora), mas um "sim" também não teria sido
  conquistado por 160 passos.

### Ajuste e os passos novos {#tuning-and-the-new-steps}

| política | ajuste (161 passos) cobertura, equivalência | restringe | passos novos (36) cobertura |
|---|---|---|---|
| P1 | 144/161 = 89% (84–93%) | 156/161 = 97% | 36/36 |
| P2 | 143/161 = 89% (83–93%) | 127/161 = 79% | 36/36 (restringe 0) |
| P3 | 147/161 = 91% (86–95%) | 115/161 = 71% | 36/36 (restringe 0) |
| P4 | 148/161 = 92% (87–95%) | 156/161 = 97% | 36/36 |

O ajuste diz o mesmo que a validação (P3 91%, limite inferior 86%), como esperado, já que
nenhuma das políticas foi ajustada. Ele carrega os 32 passos da Anamnese, para os quais o
Jev diz `responder_sem_ferramenta` e a P3 portanto deixa o catálogo inteiro:
71% de restrição em vez de 92%. **Os 36 passos novos** (o banco de dev foi de
333 para 369 linhas de uso depois do retrato) são **todos da Anamnese**, um agente que está
pausado no produto: o Jev responde "nenhuma ferramenta" e P2/P3 abrem o catálogo
inteiro, então "36/36" é trivialmente verdade e não diz nada sobre o menu. Todos os passos
juntos e sem a Anamnese (287 com ferramenta; a metade de ajuste já escolheu
a variante, então isto *não* é uma validação limpa): P1 89% (84–92%), P2 88%
(84–91%), **P3 90% (86–93%)**, P4 92% (88–94%). Mais passos estreitam o intervalo, mas
o limite inferior fica em 86%; com uma cobertura verdadeira perto de 91% são precisos cerca de três
mil passos para o limite inferior passar de 90%, e o que ajudaria é um roteador
melhor, não uma amostra maior.

Sensibilidade, não escolha: com qualquer uma das doze variantes de `state` a P2 cobre
88–91% e a P3 89–92% dos passos de validação, então o resultado não depende de
`escopo` (a P1 depende: 82% com a entrada original, 93% com `texto` ou `fluxo`).
Nenhuma variante tem limite inferior em 90% também — os mais altos são a P1 com `texto`
(88%) e a P3 com `enxuto` (87%) — e escolher uma depois de ver isto é exatamente
o que o protocolo proíbe.

### Onde a cobertura falha {#where-coverage-fails}

P3, validação, os 15 passos fora do menu: `write_file` usado enquanto o menu
era `terminal` (4), `read_file` enquanto `terminal` (2), `report_done` enquanto
`terminal` (2), `write_file` enquanto {`search_workspace`, `terminal`} (2), e cinco
casos avulsos entre os gates e os agentes conversacionais (`emit_plano_de_teste`
oferecida em vez de `rag_search` ou `search_workspace`, e o inverso). É a
distância de ritmo da rodada dois vista do outro lado: o Jev nomeia a próxima etapa,
o agente dá mais um passo na atual — e um agente cujo menu é
`terminal` não consegue escrever o arquivo com a ferramenta feita para isso. Por agente (P3,
equivalência): `dev-board-engine` 23/24 = 96% (80–99%), `dev-scoring` 35/38 = 92%
(79–97%), `dev-persistence` 31/34 = 91% (77–97%), `qa-estrategia` 14/16 = 88%
(64–97%), `dev-game-session` 32/38 = 84% (70–93%); os demais têm menos de quatro
passos.

### O teto: o que a cobertura não diz {#the-ceiling-what-coverage-does-not-say}

**Cobertura é um teto para a acurácia ponta a ponta, não a acurácia.** O menu
contém a ferramenta certa; o modelo do agente ainda precisa escolhê-la entre as
opções. O rótulo ("a ferramenta que o modelo de chat chamou") é a escolha que o agente
fez *a partir do catálogo inteiro*, então um menu cheio é 100% por construção e um
restrito só pode perder. O que se pode dizer sem o produto, para a P3 na
validação, dividindo os 160 passos:

- **99 (62%, 54–69%)**: toda ferramenta do menu é certa, então qualquer escolha do agente
  é certa — o piso.
- **46 são "disputados"**: exatamente uma das opções é certa e o agente decide
  sozinho — 28 só a ferramenta anterior, 18 só a escolha do Jev. Um agente que sempre
  pega a ferramenta anterior termina em 127/160 = 79%; um que sempre pega a escolha do
  Jev, 117/160 = 73% (as linhas de base da rodada dois de novo); um que tira cara ou coroa, 76%.
  Um agente que escolhe melhor que os dois, que é toda a aposta, cai entre 79%
  e o teto de 91%.
- Os outros 15 estão fora do menu: perdidos, faça o agente o que fizer.

Então a faixa ponta a ponta vai de 62% a 91%, e onde ela cai depende de quão bem o
modelo do agente lê a *situação*, que o replay não enxerga. **Só o teste
ao vivo (AT-239) responde isso.**

### Economia nas definições de ferramentas {#savings-in-tool-definitions}

O catálogo tinha a *descrição* de cada ferramenta (`catalogo.json`) e agora também
`definicoes`: o tamanho em bytes do `spec/0` completo de cada ferramenta (nome,
descrição e schema de parâmetros), serializado pelo engine (`catalogo.exs`,
rodado de novo; o resto do arquivo não mudou). Tokens são bytes divididos por 4, a
aproximação que o replay inteiro usa. Na validação a P3 vai de **746 para 138
tokens de definição por chamada — 608 tokens, 81% a menos**: as oito ferramentas de um dev agent
pesam 3 068 bytes e um menu de dois pesa cerca de 500. A P1 economiza 596, a P2 644
(médias sobre os passos da metade; a metade de ajuste economiza menos porque a
Anamnese mantém o catálogo inteiro).

Quanto isso vale é outra pergunta. A chamada ao Jev em si lê ~1 870 tokens
(US$ 0,0000769) num modelo muito mais barato que o do agente; a economia de definição
é de 608 tokens do modelo do agente por chamada. O ponto de equilíbrio é um preço de entrada de
US$ 0,126 por milhão de tokens (0,0000769 / 608): acima dele a economia paga a
chamada ao Jev, ignorando cache. **O cache é a pegadinha**: os providers fazem cache do prefixo
do pedido, as definições de ferramentas vêm primeiro, e um menu que muda de passo a passo
muda o prefixo — a economia pode ser devolvida em faltas de cache. Isso é uma
medição ao vivo, e o motivo de o teste abaixo registrar a razão de tokens em cache.

### O teste ao vivo (não executado): desenho {#the-live-test-not-run-design}

- **Pergunta.** Com a P3 na frente do agente, o trabalho do agente piora,
  e quanto ele fica mais barato? Não "a ferramenta está no menu" (isso é esta
  seção).
- **Etapa 1, sombra (barata, antes de qualquer usuário ver um menu).** Para cada passo de uma
  amostra reservada, perguntar ao *próprio modelo do agente* duas vezes sobre o mesmo state, com o
  catálogo inteiro e com o menu da P3, e comparar a ferramenta que ele escolhe pela
  regra de equivalência. Métrica: concordância entre as duas, com o limite inferior do
  intervalo de 95%. Para mostrar uma concordância verdadeira de 94% com o limite inferior em 90% (poder de
  80%): cerca de **390 passos**, tirados de **pelo menos 40 execuções diferentes** e
  **mais de um projeto** (esta amostra tem 21 execuções num projeto),
  intervalo por cluster (execução), não por passo.
- **Etapa 2, A/B ao vivo, só se a etapa 1 passar.** Braços: controle (catálogo inteiro) e
  P3, sorteados **por execução**, nunca por passo (o menu de um passo molda o
  seguinte). Métrica primária: a execução chega ao gate sem retrabalho,
  margem de não inferioridade de 5 pontos; com 80% de conclusão, 5% unilateral e poder de 80%,
  cerca de **790 execuções por braço** (uma margem de 10 pontos precisa de cerca de 200).
  No volume deste projeto (7 execuções de dev na amostra inteira) isso exige muitos
  projetos ou semanas. Secundárias: passos por execução, tokens de entrada *incluindo a
  razão de tokens em cache*, custo por execução, latência acrescentada pelo Jev (p50/p95,
  teto de 2 000 ms), e a parcela dos passos em que o Jev deixa o catálogo
  inteiro.
- **Guardas.** Uma flag de desligamento por projeto; cair para o catálogo inteiro em qualquer
  falha do Jev ou acima do teto de latência (já em toda política); um jeito de o
  agente pedir o catálogo completo quando o menu não tem o que ele precisa
  (um menu de um força a ferramenta, 61% dos passos aqui); uma olhada intermediária a cada
  100 execuções, parando se a métrica primária cair mais do que a margem;
  a Anamnese fora da amostra (pausada); o menu e a escolha registrados em todo
  passo, para que a análise seja uma consulta, não uma lembrança.

### O que esta seção ainda não enxerga {#what-this-section-still-cannot-see}

- A **escolha do agente dentro do menu**: o motivo de isto ser um teto.
- **Dependência entre passos**: 10 clusters na validação; os intervalos são
  por passo.
- **Cache de prompt** e **latência no laço do agente**: não medidos (a chamada ao Jev
  é, p50 317 ms; o efeito dela no laço não é).
- O **rótulo**: continua sendo a ferramenta que o modelo de chat chamou, e um menu restrito
  muda o que ele faz a seguir.

### Custo deste teste {#cost-of-this-test}

Uma chamada, para os 36 passos novos: **US$ 0,001275** por `usage.cost` (teto da tarefa
US$ 0,30). As políticas rodam offline sobre as respostas já em disco. O
gasto acumulado do diretório de saída foi de US$ 0,4136 para US$ 0,4149.

## Comparação ao vivo (AT-239, 2026-10-01): restringir, ligado para o Haiku e desligado para o DeepSeek {#live-comparison-at-239-2026-10-01-restrict-on-for-haiku-and-off-for-deepseek}

> A AT-239 (EP-029, HS-063) faz a pergunta que toda seção anterior deixou aberta:
> **com o roteador ligado, os turnos ficam mais curtos, mais rápidos ou mais baratos, e o
> trabalho ainda sai?** As mesmas tarefas, no mesmo modelo do OpenRouter, com o
> roteamento do [ADR 0179](../adr/0179-o-laco-pergunta-ao-jev-qual-ferramenta.md)
> ligado e desligado, em dois modelos de chat de velocidades diferentes.
>
> **Situação em 2026-10-01: medido na terceira tentativa** (abaixo). **Primeira
> tentativa: não medido.** A sessão que construiu o instrumento
> (branch `test/jev-com-e-sem`, de `dev` em `d070b000d7`) tinha uma chave paga e um
> teto de US$ 5,00, mas o proxy de saída dela negou o `CONNECT` para
> `openrouter.ai:443` por política da organização, e também para `repo.hex.pm` e
> `builds.hex.pm`, então nem o engine pôde ser compilado. Nenhuma chamada de chat e
> nenhuma chamada ao Jev saiu da máquina: **gasto US$ 0,00**. O que segue é o
> instrumento, o protocolo e a regra de decisão, todos escritos **antes** de qualquer
> execução, os números que puderam ser medidos sem rede, e depois a
> tabela ao vivo da terceira tentativa.
>
> **Segunda tentativa, mesmo dia: ainda não medido, por outro motivo.** O
> dono liberou `openrouter.ai` na saída da sessão (um `GET` respondeu 200),
> e os dois modelos do protocolo estavam listados com suporte a ferramentas
> (`deepseek/deepseek-v4.1-flash` a US$ 0,03/0,50 por milhão de entrada/saída,
> `anthropic/claude-haiku-4.5` a US$ 1,00/5,00). A primeira chamada de chat voltou
> `HTTP 403 Key limit exceeded (total limit)`: a chave de teste tem limite de US$ 10,00,
> US$ 10,05 já usados e nenhum reset (`GET /api/v1/key`). Um smoke de uma
> tarefa, fora do protocolo e em pasta própria, gastou **US$ 0,00**; nenhuma
> execução do protocolo foi gravada. Rodá-lo exige que o dono suba o
> limite da chave (ou entregue outra chave) — cerca de US$ 1,28 pela estimativa abaixo,
> menos ao preço atual do DeepSeek. O smoke também achou duas coisas que a rede
> falsa nunca acharia, ambas corrigidas ou documentadas no instrumento:
>
> - **Uma falha de conta ou de rede era gravada como execução medida.**
>   As duas execuções do smoke terminaram `erro` no passo 0 com `HTTP 403`, foram gravadas
>   na saída como "a tarefa não saiu", e a retomada nunca as teria
>   repetido: com uma chave morta, todas as 40 execuções teriam entrado na
>   tabela. `falhaDeInfra` (`resumo.ts`) agora classifica um erro de chat de HTTP
>   401/402/403/407/429 ou de transporte como a medição não tendo acontecido; `vivo.ts`
>   não grava essa execução, para a execução com o motivo, e a
>   retomada a repete. Um erro de provider num corpo 200, um 5xx e uma
>   queda do Jev continuam desfechos do braço, como no engine.
> - **O `fetch` do Node ignora `HTTPS_PROXY`.** Atrás de proxy, rode com
>   `NODE_USE_ENV_PROXY=1` (Node ≥ 22.21); sem isso as chamadas iam diretas e
>   a saída respondia 403 com um corpo que não era JSON.
>
> **Terceira tentativa, mesmo dia: medido.** O dono subiu o limite da chave para
> US$ 20,00 (US$ 9,95 restantes antes da execução) e liberou um teto de US$ 4,50. O
> protocolo abaixo rodou exatamente como escrito — os dois modelos, cinco tarefas, duas rodadas,
> 40 execuções, os padrões de `jev:vivo` — no commit `0eab0cb0e9`, sem nenhuma
> falha de conta ou de rede e nenhuma execução interrompida. **Gasto: US$ 0,5195**
> pela soma de `usage.cost` na saída (US$ 0,0424 DeepSeek, US$ 0,4771
> Haiku); o `usage` da chave andou os mesmos US$ 0,5195 (US$ 10,0545 →
> US$ 10,5739, lido cerca de dez minutos depois da execução — uma leitura logo depois dela
> ainda mostrava US$ 0,4597, a cobrança atrasa em relação às respostas). A tabela e
> o veredito estão em "A tabela ao vivo" e "Recomendação" abaixo; o protocolo,
> a regra e a estimativa não foram tocados depois que os números chegaram.

### O que o instrumento roda, e o que é porte {#what-the-instrument-runs-and-what-is-a-port}

`pnpm --filter @brabo/scripts jev:vivo` (arquivos em `scripts/jev/vivo/`) roda o
laço de um dev agent em cinco tarefas pequenas, uma vez com o roteador ligado e outra desligado, e
chama o OpenRouter direto — a api, o engine e o banco não estão
envolvidos, como na validação paga de idioma da AT-167.

| arquivo | papel | produto ou porte |
|---|---|---|
| `roteador.ts` | `recortarEstado`, `montarPedidoAoJev`, `lerRespostaDoJev`, `menuP3`, o teto do `state` | **o código do produto**, reexportado de `apps/api/src/domain/llm/tool-router.ts` |
| `laco.ts` | o laço: teto de iterações, recuperação de chamadas de ferramenta escritas como texto, parada num `report_done`/`report_blocked` aceito, a única nova tentativa com o catálogo inteiro quando um menu restrito recebeu resposta sem ferramenta | porte de `ToolLoop`, `EngineApiClient.llm_turn/5` e `DecidirFerramentaDoPassoUseCase` |
| `recuperacao.ts` | quais passos passaram por `tool_call_recovery.ex` | porte; o spec dele roda os casos de `tool_call_recovery_test.exs` e fixa linhas-âncora do `.ex` |
| `rede.ts` | a chamada de chat (mensagens no fio como a api as escreve) e a chamada ao Jev (teto de 2 000 ms, as mesmas quedas nomeadas) | porte de `toWireMessage`/`toWireTool` e de `JevToolRouter`; linhas-âncora fixadas |
| `ferramentas-dev.exs` → `ferramentas-dev.json` | o `spec/0` **completo** das nove ferramentas de `Engine.Dev.Tools.registry/0` (nome, descrição, schema de parâmetros) | lido do fonte do engine com `elixir` puro, sem engine compilado; um spec falha quando o registro ou uma descrição deriva |
| `tarefas.ts` | cinco tarefas sobre um projeto Node sem dependências, cada uma com uma verificação rodada **depois** do laço (testes originais restaurados, testes ocultos acrescentados): "a tarefa saiu" | do próprio instrumento |
| `executor.ts` | as ferramentas num sandbox temporário, devolvendo os textos do engine onde eles são fixos em código | do próprio instrumento |
| `resumo.ts`, `vivo.ts` | a tabela, a regra de decisão, a estimativa de custo, a CLI | do próprio instrumento |

Fora do instrumento, igual nos dois braços e declarado: o pipeline de
aprovação (`terminal` e `write_file` rodam direto, como no modo automático), a compactação
de contexto, a orientação de idioma e o perfil do autor acrescentados no
fim de cada chamada, o RAG (índice vazio), os contratos de módulos (nenhum declarado),
e o resto do prompt de sistema real (arquivos de instrução, regras de negócio, estado
da tarefa). O prompt de sistema é a identidade de dev do engine mais duas linhas de contexto do
projeto; a primeira mensagem de usuário é o próprio kickoff do engine
(`scripts/jev/kickoff.ts`). O custo de cada chamada é o `usage.cost` da
resposta, o número que a RN-665 ([ADR 0188](../adr/0188-o-custo-real-do-provider-vira-o-numero-do-metering.md))
põe no metering; o `token_usage` do produto não está envolvido.

### Protocolo (escrito antes de qualquer execução) {#protocol-written-before-any-run-1}

- **Modelos**: `deepseek/deepseek-v4.1-flash` (mais lento, raciocínio) e
  `anthropic/claude-haiku-4.5` (mais rápido), os dois que a validação da AT-167 já
  alcançou com definições de ferramentas nesta chave.
- **Tarefas**: `T1-media` (implementar uma função), `T2-moeda` (corrigir um bug de
  formatação), `T3-limite` (a causa está em outro arquivo: `config/`), `T4-slug`
  (criar um módulo e seus testes; testes ocultos o conferem), `T5-renomear` (renomear
  em dois arquivos; nenhum resto do nome antigo pode ficar em `src/`). O estado
  inicial de cada tarefa reprova na verificação e uma solução de referência passa (spec).
- **Amostra**: 2 rodadas → 10 execuções por braço por modelo, 40 ao todo. A ordem dos braços
  alterna por tarefa e rodada, para que nenhum braço pegue sempre o minuto mais
  lento do provider. Teto de iterações 30 (o teto de dev do produto é 60; aqui ele
  limita o gasto).
- **Por execução**: passos; passos cujas chamadas vieram como **texto** e passaram pela
  recuperação; passos em que o roteador foi consultado, aplicou um menu menor,
  deixou o catálogo inteiro sem queda (sem ferramenta anterior, ou o Jev disse
  `responder_sem_ferramenta`), ou **caiu** (com o motivo e a origem
  RN-059); novas tentativas com o catálogo inteiro; chamadas fora do menu do passo;
  latência de relógio da execução inteira (Jev + chat + ferramentas) e da parte de
  LLM; custo do chat e do Jev; como terminou; se a tarefa saiu.
- **Regra de decisão** (`comparar` em `resumo.ts`), por modelo, ligado contra desligado:
  qualidade — a taxa de "a tarefa saiu" do *ligado* não mais que **10 pontos** abaixo
  do *desligado*; custo — o custo médio por tarefa que saiu (chat + Jev) do *ligado* não
  acima do *desligado*; latência — a execução mediana do *ligado* não acima de **1,2×** a do *desligado*.
  **Manter ligado por padrão** se as três valerem em todo modelo; **desligar** se a
  qualidade falhar em todo modelo ou nenhum modelo passar nas três; **restringir** aos
  modelos que passam, caso contrário. Menos de 10 execuções por braço é
  `amostra_insuficiente`, nunca um veredito.

### Estimativa de custo (sem rede) {#cost-estimate-no-network}

`--estimar` com os preços que eram mensuráveis a partir de registros anteriores: entrada do DeepSeek
a US$ 0,30 por milhão e do Haiku a US$ 1,00 (os dois derivados do custo de entrada
pareado relatado em
[Medição da heurística de idioma](medicao-do-idioma.md#incremental-cost-of-the-orientation));
a saída de US$ 1,20 para o DeepSeek é uma **suposição** (não registrada em lugar nenhum) e
US$ 5,00 para o Haiku o preço de tabela. Supostos 12 passos por execução, 400 tokens de
histórico acrescentados por passo, 150 tokens de saída, sem cache:

| modelo | por execução | os dois braços, 2 rodadas |
|---|---|---|
| `deepseek/deepseek-v4.1-flash` | ~US$ 0,015 | ~US$ 0,29 |
| `anthropic/claude-haiku-4.5` | ~US$ 0,049 | ~US$ 0,99 |
| **total** | | **~US$ 1,28** |

A execução para antes de qualquer chamada assim que o `usage.cost` acumulado da pasta
de saída alcança `--teto-usd` (padrão 4.50) e não começa uma execução com
menos de `--reserva-usd` (0.10) restante.

### O que pôde ser medido offline (2026-10-01) {#what-could-be-measured-offline-2026-10-01}

O catálogo de dev cresceu desde o replay: `listar_contratos_de_modulos`
(RN-684) é a nona ferramenta, e `catalogo.json` (oito) está velho para ela — os
746 → 138 tokens do replay já não descrevem o catálogo atual. No fio
(forma de `toWireTool`, `ferramentas-dev.json`):

| | caracteres | ≈ tokens (÷ 4) |
|---|---|---|
| catálogo de dev inteiro, 9 ferramentas | 3 816 | 954 |
| um menu de 2 ferramentas, mediana sobre todos os pares (mín 501, máx 1 464) | 850 | 213 |
| economia por chamada onde a P3 restringe o menu | | **≈ 741** |

O Jev custa US$ 0,0000727 por passo (AT-237), então a economia de definição o paga
num modelo de chat cuja entrada custe mais de **US$ 0,098 por milhão de tokens**
(0,0000727 ÷ 741) — os dois modelos do protocolo, a preço de tabela. A pegadinha é
a mesma escrita em "Economia nas definições de ferramentas": as definições de ferramentas são o
começo do prefixo em cache, um menu que muda de passo a passo quebra o
cache, e o DeepSeek serviu a maior parte da entrada do cache na AT-167. Se a
economia sobrevive a isso, e quanto a chamada extra em série custa em latência dentro
do laço (p50 306 ms por passo, medido fora dele), é exatamente o que a tabela
ao vivo responderia.

### A tabela ao vivo (2026-10-01, commit `0eab0cb0e9`) {#the-live-table-2026-10-01-commit-0eab0cb0e9}

Gerada por `jev:vivo --relatorio` sobre as 40 execuções da execução do protocolo
(todas datadas de 2026-10-01, todas em `0eab0cb0e9`). Os colchetes são o intervalo de 95% da
taxa de "a tarefa saiu".

| modelo | Jev | execuções | a tarefa saiu | passos (mediana · média) | passos via `tool_call_recovery` | execução p50 · p95 | LLM (chat + Jev) p50 | custo/execução (chat + Jev) | dos quais Jev | custo por tarefa saída | Jev: aplicado · sem restrição · queda | novas tentativas com catálogo inteiro | fora do menu |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `deepseek/deepseek-v4.1-flash` | ligado | 10 | 10/10 = 100% (72%–100%) | 5 · 6.5 | 0/65 | 4.8 s · 16.3 s | 4.4 s | US$ 0.0029 | US$ 0.0004 | US$ 0.0029 | 55/65 · 10 · 0 | 0 | 3 |
| `deepseek/deepseek-v4.1-flash` | desligado | 10 | 10/10 = 100% (72%–100%) | 6 · 6.1 | 0/61 | 3.3 s · 25.4 s | 2.9 s | US$ 0.0013 | — | US$ 0.0013 | — | — | — |
| `anthropic/claude-haiku-4.5` | ligado | 10 | 10/10 = 100% (72%–100%) | 6 · 6.4 | 0/64 | 12.7 s · 20.2 s | 12.2 s | US$ 0.0194 | US$ 0.0004 | US$ 0.0194 | 54/64 · 10 · 0 | 0 | 4 |
| `anthropic/claude-haiku-4.5` | desligado | 10 | 9/10 = 90% (60%–98%) | 7 · 7.1 | 0/71 | 13.3 s · 21.6 s | 12.9 s | US$ 0.0283 | — | US$ 0.0314 | — | — | — |

Toda execução terminou com um `report_done` aceito; a única tarefa que não
saiu (Haiku, desligado, `T4-slug` rodada 0) relatou concluída depois de 12 passos com os
testes ocultos falhando. Nenhum passo de nenhum braço precisou de `tool_call_recovery`, o Jev
nunca caiu (nenhum timeout, nenhum erro HTTP, nenhuma resposta inválida em 129 chamadas), e
nenhum menu restrito recebeu resposta sem ferramenta. Os 10 passos "sem restrição" por
braço são o primeiro passo de cada execução, em que não há ferramenta anterior.

A regra (`comparar`), por modelo, ligado contra desligado:

| modelo | qualidade: Δ "saiu" | custo por tarefa saída, ligado ÷ desligado | execução mediana, ligado ÷ desligado | passa |
|---|---|---|---|---|
| `deepseek/deepseek-v4.1-flash` | 0 pontos (dentro de 10) | **×2.21** (acima de 1) | **×1.45** (acima de 1.2) | não |
| `anthropic/claude-haiku-4.5` | 10 pontos a favor do ligado (dentro de 10) | ×0.62 | ×0.95 | sim |

**Veredito da regra: restringir** — o Haiku passa nas três condições, o DeepSeek
falha em custo e latência. A qualidade não falhou em nenhum dos modelos.

Por que os dois modelos se separam, a partir dos registros por passo da mesma saída (tokens
de prompt e os tokens em cache que o provider relatou):

| modelo | Jev | tokens de prompt (todos os passos) | dos quais servidos do cache | custo do chat | custo do Jev |
|---|---|---|---|---|---|
| `deepseek/deepseek-v4.1-flash` | desligado | 131 983 | 111 104 (84%) | US$ 0.0132 | — |
| `deepseek/deepseek-v4.1-flash` | ligado | 97 070 | 43 520 (45%) | US$ 0.0248 | US$ 0.0044 |
| `anthropic/claude-haiku-4.5` | desligado | 228 886 | 0 | US$ 0.2827 | — |
| `anthropic/claude-haiku-4.5` | ligado | 137 059 | 0 | US$ 0.1901 | US$ 0.0043 |

- **A ressalva do cache escrita antes da execução é o que aconteceu no DeepSeek.** O
  menu corta o prompt (−26% de tokens) mas muda de passo a passo, então o
  prefixo em cache quebra: a parcela servida do cache caiu de 84% para 45%, e
  a conta do chat *subiu* ×1,9 com menos tokens enviados. Por cima disso o Jev
  (US$ 0,0004 por execução) é um terço do que custa uma execução inteira desligada.
- **No Haiku não houve cache em nenhum braço** (o instrumento não envia
  `cache_control`, e a forma de fio do produto que ele porta também não), então os
  −40% de tokens de prompt foram direto para a conta: −31% por execução, e o
  Jev é 2% dela.
- **A latência segue a velocidade do chat, como a AT-239 esperava.** A chamada ao Jev é em
  série (p50 232 ms / p95 358 ms por chamada nas execuções do DeepSeek, 217 / 319 ms
  nas do Haiku): numa execução de 13 s do Haiku ela é absorvida por um passo
  a menos; numa execução de 3 s do DeepSeek ela acrescenta 1,5 s à mediana.
- **Qualidade**: uma execução de diferença no Haiku, intervalos se sobrepondo
  (60%–98% contra 72%–100%) — nenhuma evidência de que o roteador ajude a qualidade, e nenhuma
  de que a prejudique, nestas cinco tarefas pequenas.

### Recomendação (medida — o dono decide) {#recommendation-measured--the-owner-decides}

**Restringir**, pela regra escrita antes da execução: manter o roteador ligado onde o
modelo de chat não tem cache de prompt em efeito e é lento o bastante para que uma chamada extra
em série seja pequena (classe Haiku, US$ 1,00/5,00 por milhão), e desligado onde o
provider serve a maior parte da entrada do cache e o chat é rápido
(classe DeepSeek). Os números que o justificam são as linhas da regra acima: Haiku
×0,62 de custo e ×0,95 de latência sem perda de qualidade; DeepSeek ×2,21 de custo e
×1,45 de latência sem ganho de qualidade.

O que isto **não** cobre, e o que restringir exigiria:

- **Só os dev agents (o `ToolLoop`) foram medidos.** A leitura anterior — nenhuma
  evidência para os sete agentes conversacionais — continua valendo; nada aqui
  se estende a eles.
- **A separação é por modelo, e o interruptor do produto é por workspace**
  (`PUT workspaces/:workspaceId/tool-router`). Uma restrição por modelo (ou por "cache em
  efeito") não existe; criá-la é uma decisão nova e uma mudança nova, não feita aqui.
  Até lá a escolha medida por workspace é: ligado
  se os agentes dele rodam num modelo classe Haiku sem cache, desligado se num
  modelo classe DeepSeek com cache.
- **Amostra e tarefas são pequenas** (10 execuções por braço, cinco tarefas de 4 a 16
  passos). As razões de custo e latência são largas o bastante para ler; uma diferença de
  qualidade de uma execução não é.
- **O efeito do cache depende do cache do provider**, não só da velocidade:
  um workspace Haiku com cache de prompt ligado provavelmente se moveria em direção à
  linha do DeepSeek. Não medido.

A recomendação provisória que estava aqui antes da execução (restringir: ligado
para dev agents, desligado para agentes conversacionais) é substituída pelo veredito
da regra acima, como aquele parágrafo dizia que seria.

## Reproduzindo {#reproducing}

```bash
# the catalog, when a tool or an identity changed (inside the dev engine container)
docker cp scripts/jev/catalogo.exs brabo-dev-engine-1:/tmp/catalogo.exs
docker exec brabo-dev-engine-1 mix run --no-start --no-compile --no-deps-check /tmp/catalogo.exs \
  > scripts/jev/catalogo.json

# count the steps and estimate the cost, without calling the network
pnpm --filter @brabo/scripts jev:replay -- --container brabo-dev-postgres-1 --estimar

# the run (resumes: a step already answered in the output is not asked again)
pnpm --filter @brabo/scripts jev:replay -- --container brabo-dev-postgres-1 \
  --arquivo-de-chave ~/.config/brabo/openrouter-test.env --teto-usd 2

# the report again, and the billed cost per generation
pnpm --filter @brabo/scripts jev:replay -- --so-relatorio
pnpm --filter @brabo/scripts jev:replay -- --conferir-custo --arquivo-de-chave ~/.config/brabo/openrouter-test.env
```

A saída (`$XDG_CACHE_HOME/brabo/replay-jev/respostas.jsonl`, senão
`~/.cache/…`, modo 600) carrega ids de sessão e fica fora do checkout — o
script recusa um destino dentro dele. O relatório impresso tem só contagens e
ids de agentes. A chave é lida do ambiente (`OPENROUTER_TEST_KEY`) ou do
arquivo informado, e nunca é impressa nem gravada.

A segunda rodada tem comando próprio, que lê um retrato congelado do banco
(`--dados-cache`, fora do checkout) e grava um arquivo por variante:

```bash
# the snapshot, once (the dev database keeps moving; every later run reads this file)
pnpm --filter @brabo/scripts jev:analise -- --container brabo-dev-postgres-1 \
  --dados-cache ~/.cache/brabo/replay-jev/dados.json --variante original --estimar

# one variant, tuning half first; validation only when the choice is made
pnpm --filter @brabo/scripts jev:analise -- --dados-cache ~/.cache/brabo/replay-jev/dados.json \
  --variante escopo --metade tuning --arquivo-de-chave ~/.config/brabo/openrouter-test.env
pnpm --filter @brabo/scripts jev:analise -- --dados-cache ~/.cache/brabo/replay-jev/dados.json \
  --variante escopo --metade validacao --arquivo-de-chave ~/.config/brabo/openrouter-test.env

# the tables of this section, and the wrong steps for reading by hand
pnpm --filter @brabo/scripts jev:analise -- --dados-cache ~/.cache/brabo/replay-jev/dados.json --relatorio --final escopo
pnpm --filter @brabo/scripts jev:analise -- --dados-cache ~/.cache/brabo/replay-jev/dados.json \
  --variante escopo --metade validacao --dump-erros ~/.cache/brabo/replay-jev/v2/erros.txt
```

O retrato desta rodada foi tirado do banco como ele estava em
2026-09-29 14:27 UTC, mais os eventos `proposed_action.created` e os
desfechos de `proposed_actions` das mesmas sessões; um retrato novo tem mais
passos e uma divisão diferente. O teto é sobre o gasto **acumulado** do
diretório de saída (`--teto-usd`, padrão US$ 1,00), não de uma chamada.

O teste do menu roda offline sobre essas respostas; só os 36 passos nascidos depois do
retrato chamam a rede:

```bash
pnpm --filter @brabo/scripts jev:analise -- --dados-cache ~/.cache/brabo/replay-jev/dados-d.json \
  --variante escopo --metade ambas --arquivo-de-chave ~/.config/brabo/openrouter-test.env

# --dados-base is the snapshot that fixed the split; what it did not know is "new"
pnpm --filter @brabo/scripts jev:menu -- --dados-cache ~/.cache/brabo/replay-jev/dados-d.json \
  --dados-base ~/.cache/brabo/replay-jev/dados-c.json --sensibilidade
```

A comparação ao vivo da AT-239 (precisa de `openrouter.ai` alcançável; a pasta de
saída, `$XDG_CACHE_HOME/brabo/jev-vivo/` por padrão, fica fora do checkout
e o script recusa uma dentro dele):

```bash
# the dev tool definitions, when a dev tool changed (plain elixir, no compiled engine)
elixir scripts/jev/vivo/ferramentas-dev.exs > scripts/jev/vivo/ferramentas-dev.json

# the estimate, without the network
pnpm --filter @brabo/scripts jev:vivo -- --estimar \
  --preco deepseek/deepseek-v4.1-flash=0.3/1.2 --preco anthropic/claude-haiku-4.5=1/5

# the run (resumes; stops before any call at the ceiling, and on an account or
# network failure without recording it), then the table and the verdict;
# behind a proxy, prefix NODE_USE_ENV_PROXY=1 (Node's fetch ignores HTTPS_PROXY)
pnpm --filter @brabo/scripts jev:vivo -- --rodadas 2 --teto-usd 4.5 \
  --arquivo-de-chave ~/.config/brabo/openrouter-test.env
pnpm --filter @brabo/scripts jev:vivo -- --relatorio
```
