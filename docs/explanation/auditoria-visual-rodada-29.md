---
id: auditoria-visual-rodada-29
title: Auditoria visual, antes e depois da Rodada 29
description: A auditoria de telas da AT-290 — as rotas principais capturadas nos dois temas a 1440 px e 390 px, o verificador de layout rodado em cada tela, e o que a Rodada 29 corrigiu, o que persiste e o que é novo, medido em 2026-09-30 contra a dev em 79e6b1209f.
---

# Auditoria visual, antes e depois da Rodada 29 {#visual-audit-before-and-after-rodada-29}

> AT-290 (EP-031, HS-074). Uma **medição, não uma mudança**: nada em `apps/`
> foi tocado para escrever esta página. A captura do "antes" rodou em 2026-09-30
> contra a `dev` em `de18e6a6e2`; a do "depois" rodou no mesmo dia contra a
> `dev` em `79e6b1209f`, que já traz toda a Rodada 29 — o tema preto neutro
> com o acento terracota suave (AT-283/284), `Card`/`Chip`/`Badge`/`Button`
> (AT-286..288), a moldura mobile (AT-316), a barra da sessão (AT-317), o corte
> do fio (AT-319), as correções de aprovações (AT-296..299, AT-310, AT-318,
> AT-320), o orçamento de Configurações (AT-321), os textos de PRs e Containers
> (AT-323, AT-324) e a passada de i18n (AT-289, AT-326).
>
> As capturas de tela **não** estão no repositório. Todo achado cita o nome do
> arquivo da captura para que quem tem a pasta de capturas possa abri-lo; todo
> achado que o verificador mediu cita também o número.

## Como o produto foi levantado (e o que isso não cobre) {#how-the-product-was-brought-up-and-what-that-does-not-cover}

A tarefa pede o compose de produção por `docker/smoke.sh` com
`SMOKE_KEEP_UP=1`. Isso foi tentado, num projeto compose descartável
(`COMPOSE_PROJECT_NAME=r30visual`), e **falha neste ambiente** pelo mesmo
motivo que o "antes" registrou: o proxy de saída bloqueia
`dl-cdn.alpinelinux.org` (e `repo.hex.pm`/`builds.hex.pm`), então o primeiro
`apk add --no-cache build-base git` do `docker/engine/Dockerfile.prod` sai com 2
e nenhuma imagem de produção é construída. O projeto descartável foi removido
com `down -v`.

Por isso o "depois" rodou sobre o **mesmo substituto que o "antes" usou**, de
propósito — uma pilha diferente faria a comparação medir a pilha:

- **Postgres**: `pgvector/pgvector:pg16` num container, as migrations da api e
  `pnpm seed` (o seed rodou limpo num banco novo).
- **api**: `node dist/main` construída deste checkout, porta 3000.
- **engine**: um stub HTTP na porta 4000 que responde 200 a tudo. Sem canal
  Phoenix, sem schema `engine.*`.
- **web**: servidor de desenvolvimento do `vite` na porta 5173.
- **dados**: o seed mais a mesma população roteirizada que o "antes" usou — uma
  sessão criativa com conversa, brief, regra de negócio, um handoff
  Criativo→PO, épico/história/tarefa e um `module_map`; uma segunda sessão
  criativa com um fio realista e um `agent.error`; e **4 `proposed_actions`
  pendentes em 3 sessões** (3 `terminal`, 1 `git_push`), o mesmo formato de
  antes.

Consequências para a leitura desta página:

- O socket da sessão sempre falha, então a faixa de atividade do turno e o
  terminal de Código nunca aparecem, e as sessões pollam no intervalo de
  fallback.
- `GET /workspaces/:id/projects-summary` responde 500 porque
  `engine.dev_agent_states` não existe — artefato do stub, como no "antes".
  "0 agentes" no Dashboard não é achado.
- Os dados **não são idênticos** aos do "antes": o seed agora ativa a própria
  sessão, a oferta Criativo→PO foi superada quando chegaram os eventos de
  backlog do PO (AT-291/292), e a sessão mais recente é consultiva. Onde um
  achado do "antes" depende de dados que não existem mais, ele está marcado
  **não reverificado** em vez de "corrigido".
