---
id: validacao-real
title: A validação real — GitHub remoto e modelo de verdade
sidebar_label: Validação real (13b)
sidebar_position: 6
description: A execução contra um repositório remoto de verdade, com dev agent real e modelo de API — o que ela provou, o que ela reprovou, e por que reprovar aqui vale mais que passar.
keywords: [validação, dogfooding, GitHub, dev agent, medição, FASE 13b]
---

# A validação real — GitHub remoto e modelo de verdade

A [validação da Fase 12](./validacao-fase-12.md) declara os próprios limites com
todas as letras: `LocalGitProvider`, `NoopDevAgent`, veredito de gate escrito
pelo próprio script. Ela existe para provar a **cadeia** sem depender de rede
nem de julgamento de modelo, e faz isso bem.

Esta aqui troca exatamente as três coisas que aquela deixou de fora — GitHub
remoto, dev agent real, modelo de API — e o resultado é o que se espera de um
dogfooding honesto: **a metade barata passou inteira, e a metade cara falhou de
um jeito que nenhum teste tinha mostrado.**

O script é `pnpm --filter api validacao:real -- --repo <owner/repo>`.

## O que passou, e é mais do que parece

Tudo abaixo rodou contra `daneiel/test` no GitHub de verdade, e **sem gastar um
centavo** — é a fase `--ate backlog`.