- As capturas são `fullPage`, mas a maioria das telas rola dentro de um
  contêiner interno, então elas mostram a viewport. Recortes direcionados
  (`detalhe-*`) cobrem o que as capturas inteiras não alcançam.

A captura foi **cadenciada** — 6 s entre telas e 65 s entre passadas de
tema/viewport — e registrou zero respostas 429. O "antes" não foi cadenciado,
então suas capturas de Configurações foram tiradas em parte sob o rate limit; o
rate limit é medido à parte, abaixo (G1).

## Arquivos {#files}

Guardados fora do repositório, no scratchpad da sessão (`shots-depois/`):

- `<screen>--<dark|light>--<desktop|mobile>.png`: 19 telas (login, dashboard,
  as 12 abas do projeto, duas sessões, `/containers`, `/account`, `/status`) × 2
  temas × 2 viewports (1440×900 e 390×844) = 76 capturas.
- `detalhe-*`: a sessão a 1280 e 1024, o topo do fio, o painel de sessões
  laterais recolhido, o fim de uma sessão, "Precisa de você", a gaveta mobile
  nos dois temas, as 11 seções de Configurações e a última seção alcançada sob
  o rate limit.
- `validacao-visual.json`: a saída do `scripts/dev/validacao-visual.js`
  injetado em cada captura, mais o tema efetivamente aplicado (`data-theme`), a
  largura de rolagem horizontal da página, as requisições à api durante a carga
  e os 429.
- `console-erros.json`, `sondas-dark.json`, `g1.json`, `g1-cliques.json`: os
  erros de console e as sondas de DOM citados abaixo.

Os scripts de captura (`capturar-depois.mjs`, `detalhes-depois.mjs`, `g1.mjs`,
`g1-cliques.mjs`, `gaveta.mjs`) são os scripts do "antes" com a cadência e as
sondas acrescentadas.

## O verificador, tela por tela {#the-checker-screen-by-screen}

O `validacao-visual.js` conta quatro tipos de defeito de layout
(`texto-cortado`, `fora-da-viewport`, `recortado-por-ancestral`, `alvo-pequeno`
abaixo de 24 px). Os números são os mesmos nos dois temas em toda tela, antes e
depois, então uma coluna por viewport basta. Os números mobile do "antes" **não
são diretamente comparáveis**: antes da AT-316 a maior parte do conteúdo era
empurrada para fora da tela, e o que o verificador não vê ele não conta.

| tela | desktop antes → depois | mobile antes → depois | requisições à api por carga (depois) |
|---|---|---|---|
| login | 6 → 6 | 8 → 8 | — |
| dashboard | 0 → 0 | 1 → 0 | 6 |
| overview | 3 → 1 | 12 → 2 | 32 |
| executors | 0 → 0 | 4 → 0 | 22 |
| creative | 0 → 0 | 7 → 3 | 20 |
| chat | 0 → 0 | 5 → 1 | 16 |
| insights | 0 → 0 | 4 → 0 | 17 |
| code | 0 → 0 | 2 → 0 | 16 |
| PRs | 0 → 0 | 5 → 1 | 18 |
| approvals | 1 → 1 | 13 → 1 | 23 |
| backlog | 0 → 0 | 5 → 2 | 16 |
| architecture | 0 → 0 | 11 → 0 | 15 |
| spend | 0 → 0 | 9 → 0 | 18 |
| settings | 12 → 6 | 120 → 35 | 52 |
| session | 5 → 2 | 14 → 21 | 21 |
| session 2 | 4 → 1 | 21 → 19 | 21 |
| containers | 1 → 1 | 9 → 8 | 7 |
| account | 0 → 0 | 6 → 2 | 7 |
| status | 1 → 1 | 1 → 1 | 2 |

Só uma tela rola a página inteira para o lado a 390 px: `/status`
(`scrollWidth` 413 contra 390, nos dois temas).

## Os achados do "antes", um por um {#the-before-findings-one-by-one}

Severidade como no "antes": **A** alta (quebra o uso ou engana), **M** média,
**B** baixa (acabamento). Estado: **corrigido**, **parcial**, **persiste** ou
**não reverificado** (os dados que o mostravam não existem mais).

### Moldura e navegação {#shell-and-navigation}

| # | Sev | Estado | O que o "depois" mostra | Evidência |
|---|---|---|---|---|
| S1 | A | parcial | A moldura se reorganiza a 390 px: a sidebar vira gaveta, o trilho do projeto uma faixa horizontal, e nenhuma tela autenticada além de `/status` rola para o lado. A rota de **sessão** não acompanhou — ver N1. | `*--mobile.png`, `detalhe-gaveta-mobile--*.png` |
| S2 | M | persiste | Sidebar "ATIVIDADES — Nenhum agente entrou em ação ainda." ao lado de uma Visão geral com o Criativo "aguardando" e 4 aprovações pendentes. | `projeto-overview--dark--desktop.png` |
| S3 | M | persiste | A lista de abas da sidebar não tem contadores e não marca a aba atual; o trilho mostra "Aprovações 4" e "Arquitetura 1" e destaca a aba. | idem |
| S4 | M | corrigido | Um tratamento de ativo só: tinta terracota com texto terracota no trilho; a linha do projeto na sidebar é neutra. | idem |
| S5 | B | persiste | O alternador de tema ainda lê o estado ("Tema escuro"/"Tema claro"); "sair" continua em minúsculas. | qualquer tela autenticada |
| S6 | B | persiste | Nome do projeto em mono na sidebar e em fonte de display no cabeçalho. | idem |

### Login, Dashboard {#login-dashboard}

| # | Sev | Estado | O que o "depois" mostra | Evidência |
|---|---|---|---|---|
| L1 | B | persiste | Os mesmos 4 alvos abaixo de 24 px. | `validacao-visual.json`, `login--*` |
| L2 | B | persiste | O mesmo texto cortado pela própria caixa. | idem |
| D1 | M | persiste | "0 / 0 USD" e "0%" em verde num projeto sem orçamento. | `dashboard--dark--desktop.png` |
| D2 | M | persiste | "Sem atividade ainda" num projeto com 4 sessões e dezenas de eventos (em parte o 500 do stub, ver o topo). | idem |
| D3 | B | persiste | "+ Novo projeto" com ícone; "+ Nova ideação" e "+ Nova conversa" com um "+" literal. | dashboard × creative × chat |

### Visão geral {#overview}

| # | Sev | Estado | O que o "depois" mostra | Evidência |
|---|---|---|---|---|
| O1 | M | não reverificado | O feed só mostra a sessão mais recente (consultiva), que não tem eventos de PO/Arquiteto. | `projeto-overview--*` |
| O2 | M | persiste | Mais longo agora: "dev-web: ação aguardando decisão — A política decidiu por: default (sem regra aplicável) · raiz do escopo: pasta gerenciada “core-api-665191a6”". | idem |
| O3 | B | não reverificado | A linha do tempo do time está vazia com estes dados. | idem |
| O4 | B | parcial | Os rodapés por origem sumiram ("1 de 1 carregados"), mas o cabeçalho diz "1 eventos" — ver N9. | idem |

### Criativo, Chat, Percepções, Executores {#creative-chat-insights-executors}

| # | Sev | Estado | O que o "depois" mostra | Evidência |
|---|---|---|---|---|
| C1 | M | persiste | Pílulas em mono no Criativo e no Chat, abas sans retangulares em PRs. | `projeto-criativo--*`, `projeto-chat--*`, `projeto-prs--*` |
| C2 | B | parcial | "1 história" agora flexiona; "3 ação(ões) proposta(s) … 0 decidida(s) … auto-aprovada(s)" e "0 chamada(s)" continuam (`sessions.json:164,172,173`, `spend.json:20,37`). | creative, chat, spend |
| C3 | B | não reverificado | A sessão do seed agora é `active`, então o "aguardando" duplo não aparece. | creative |
| C4 | B | persiste | Quatro formatos de estado vazio (texto puro em Percepções, cartão de cadeado em Código, nenhum no Chat, um cartão vermelho na rastreabilidade do Backlog). | abas |
| C5 | B | persiste | Percepções e Arquitetura começam o título em y≈145, as outras abas em y≈116; Histórias tem só o sobretítulo. | `projeto-insights--*`, `projeto-arquitetura--*`, `projeto-backlog--*` |
| C6 | B | persiste | "Conversar/Buscar" acima do título "Chat". | `projeto-chat--*` |