| o que | resultado |
|---|---|
| adoção remota (`getRepo` de verdade) | `origin: adopted`, branch padrão `main` |
| plano em dry-run | 6 mutações, 6 diagnósticos, **decisão nula** |
| repositório intocado até a decisão | verificado pela API: **zero branches, zero conteúdo** |
| readoção converge | 6 mutações na 1ª passada, **3 na 2ª** ([RN-046](../business-rules.md#rn-046)) |
| story única fica `draft` + proposta | sim, sem promoção automática |
| `claimNext` antes da promoção | `null` — nada pegável |
| promoção | registrada com o **usuário** como ator |

A RN-045 deixa de ser provada só contra um bare local: o repositório remoto foi
conferido **depois** da adoção e estava literalmente vazio.

### O achado D aconteceu de verdade

O bootstrap parou em `protect_branches` com
`Upgrade to GitHub Pro or make this repository public` — repositório privado no
plano gratuito. É exatamente o cenário que a Fase D documentou, agora observado
fora de teste.

E a premissa da [RN-078](../business-rules.md#rn-078) se confirmou: conferido o
repositório logo depois, `dev`, `main` e `qa` existiam e os arquivos estavam
commitados. É o **último** passo, e o único cuja falha deixa um repositório
utilizável. O script reconhece a falha e segue, que é a saída desenhada para
isso.

## O que a execução paga mostrou

Modelo `openai/gpt-5-mini` via OpenRouter, dev agent real, uma story com uma
task: *"Expor GET /saudacao"*.

**A task foi bloqueada por `limite de iterações atingido`, com origem
`modelo`.** Nenhuma PR foi aberta, e portanto nenhum gate chegou a julgar.

O diagnóstico gravado é de uma clareza incômoda: `(nenhum terminal rodado)`.

### A medição

Extraída por `pnpm --filter api medir:execucao`, nunca anotada à mão:

| | |
|---|---|
| janela | 1m36s |
| sessões · eventos | 3 · 59 |
| **restart do engine no meio** | **não** |
| voltas de gate | nenhuma (não houve PR) |
| turnos mudos | nenhum |
| intervenções do usuário | nenhuma |

| agente | chamadas | in | out | custo | modelo |
|---|---|---|---|---|---|
| dev-api | 8 | 5.671 | 205 | < US$ 0,01 | `openai/gpt-5-mini` |
| anamnese | 1 | 6.779 | 967 | < US$ 0,01 | deepseek-v4-flash |
| psicologo | 1 | 3.212 | 1.981 | < US$ 0,01 | deepseek-v4-flash |

O critério **zero restarts** fechou. E o custo é a parte menos interessante:
205 tokens de saída em oito chamadas é um agente que não escreveu nada.

### O que o produto descobriu sozinho

O Psicólogo rodou em tier pesado e produziu três hipóteses. A primeira e a
segunda são o diagnóstico correto, sem ninguém apontar:

> O dev-api não tinha (ou não utilizou) um ambiente terminal funcional […] em
> toda a sessão não existe nenhum tool.call de execução de comando […] apenas
> `search_workspace`/`read_file`.

> A ferramenta `search_workspace` está sub-indexada ou mal configurada para
> este repositório: não encontrou nenhum arquivo de código ou manifesto […]
> Isso enganou o agente, que ficou tentando entender "onde está o projeto".

Isto merece registro separado: a introspecção do produto **funcionou**. O
Psicólogo leu o event log de uma execução fracassada e nomeou a causa com
precisão maior que a de qualquer asserção do script.

## Os achados, para a triagem da 13c

A disciplina da fase vale aqui como em todo lugar: **achado novo entra como
item, nunca como fix**.

### X. O dev agent queima o teto de iterações explorando repositório vazio

Dada uma task num repositório recém-provisionado — que tem só o template do
Gitflow, sem código —, o agente gastou as oito iterações em
`search_workspace`/`read_file` procurando "onde está o projeto", e nunca rodou
um comando nem escreveu um arquivo.

O sintoma é `limite de iterações atingido` com origem `modelo`, o que é
tecnicamente verdade e praticamente inútil: o modelo não errou um julgamento,
ele nunca chegou a julgar nada. A causa é a ausência de sinal de que **não há
o que procurar** — um repositório vazio é indistinguível, pelas ferramentas
disponíveis, de um repositório onde a busca falhou.

Vale notar que este é o **primeiro** cenário do produto em que o dev agent
começa do zero absoluto. Todo teste e toda demo partiram de um workspace com
código.

### Y. `search_workspace` não distingue "vazio" de "não encontrei"

Consequência direta do anterior, e provavelmente a peça acionável: as cinco
primeiras chamadas devolveram `nenhum resultado`, o que o agente leu como
"procure melhor" em vez de "não há nada aqui". O Psicólogo chegou à mesma
conclusão sozinho.

## A segunda execução: a correção do Y NÃO fechou o X

Depois de fechar o achado Y, a mesma execução rodou de novo — mesma story,
mesmo repositório, mesmo modelo. **Só a frase da ferramenta mudou entre as
duas.**

| | 1ª execução | 2ª execução |
|---|---|---|
| chamadas do dev-api | 8 | 8 |
| tokens de saída | 205 | 248 |
| desfecho | `limite de iterações atingido` | `limite de iterações atingido` |
| PR | nenhuma | nenhuma |

O comportamento mudou de forma observável — **uma** busca em vez de cinco,
seguida de `read_file` — e o desfecho não. A mensagem nova chegou ao agente e
foi a correta para o caso (`o workspace tem 2 arquivo(s), então a busca
funcionou`), porque o repositório tinha o template do Gitflow e não estava
vazio.

**A hipótese registrada aqui estava errada.** O texto anterior dizia *"a
correção é a frase, não o teto"*. A evidência diz outra coisa: das oito
iterações, sete foram exploração. Sobra UMA para escrever o arquivo, commitar,
dar push e abrir a PR — nem um agente perfeito fecharia isso.

`TOOL_LOOP_MAX_ITERATIONS` é `8` por default
(`apps/engine/config/runtime.exs:100`). O número nasceu para agente
conversacional, e nunca foi reavaliado para um dev agent que precisa explorar
um repositório antes de agir.

O Psicólogo, de novo, foi mais preciso que a asserção do script:

> o workspace não contém o código do projeto: não há package.json, nem src,
> nem README

> ficou apenas em modo leitura/exploração

### O que isso ensina sobre medir

Registrar o resultado negativo é o ponto. Se a segunda execução não tivesse
sido feita, o achado Y — que é real e está coberto por teste — seria fácil de
confundir com a solução do X. Foi uma correção correta que **não** produziu o
efeito esperado, e só a execução mostrou isso.

## A terceira execução: o teto ERA a causa

Com `TOOL_LOOP_MAX_ITERATIONS=25` no lugar de `8`, e nada mais mudado, o dev
agent mudou de patamar:

| ferramenta | 2ª execução (teto 8) | 3ª execução (teto 25) |
|---|---|---|
| `search_workspace` | 2 | 4 |
| `read_file` | 5 | 6 |
| **`write_file`** | **0** | **3** |
| **`terminal`** | **0** | **1** |
| desfecho | limite de iterações | `dev.awaiting_approval` |

Ele explorou, **escreveu três arquivos** e chamou `npm test --silent`. A
hipótese registrada acima estava certa: o teto de 8 — herdado do agente
conversacional — não cabe num dev agent que precisa entender um repositório
antes de agir.

**E o motivo de parar mudou completamente.** Não houve bloqueio: a ação de
terminal virou `proposed_action` com `require_approval` e o agente entrou em
`dev.awaiting_approval` — suspenso, retendo worktree e histórico, como o
[ADR 0052](../adr/0052-dev-agent-espera-aprovacao-no-meio-do-laco.md) desenhou. Ele
parou e esperou, em vez de queimar iterações batendo na porta.

## A quarta execução, e o que ela revelou sobre a Fase F

Liberar `npm`, `pnpm`, `node` e `npx` no `allow` do projeto não destravou: o
agente rodou **`ls -la`**, verbo que não estava na lista, e ficou pendente de
novo.

Isso expõe uma diferença entre o que a Fase F entregou e o que foi pedido. O
pedido era *"permita sempre comandos desde que seja na pasta do projeto"*. O
[ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md) entregou
um **teto**: comando que toca caminho fora da pasta nunca é auto-aprovável, por
mais que o verbo esteja em `allow`. O teto protege o **caminho** — o **verbo**
continua governado pelo allowlist, que é uma lista fechada por desenho.

Consequência prática: cada comando novo que o agente inventa cai em
`require_approval`. A escada continua existindo, só ficou mais segura.

**Não trato isso como defeito**, e sim como escopo: o ADR 0055 nunca prometeu
promover verbo. Mas a lacuna entre o pedido e a entrega é real, e vira item de
triagem.

### Uma armadilha do próprio instrumento

A primeira tentativa de configurar a política não teve efeito nenhum, e a causa
merece registro porque é reincidente: o script rodava **pelo host**, então
`PROJECT_WORKSPACES_ROOT` caiu no default `/tmp/brabo-project-workspaces` e o
`permissions.json` nasceu num filesystem que o engine não enxerga.

É a mesma armadilha do repositório cobaia em `/tmp` que a
[validação da Fase 12](./validacao-fase-12.md) já documenta — reaparecendo por
outro caminho, no mesmo dia. O cabeçalho do script agora exige, com todas as
letras, execução de dentro do container.

## A quinta execução: a cadeia chega ao GitHub

Rodando **de dentro do container** (a condição que faltava) e com os verbos de
terminal liberados, a cadeia andou inteira:

| ação | política | desfecho |
|---|---|---|
| `terminal` ×2 | `auto_approve` | ✅ executed |
| `git_commit` | `auto_approve` | ✅ executed |
| `git_push` | `auto_approve` | ✅ executed |
| `pr_open` | `auto_approve` | ❌ **failed** |

**A branch do agente existe no GitHub**: `feature/task-d4b36a5b`, ao lado de
`dev`, `main` e `qa`. Código escrito por um modelo, commitado com a identidade
`dev-api[bot]` e empurrado para um repositório remoto de verdade.

O `pr_open` falhou com `Requires authentication`, e a causa é o **achado AA**:
a api resolve o token de git por `action.decidedBy`, que é NULL quando a
política auto-aprova. O push funcionou porque quem empurra é o engine, que
injeta a credencial do owner (RN-076).

## A sexta execução: a PR abriu no GitHub

Com a [RN-082](../business-rules.md#rn-082) no lugar, a cadeia fechou até a PR:

> **PR #1 — "Rota pública de saudação — Expor GET /saudacao"**,
> de `feature/task-636ef1aa`, aberta em `daneiel/test`.

Código escrito por um modelo, commitado como `dev-api[bot]`, empurrado e
publicado como pull request num repositório remoto de verdade. **O gate abriu**
(`pr.gate_changed`, `gateStatus: awaiting_qa`) e a área de QA rodou.

O `qa-performance-seguranca` foi **dispensado corretamente**
(`delegation.dispensed`, justificativa *"story sem RNF"*) — dispensa com
justificativa, nunca silêncio, como o ADR 0038 desenhou.

O `qa-automacao` falhou, e virou o **achado AB**: ele chamou um comando
composto cujo último segmento (`head`) não estava no `allow`, o ToolLoop
suspendeu em `awaiting_approval`, e o QA Lead classificou a suspensão como
*"desfecho inesperado"* com origem `infra`. É o defeito que o ADR 0052 corrigiu
para o dev agent e que não alcançou os agentes de gate.

## A sétima execução: ampliar o allowlist não bastou, e isso era previsível

Com 25 verbos liberados — critério explícito: o que LÊ ou CONSTRÓI, nunca o que
busca na rede ou destrói — o gate travou de novo. E não por falta de verbo:

```
ls -la && echo "---" && cat package.json 2>/dev/null; …
```

`ls`, `echo` e `cat` estavam todos em `allow`. O que barra é `2>/dev/null`, e
vira o **achado AC**: o parser trata `>` como separador, o redirecionamento
vira um segmento cujo verbo é `/dev/null`, e o mesmo token ainda é um caminho
absoluto fora do projeto.

**A previsão registrada antes da execução se confirmou.** O allowlist é lista
fechada e o modelo inventa comandos; ampliar a lista é remendo. A 7ª execução
prova isso de forma difícil de contestar: 25 verbos, e travou pela FORMA do
comando, não pelo verbo.

## A oitava execução, e o argumento que ela fecha

Com Y, AA, AB e AC corrigidos, o dev agent fez uma única chamada:
`bash -lc npm test --silent`. Verbo `bash`, fora da lista, `require_approval`.

**A recusa está certa** — liberar `bash` anularia o allowlist inteiro, inclusive
os `deny` embutidos. Mas as três últimas execuções, juntas, dizem uma coisa que
nenhuma delas dizia sozinha:

| execução | travou por | categoria |
|---|---|---|
| 6ª | `head` | **verbo** |
| 7ª | `2>/dev/null` | **forma** |
| 8ª | `bash -lc` | **invocação** |

Três categorias distintas em três rodadas. Ampliar a lista resolve a primeira e
não toca nas outras duas. **O allowlist de verbos não converge** contra um
agente que escolhe livremente como invocar o que quer rodar.

Isso não é defeito do allowlist: ele cumpre o que promete, e a recusa do `bash`
é a prova de que a fronteira segura. É um limite de ESCOPO — ele não foi
desenhado para viabilizar autonomia, e não viabiliza.

A conclusão prática da 13b é essa, e vale mais que a PR: **o caminho para o
gate por LLM não passa por afrouxar política.** Passa por fazer o agente
esperar a decisão em vez de morrer (achado AB), que é o que o ADR 0052 já fez
para o dev agent.

## A nona execução: a correção barata que teria destruído a garantia

A nona travou no mesmo `bash` da oitava, e o conserto óbvio estava a uma linha
de distância: pôr `bash` no `allow` e ver a esteira ficar verde.

**Não foi feito, e essa é a entrega da execução.** Liberar `bash` não amplia o
allowlist — ele o *anula*, porque todo comando barrado passa a ter uma forma
permitida de ser invocado, inclusive os `deny` embutidos. A rodada teria passado
e a garantia teria acabado, sem que nada no resultado indicasse a troca.

O que a nona fixou, então, foi o diagnóstico: o problema nunca foi *qual* verbo
está na lista, e sim que **o agente de gate morria** quando a política mandava
perguntar. Daí saiu o [ADR 0057](../adr/0057-o-gate-espera-a-aprovacao.md), estendendo
ao gate o que o [ADR 0052](../adr/0052-dev-agent-espera-aprovacao-no-meio-do-laco.md) já fizera para o dev
agent: diante de uma ação que exige decisão, **suspender e esperar** em vez de
classificar a própria suspensão como falha de infra (o achado AB).

## A décima execução: a cadeia inteira, ponta a ponta

Com o ADR 0057 no lugar, a décima fechou tudo o que as nove anteriores tinham
deixado em aberto, **sem um único restart do engine**:

| etapa | desfecho |
|---|---|
| adoção remota | `origin: adopted` contra `daneiel/test` |
| plano de repositório | executado só depois da **sua** decisão |
| promoção da story | manual, com o usuário como ator |
| dev agent real | escreveu código, commitou como `<agente>[bot]` |
| push e **PR remota** | publicada no GitHub |
| gate | abriu (`pr.gate_changed`) |
| área de QA | delegou e **dispensou com justificativa** |
| subagente | **suspendeu** em aprovação, e não morreu |
| sua recusa | **retomou** o laço em vez de encerrá-lo |
| veredito | `changes_requested`, julgado por LLM |

As duas linhas que importam são as duas últimas. O subagente parar e continuar
vivo é o ADR 0057 funcionando; a **recusa do usuário retomar o laço** é o ponto
que nenhuma execução anterior tinha alcançado — a decisão humana entra no meio
do trabalho do agente e ele segue dali, em vez de recomeçar ou desistir.

E o veredito não foi escrito pelo script: saiu do julgamento do modelo sobre uma
PR real. É a diferença exata que esta validação existe para cobrir em relação à
[irmã determinística](./validacao-fase-12.md).

> **TODO(humano):** o custo em dólares e a contagem de chamadas destas duas
> execuções não foram extraídos com `medir:execucao` na época. Se ainda houver
> `token_usage` das sessões, vale preencher — as demais medições deste documento
> vêm todas de script, e estas duas são a exceção.

## As execuções com dois módulos: o paralelismo posto à prova

As dez primeiras rodaram com **um módulo**. Isso basta para provar a cadeia, e
não basta para provar o paralelismo: com uma história só, o Dev Lead **recusa**
paralelizar — "esbarrariam nos mesmos arquivos" — e está certo. O teto da
[RN-083](../business-rules.md#rn-083) nunca chegava a ser consultado por
trabalho real.

Vieram então três rodadas com `--modulos 2` (uma história em `api`, uma em
`web`). As duas primeiras estão contadas no
[achado AF](./achados-execucao-real.md) — a que quebrou e a que provou a
correção. O que segue é a **terceira**, que existe para medir.

O Dev Lead planejou sozinho:

> **2 agentes em 2 módulos** — *"cada módulo tem exatamente uma história, então
> um agente por módulo é o mínimo justificável sem desperdício."*

E a rodada fechou, medida por `medir:execucao` e não à mão:

| | |
|---|---|
| duração | **3m56s**, 182 eventos em 3 sessões |
| chamadas | **33** (dev-api 10, dev-web 9, arquiteto 7, qa-automacao 6, dev-lead 1) |
| custo | **< US$ 0,01** |
| restart do engine | **não** |
| turnos mudos | **nenhum** |
| gates | `qa` **approved**, `secops` **approved** |

**O teto cobrou a decisão.** Com os dois agentes de pé, o pedido seguinte parou
em `aguardando_autorizacao` com a ação `parallelize` **pendente no banco** — 2
ativos, teto 2. Nada subiu: se tivesse subido, a autorização seria teatro.

### O que os dois módulos quebraram, antes desta rodada

Esta rodada saiu limpa, mas ela é a **terceira** com dois módulos, e as duas
primeiras é que pagaram o preço. Na primeira, o `dev-web` pegou a task e morreu
em `fatal: not a git repository` **antes do primeiro turno** — zero token gasto,
task bloqueada. É o [achado AF](./achados-execucao-real.md): a guarda do caminho
rápido de `Workspace.ensure!/4` perguntava se `.git` existia, e `git init` cria
o `.git` antes do `fetch`; o segundo agente lia "pronto" e pulava o lock.

O lock existia desde a Fase 4 e estava correto. O que estava errado era o
critério que decidia se valia a pena pegá-lo — e **nenhuma das dez execuções
anteriores podia tê-lo mostrado**, porque nenhuma teve um segundo agente.
Corrigido, o `dev-web` passou de 0 para 16 chamadas na rodada seguinte, e é daí
que esta terceira herda o direito de ser só uma medição.

O instrumento também aprendeu: a asserção do teto afirmava o **número** (o 3º
pedido pede autorização), o que valia para um módulo e reprovou uma execução em
que o produto agiu certo — com dois módulos a ativação já enche o teto. Agora
ela afirma a **regra**: enquanto couber, sobe sem perguntar; quando não couber,
para.

## O que esta validação ainda NÃO prova

Honestidade sobre o alcance, como na irmã dela:

- **Merge.** Continua fora por desenho
  ([RN-014](../business-rules.md#rn-014)), e continuará: quem aperta o botão
  numa branch protegida é você.
- **Os outros cinco providers.** Só o OpenRouter rodou com credencial real; os
  demais seguem sem smoke por falta de chave, e o que vale para um provider não
  se transfere para os outros por argumento.
- **Isolamento.** O agente executa no mesmo container que este monorepo. O
  [ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md) diz de si que é *política*, não
  isolamento — `..` reprova, mas symlink de dentro para fora não é detectado.
- **Autonomia sem política no caminho.** O allowlist de verbos **não converge**
  (achados Z e AD), e isso é limite de escopo, não bug a corrigir.
- **O teto de paralelismo pedido pelo PRÓPRIO Dev Lead.** Com dois módulos ele
  planejou 2 agentes e o teto é 2 — coube. Quem estourou o teto foi o roteiro,
  chamando o caso de uso direto. Para ver o *lead* pedir mais do que pode seriam
  precisos 3+ módulos, e isso ainda não rodou.

A cadeia em si — da adoção ao veredito de gate por LLM — **está provada contra
rede real**. O que continua em aberto acima não é a cadeia: é o ambiente em que
ela roda e a superfície que ela cobre.

## Referências

- [validacao-fase-12.md](./validacao-fase-12.md) — a irmã determinística
- [achados-execucao-real.md](./achados-execucao-real.md) — a colheita
- [backlog.md](./backlog.md) — para onde X e Y vão