### Código e PRs {#code-and-prs}

| # | Sev | Estado | O que o "depois" mostra | Evidência |
|---|---|---|---|---|
| P1 | M | corrigido | PRs diz "A lista de PRs ainda não está liberada" e explica o portão compartilhado; Código diz "A aba Código ainda não está liberada". | `projeto-prs--*`, `projeto-code--*` |
| P2 | B | persiste | A linha "Já sabe o id?" ainda encosta no fundo do cartão do portão. | `projeto-prs--dark--desktop.png` |

### Aprovações {#approvals}

| # | Sev | Estado | O que o "depois" mostra | Evidência |
|---|---|---|---|---|
| A1 | A | corrigido | O trilho, a aba Aprovações e "Precisa de você" mostram **4**, o número do banco, incluindo o `git_push` de outra sessão; o painel de sessões laterais numa sessão mostra as 3 que pertencem às outras. | `projeto-approvals--*`, `detalhe-precisa-de-voce--dark.png`, `detalhe-sessao2-topo--dark.png` |
| A2 | A | corrigido | O cartão do `git_push` oferece Aprovar/Negar/Modo automático, sem "Sempre permitir". | `projeto-approvals--*` |
| A3 | M | persiste | Ainda várias variantes: 4 botões mais uma nota longa em mono na aba, 3 botões e nenhuma nota em "Precisa de você", 3 botões esticados no painel de sessões laterais. A nota de "Sempre permitir" ainda diz duas coisas: "grava a regra em .brabo/permissions.json" no fio e "libera este tipo de ação só para dev-api" no painel. | `detalhe-sessao2-topo--dark.png`, `detalhe-precisa-de-voce--dark.png` |
| A4 | B | persiste | O glifo ⚠ ainda tem ~8 px e o parágrafo em mono pesa mais que a decisão. | `projeto-approvals--*` |
| A5 | B | persiste | O comando ainda aparece entre aspas retas na fonte proporcional. | idem |

### Sessão {#session}

| # | Sev | Estado | O que o "depois" mostra | Evidência |
|---|---|---|---|---|
| X1 | A | corrigido | A 1440, 1280 e 1024 a barra cabe: o modelo e o idioma da resposta viraram um chip só, o título e os metadados aparecem inteiros, "Encerrar" vira ícone a 1024. O único corte que sobra é a reticência do próprio chip ("… · pt…", 230 px em 217). | `sessao*--*--desktop.png`, `detalhe-sessao-1280--dark.png`, `detalhe-sessao-1024--dark.png`, `sondas-dark.json` |
| X2 | A | parcial | O painel agora tem a largura do fio (x 302–1082), agrupa propostas por sessão ("2 propostas na sessão #cde43f7c") e não repete mais o rótulo. Ainda é um bloco fixo de **345 de 900 px** acima do composer, e o item atrás dele aparece pela borda de cima (y≈387). | `detalhe-sessao2-topo--dark.png`, `detalhe-sessao-fim--dark.png`, `sondas-dark.json` |
| X3 | A | corrigido | Sem grupos por origem; o fio lê pergunta → resposta, em ordem. | `detalhe-sessao2-topo--dark.png` (`grupos: []` em `sondas-dark.json`) |
| X4 | M | parcial | O cartão de handoff não está nestes dados (a oferta foi superada), mas o composer ainda diz "Endereçar handoff". | `sessao*--*` |
| X5 | M | não reverificado | Não há cartão de handoff com que comparar larguras. | — |
| X6 | M | persiste | "ARTEFATOS GERADOS 3" lista um grupo ("PO 1"); na segunda sessão o brief existe e o painel diz "0 · Nada ainda". | `sessao--*`, `sessao2--*` |
| X7 | B | parcial | "ORIGEM: 0 REF(S)" virou "ORIGEM: 0 REFERÊNCIA" — sem jargão, número errado; ver N9. | `sessao2--*` |
| X8 | B | persiste | A mesma sessão abriu em posições de rolagem diferentes nos dois temas. | `sessao2--dark--desktop.png` × `sessao2--light--desktop.png` |

### /containers, /account, /status {#containers-account-status}

| # | Sev | Estado | O que o "depois" mostra | Evidência |
|---|---|---|---|---|
| K1 | M | corrigido | "Parar" e "Remover" estão `disabled` (opacidade 0.5) e a linha diz "Nunca provisionado: não há container para parar nem remover". | `containers--*--desktop.png`, `sondas-dark.json` |
| K2 | M | corrigido | O motivo do broker é uma linha só com um "Por quê?" expansível; nenhum `BROKER_URL` na interface. | idem |
| K3 | B | persiste | Link do projeto com 53×14 px. | `validacao-visual.json` |
| U1 | M | corrigido | A frase "só esta página está traduzida" sumiu. | `account--*` |
| U2 | B | corrigido | Nenhum número de RN nos subtítulos ("Agente local"); o parágrafo longo antes da tabela fica. | idem |
| T1 | B | persiste | Carimbo ISO cru, "Último check", "—" para o engine e "Voltar" como link pequeno. A 390 px a página também transborda — ver N5. | `status--*` |

### Configurações {#settings}

| # | Sev | Estado | O que o "depois" mostra | Evidência |
|---|---|---|---|---|
| G1 | A | parcial | O caminho da própria tela está corrigido: uma carga (52 requisições) mais clicar nas 11 entradas de "Nesta página" custa **18** requisições a mais em 28 s, sem 429. Recarregar por link direto (`?section=`) ainda custa **52 por carga** (55 antes): a sexta recarga em 16 s estourou o limite e a página mostrou "Limite de requisições excedido" (`g1.json`: 362 requisições, 51 × 429 em 30 s). | `g1-cliques.json`, `g1.json`, `detalhe-g1-ultima-secao--dark.png` |
| G2 | M | parcial | As quatro colunas sumiram: "Nesta página" fica acima das seções. "Modelos por agente" ainda corta o nome do agente ("QA de Performance e Segurança", 201 px em 119) e o modelo (173 em 143). No mobile a tabela colapsa — ver N4. | `projeto-settings--*--desktop.png`, `validacao-visual.json` |
| G3 | M | parcial | "Tarefas bloqueadas seguidas até parar" substituiu "Tasks blocked"; "dev agent(s)", "bind-mount", "permissions.json" e "runner" continuam nas seções Execução e "Onde o código mora". | `projeto-settings--*--desktop.png` |
| G4 | M | persiste | "Salvar" em Execução está ativo (terracota) sem nada pendente e sem contagem; "Converter" está inerte. | idem |
| G5–G7 | B | não reverificado | O sumário de seções ancoradas, os chips de capacidade e o placeholder do PAT não foram recapturados nas mesmas condições. | — |

### Arquitetura, Backlog, Gastos, tema claro {#architecture-backlog-spend-light-theme}

| # | Sev | Estado | O que o "depois" mostra | Evidência |
|---|---|---|---|---|
| R1 | B | persiste | "a partir do module_map (create_c4_diagram)". | `projeto-arquitetura--*` |
| R2 | B | persiste | Parágrafo órfão no topo, "Gastos do workspace" dentro de uma aba de projeto, um gráfico só com eixos. | `projeto-spend--*` |
| R3 | B | persiste | O ícone de história ainda é a lâmpada do Criativo. | `projeto-backlog--*` |
| CL1 | M | persiste | "Converter" inerte ainda mal aparece sobre o fundo claro. | `projeto-settings--light--desktop.png` |

## Achados novos {#new-findings}

Coisas que o "antes" não listou — ou novas, ou escondidas até uma correção
tornar a tela alcançável. Nenhuma foi corrigida aqui; cada uma é candidata a AT.

| # | Sev | Tela / tema | Achado | Evidência |
|---|---|---|---|---|
| N1 | A | Sessão, dois temas, 390 px | A página de sessão não ganhou o layout mobile. "Contexto da sessão" mantém ~320 px, o fio fica com ~70 px e quebra uma palavra por linha, o painel de sessões laterais fica ilegível, e "Iniciar ideação"/"Encerrar" caem para fora da borda direita. | `sessao--*--mobile.png`, `sessao2--*--mobile.png`, `detalhe-sessao2-mobile--*.png`; verificador 19–21 `texto-cortado` |
| N2 | M | Sessão, dois temas | Todo `chat.message` é desenhado como o **visualizador** — avatar e nome vêm do usuário logado, nunca de `actorKind`/`actorId` (`apps/web/src/routes/session-timeline-montagem.tsx:379-395`). O `chat.message` de um agente aparece como "owner@brabo.dev"; numa sessão compartilhada a mensagem de outra pessoa apareceria com o nome de quem vê. Estava escondido enquanto o fio dobrava o histórico em grupos por origem (X3). | `detalhe-sessao2-topo--dark.png`; `sondas-dark.json` (`autoriaChatMessage`: três vezes "owner@brabo.dev" para usuário, agente, usuário) |
| N3 | M | /containers, dois temas, 390 px | A tabela espreme as sete colunas na largura: os cabeçalhos "REGISTRADO/OBSERVADO/RECURSOS/DESDE" se sobrepõem, as células quebram uma palavra por linha, e os botões de ação são cortados à direita. | `containers--*--mobile.png`; verificador 8 `texto-cortado` |
| N4 | M | Configurações, dois temas, 390 px | "Modelos por agente" fica inutilizável no mobile: o nome do agente ganha uma caixa de 6 px, o gatilho do modelo 0 px. | `projeto-settings--*--mobile.png`; verificador 33–35 `texto-cortado` |
| N5 | B | /status, dois temas, 390 px | A única página que rola para o lado: `scrollWidth` 413 contra 390; a borda direita da tabela é cortada. | `status--*--mobile.png`, `validacao-visual.json` |
| N6 | B | Dashboard, dois temas, 390 px | A busca encolhe para "Bus" e "Novo projeto" quebra em duas linhas. | `dashboard--*--mobile.png` |
| N7 | B | Criativo, dois temas, 390 px | O id de sessão de cada linha ganha uma caixa de 0 px ("#ae1e5746", "#cde43f7c"), então as linhas perdem o que as identifica. | `projeto-criativo--*--mobile.png`, `validacao-visual.json` |
| N8 | B | Trilho do projeto, dois temas, 390 px | A aba ativa não é rolada inteira para a vista ("Config…" cortado, o "4" de Aprovações recortado) e nada sinaliza que a faixa rola. | `projeto-settings--*--mobile.png`, `projeto-approvals--*--mobile.png` |
| N9 | B | Visão geral e sessão, dois temas | Deslizes de plural da passada do i18next: "1 eventos" (`overview.json:70` tem uma forma só) e "0 referência" (a regra do pt põe o 0 em `one`, então `origemRefs_one` é usado para zero). | `projeto-overview--*--desktop.png`, `sessao2--*` |
| N10 | B | Login, dois temas | O brilho de fundo é `--success-soft` (`apps/web/src/routes/AuthLayout.module.css:80-84`): com o antigo verde-azulado ele lia como a marca; no tema neutro é uma névoa verde atrás de uma página terracota. | `login--dark--desktop.png`, `login--light--desktop.png` |
| N11 | B | Aba Aprovações, dois temas | Todo cartão traz "Motivo da política fora dos eventos carregados nesta tela" — verdade (o motivo mora no log da outra sessão), mas é a ferramenta explicando a si mesma, repetida por cartão. | `projeto-approvals--*` |

## O que esta página não mede {#what-this-page-does-not-measure}

- Contraste. Isso é aritmética sobre os tokens e mora na suíte do web
  (`apps/web/src/lib/contraste.ts`); o verificador aqui só vê layout.
- Nada que esteja atrás do engine: a faixa do turno ao vivo, o terminal, a
  presença dos dev agents. O stub não consegue produzi-los.
- O build de produção. O `vite` de desenvolvimento serve os mesmos componentes e
  CSS, mas não a CSP de produção nem o nginx na frente da imagem do web.
