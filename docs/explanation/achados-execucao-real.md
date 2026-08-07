# Achados da execução real da esteira

> Levantado numa sessão de execução conduzida pelo navegador em **2026-08-05**,
> com modelo de API (não local) e provider de git de verdade. É o insumo da
> triagem da FASE 13c: cada item tem arquivo:linha ou evento que o comprova, e
> nenhum foi corrigido "de passagem" — os que foram fechados têm PR nomeada.


Projeto CRIADO (não adotado) no GitHub via wizard. Repo real: `daneiel/hello-api`,
privado. Sessão do wizard: `f15b0cc9`. Sessão saudável: `36abf7e7`.

## Corrigidos durante a execução (bloqueavam)

1. **Medidor não media** (PR #136, mergeada) — `db.execute` destruturado como
   array + agente lido do ator do evento em vez do payload.
2. **`llm_turn_stream` sem `receive_timeout`** (PR #137, mergeada) — caía nos
   15s default do Req; os 4 agentes conversacionais só passam por ali.
3. **`ApprovalCard` derrubava a tela da sessão** (a commitar) — `ActionType` do
   web era subconjunto do backend; `ACTION_ICON[actionType]` → `undefined` para
   `git_repo_create`/`git_branch_create`/`git_branch_protect`, que é o que TODO
   projeto criado num provider gera. O "fallback genérico" existia só no
   comentário. Só não aparecia em projeto ADOTADO (sem bootstrap).

## Abertos — para a triagem da 13c

### A. Sessão do provisionamento nasce sem processo no engine (GRAVE)

> **FECHADO** — virou [RN-067](../business-rules.md#rn-067). Os quatro call
> sites citados abaixo passaram a criar sessão pelo `CreateSessionUseCase`
> (`provision-repository:119` e `:125`, `adopt-repository`, `activate-execution`),
> e a regra declara que ele é o **único** lugar que cria sessão. Fica registrado
> porque a prova por contraste abaixo é o que tornou o defeito visível.

`CreateSessionUseCase` é o único lugar que emite `session.created` no outbox.
Criam sessão direto no repositório, pulando isso:
- `apps/api/src/application/use-cases/git/provision-repository.use-case.ts:112` e `:121`
- `apps/api/src/application/use-cases/git/adopt-repository.use-case.ts:176`
- `apps/api/src/application/use-cases/execution/activate-execution.use-case.ts:156`
  ← esta é a sessão em que os DEV AGENTS rodam

Efeito: engine nunca sabe que a sessão existe → `REFUSED JOIN` eterno, sem
canal, sem atualização ao vivo, sem heartbeat, e a sessão **nunca fecha**
(fica `active` para sempre). A UI só reclama no console.

Prova por contraste:
| sessão | `session.created` | `engine.session_states` | canal |
|---|---|---|---|
| wizard `f15b0cc9` | não | vazio | `REFUSED JOIN` |
| rota normal `36abf7e7` | sim | `active` | `JOINED` |

### B. Modelo de start (DECISÃO DO USUÁRIO)
Sessão sempre nasce no default do workspace (`llama3.2:1b`, local) — o ADR 0020
proíbe 7B/1B local no passo semântico, e foi preciso trocar à mão nas duas
sessões. Pedido: modelo de start configurável, herdando o do **Criativo** neste
cenário, porque ele é sempre a porta de entrada do projeto.

### C. Quem fala é o modelo, não o agente (DEFEITO, apontado pelo usuário)
A bolha transmitida ao vivo vem rotulada com o nome do MODELO
("DeepSeek V4 Flash Latest"); só quando o evento persistido chega é que aparece
o agente (`po`). Efeitos: o nome errado aparece primeiro, e a mensagem fica
DUPLICADA na tela (bolha do stream + bolha do evento). O stream não é
reconciliado com o evento persistido.

### D. Passo impossível trava o wizard sem saída
`Proteger branches` falha em repo privado no plano gratuito — o próprio wizard
AVISA isso antes. Mas a única ação oferecida depois é "Tentar novamente", que
vai falhar sempre. Falta reconhecer e seguir.

### E. Preview do repositório mente
`apps/web/src/routes/NewProjectWizard.tsx:331` tem `repo: brabo/{slug}`
hardcoded. O owner real vem do PAT (`createForAuthenticatedUser`), ou seja
`daneiel/hello-api`. O erro chega até a tela de CONFIRMAÇÃO.

### F. Wizard anuncia `rc`
Passo "Política de branches" lista `rc` nas permanentes e `rc ← qa` na cascata.
A política vigente tem só `dev`/`qa`/`main`; a volta da `rc` está no backlog do
ADR 0030.

### G. Convite do Criativo não aparece em projeto criado
O empty-state "A vez é sua" só renderiza com fio vazio. Em projeto criado o fio
já tem os cards do bootstrap, então o usuário não recebe convite nenhum.

### H. Feed de atividade genérico
Os 10 eventos do bootstrap aparecem todos como "atividade em system", sem dizer
o que aconteceu.

### I. Card de ação mostra o modelo ATUAL da sessão
Trocar o modelo da sessão reescreve retroativamente o rótulo dos cards de ações
antigas. O `token_usage` congela o preço certo; é só a tela.

### J. Psicólogo roda em sessão vazia

> **FECHADO** — virou [RN-079](../business-rules.md#rn-079). A análise só roda
> havendo evento ANALISÁVEL, e "analisável" desconta os passos de máquina do
> bootstrap e o rastro dos próprios analistas — sem esse segundo desconto, a
> primeira análise tornaria a sessão povoada para sempre. Sem material, sai
> `psychologist.analysis_skipped` e nada é gasto. A sessão do achado está
> reproduzida como teste (14 eventos, nenhum analisável).
Na sessão `b2fceb9e`, recém-aberta: recebeu as hipóteses da sessão anterior com
o log da nova (vazio), tentou citar `seq 60-78` inexistentes, teve a evidência
rejeitada 2x e desistiu (`psychologist.analysis_failed`). A validação segurou a
invenção — mas rodar análise em sessão sem evento é gasto à toa.

### K. Regra de negócio duplicada não é deduplicada

> **FECHADO PARCIALMENTE** — virou [RN-080](../business-rules.md#rn-080).
> Duplicata EXATA (mesmo título, ignorando caixa, acento e espaço) é recusada na
> emissão, com escopo de projeto — é entre sessões que ela nasce. Duplicata
> **semântica** segue aberta e assim declarada: separar "Saudação com nome" de
> "Quem chama pode se identificar" é julgamento, não `if`.
Rodar o Criativo duas vezes no mesmo projeto deixou 10 regras, 5 órfãs
("descoberta — sem história"). Efeito do meu roteiro, não do produto, mas
mostra que não há dedupe nem aviso.

### L. Botão do rodapé fica obsoleto
Continua "Estou pronto para produzir" depois que o fio já passou ao PO.

## Funcionou como projetado (registrar também)
- RN-059: `agent.error` durável, com `origem: infra`, agente falando no fio e
  voltando a `idle` (visto 2x nos timeouts de 15s).
- Validação de evidência do Psicólogo rejeitando event ids inventados.
- Bootstrap de Gitflow no GitHub: 4/5 passos, repo real com `main`/`dev`/`qa`.
- Pipeline de proposed_action: 6 ações do bootstrap, auto-aprovadas pela política.
- 12c: promoção manual como default, `story_promotion_proposed` como proposta.
- Rastreabilidade regra ↔ história, separando coberta de descoberta.
- Progresso ao vivo do bootstrap, com a falha mostrando a mensagem do GitHub.

### M. O ARQUITETO É CEGO AO PRÓPRIO module_map (P1 — a falha da rodada)

> **FECHADO** — virou [RN-066](../business-rules.md#rn-066) e está confirmado em
> produção na seção final desta página: 4 chamadas de `assign_story_modules` em
> vez de 18, zero nome inventado, 1 module_map em vez de 4.

Sessão `36abf7e7`, seq 80-131. O Arquiteto emitiu o mapa (módulos `saudacao` e
`api_http`) e em seguida **não conseguiu relê-lo**. Não há ferramenta para ler o
module_map vigente, e a recusa do `assign_story_modules` não devolve os nomes
válidos. Resultado: força bruta.

18+ chutes: `api`, `core`, `http`, `greeting`, `domain`, `web`, `hello-api`,
`hello`, `greeting-api`, `saudacao` (acertou por sorte), `app`, `server`,
`publico`, `public-api`, `api-publica`, …

Nas próprias palavras dele (seq 94, 99, 124):
> "os nomes que tentei (`api`, `core`) não batem. Vou **descobrir os nomes
> válidos testando candidatos plausíveis**"
> "Preciso **descobrir os nomes reais** dos 2 módulos. Vou **testar candidatos
> adicionais**."

Três consequências, em ordem de gravidade:

1. **Dado errado, declarado certo.** As 4 histórias ficaram em `["saudacao"]`,
   inclusive a do ENDPOINT. `api_http` ficou sem história nenhuma. E o desfecho
   (seq 130) afirma: "Todas as 4 histórias foram vinculadas com sucesso aos
   módulos." O log termina com uma mentira confiante.
2. **Quebra a execução a jusante.** `activate-execution` sobe um dev agent por
   MÓDULO. Com tudo em `saudacao`, o módulo `api_http` não recebe agente e a
   arquitetura desenhada não é a que será construída.
3. **Nenhum `tool.result` é gravado** para `assign_story_modules`. O laço inteiro
   é invisível no event log — só dá para inferir pelos `tool.call` repetidos.

Custo do laço: 9 chamadas de LLM do arquiteto, 27.804 in / 8.012 out.
Total da sessão: 7.271 micros (US$ 0,007) — barato só porque é modelo flash.

O laço do module_map (PR #135) era SINTOMA disto: o Arquiteto reemitia o mapa
justamente para tentar fixar nomes que ele não conseguia ler. O #135 fechou a
corrupção de dado; a cegueira continua.

## Execução (projeto 17229425, sessão de execução dbb84ce8) — 2026-08-05

### N. A METADE DE EXECUÇÃO SÓ FUNCIONA COM PROVIDER `local` (P1, bloqueia a 13b)
`Engine.Projects.ProjectRepository.get_local_repo_path/1` devolve
`{:error, {:unsupported_provider, "github"}}` para qualquer provider que não
seja `local`. Está documentado como corte de escopo no próprio moduledoc:

> "Só suporta o provider 'local' (github/gitlab remotos ficam fora de escopo do
> executor de terminal por ora)"
> — `apps/engine/lib/engine/projects/project_repository.ex:25-27`

Cinco call sites dependem dele:
- `lib/engine/dev/worktree_manager.ex:20` — worktree do dev agent
- `lib/engine/actions/terminal_executor.ex:39` — execução de comando
- `lib/engine/gates/diff.ex:17` — o diff que QA e SecOps leem
- `lib/engine/harness/project_context.ex:30` — contexto de projeto

Efeito observado: ativei a execução no projeto GitHub, os 3 dev agents subiram,
pegaram uma task cada e os 3 foram bloqueados no mesmo segundo com
`falha ao preparar o worktree`.

A assimetria é a chave: a **api** fala GitHub por HTTP (foi ela que criou o
repo, commitou o template e criou dev/qa). O **engine** trabalha no sistema de
arquivos e só conhece bare repo local. Então projeto no GitHub faz a metade
CONVERSACIONAL (Criativo, PO, Arquiteto) e o bootstrap, mas não a metade de
CONSTRUÇÃO.

Consequência para a FASE 13b: o roteiro do CLAUDE.md ("projeto ADOTADO do fork
via GithubProvider remoto, DevAgent real, dev implementa → PR remota → gates")
**não é executável hoje**. Não é bug de passagem: suportar remoto exige clone,
credencial dentro do engine e push — feature com ADR.

### O. Dev agent nasce no modelo local (mesma raiz do achado B)
Os três dev agents subiram com `Llama 3.2 1B (local)`, herdado do default do
workspace. O ADR 0020 proíbe modelo local pequeno no passo semântico, e dev
agent escrevendo código é o passo semântico mais caro que existe.

### P. Evento de bloqueio sem origem
`{"origin": null, "reason": "falha ao preparar o worktree", "diagnosis":
"{:unsupported_provider, \"github\"}"}`. O CLAUDE.md exige que todo desfecho de
falha registre a ORIGEM (infra | modelo | código | política). Aqui é `código`
(limite conhecido do produto) e veio `null`. O diagnóstico salvou o dia, mas a
regra não foi cumprida.

### Q. `agent.error` com "origem indeterminada"
No Criativo, turno abortado: o fio mostrou `falha · origem indeterminada`.
RN-059 funcionou (erro durável, agente falou, retomada limpa), mas
"indeterminada" não é uma das quatro origens — é diagnóstico por eliminação,
que o ADR 0020 proíbe.

### R. PO gerou histórias sobrepostas

> **FECHADO PARCIALMENTE** — virou [RN-081](../business-rules.md#rn-081). Título
> idêntico recusa; história que não acrescenta cobertura sobre as regras que cita
> vira `backlog.story_overlap_warned`, aviso e não bloqueio. **O par exato deste
> achado continua passando** — títulos e justificativas diferentes para o mesmo
> endpoint não têm nada mecânico que os ligue. Há teste afirmando esse limite,
> para ele ficar visível em vez de implícito.
"Endpoint público de saudação determinística" e "Endpoint público GET /hello que
responde saudação imediata" cobrem o mesmo endpoint. Sem dedupe nem aviso.

## Execução do hello-limpo (projeto `9c7c84f0`, sessão `1f94de49`) — 2026-08-06

Dev agent real, DeepSeek V4 Flash via OpenRouter, com o pipeline de aprovação
ligado e cada ação decidida à mão. A task era "Expor rota GET pública
/api/saudacao". Ela nunca começou: **18 turnos, 292.211 tokens de entrada,
US$ 0,0275 e zero linha escrita**, e a rodada terminou em erro do provider.

### S. O contexto acumulado estoura o limite do provider e MATA a execução (P1)

No turno 18 a chamada ao modelo voltou
`{413, %{"message" => "request entity too large", "statusCode" => 413}}`, o
`ToolLoop` não teve como seguir e a task foi bloqueada (`dev.blocked`,
`artifact.task_blocked`, seq 151–152).

A causa é mecânica e cumulativa: cada comando de terminal despeja a saída
inteira no histórico do laço, e o histórico vai junto em **todo** turno
seguinte. A maior requisição BEM-SUCEDIDA registrada em `token_usage` foi de
28.993 tokens de entrada; a que falhou não chegou a registrar uso. O estouro é
de **tamanho da requisição em bytes**, não de janela de contexto — um `find` ou
um `git ls-files` com saída longa pesa muito mais em bytes do que em tokens
úteis.

Isto liga diretamente ao [ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md),
por um ângulo que o ADR não previu: a escada de aprovação não só encarece a
execução, ela a **mata**. Cada pergunta ao usuário empurra o agente a mais um
comando exploratório, cuja saída entra no histórico para sempre. A corrida
termina em 413 antes de a primeira linha de código ser escrita.

O que a triagem precisa decidir é de quem é o conserto — do `ContextManager`
(compactar ou truncar saída de ferramenta por tamanho, não só por idade), do
executor de terminal (teto de bytes por saída, com marca de truncagem) ou dos
dois. Hoje não há teto em lugar nenhum do caminho.

- **Evidência:** `session_events` seq 150–152 da sessão `1f94de49`;
  `token_usage` do ator `dev-http-api`.

### T. A origem da falha continua fora das quatro (recorrência de P e Q)

O `dev.blocked` do achado S gravou:

```json
{
  "origem": "indeterminada",
  "reason": "parou sem concluir nem reportar bloqueio",
  "diagnosis": "falha na chamada ao modelo: {413, %{\"message\" => \"request entity too large\", \"statusCode\" => 413}}"
}
```

Não é achado novo: é a **terceira** ocorrência da mesma regra violada, e por
isso fica registrada como recorrência em vez de item separado. O [P](#p-evento-de-bloqueio-sem-origem)
pegou `origin: null` num `dev.blocked`; o [Q](#q-agenterror-com-origem-indeterminada)
pegou `"indeterminada"` num `agent.error`. Aqui os dois se encontram: evento de
bloqueio, valor `"indeterminada"`.

O que esta ocorrência acrescenta, e que torna o caso mais forte que os
anteriores: **a origem era trivialmente derivável**. Um status HTTP conhecido
do provider é `modelo`, sem qualquer ambiguidade — o próprio campo `diagnosis`
o nomeia na mesma linha em que `origem` desiste. Não é um caso de fronteira,
é o caminho de erro não olhando para o que ele mesmo acabou de escrever.

O `reason` também mente: "parou sem concluir nem reportar bloqueio" descreve
silêncio, e o que houve foi uma falha com causa identificada. Quem ler só o
`reason` no painel conclui que o modelo se perdeu.

- **Evidência:** `session_events` seq 151 da sessão `1f94de49`.
- **Regra violada:** CLAUDE.md ("todo desfecho de falha registra a ORIGEM —
  infra | modelo | código | política — nunca diagnóstico por eliminação"),
  origem no [ADR 0020](../adr/0020-destravar-gates-qa-secops.md).

### U. O executor de terminal não tem fronteira de projeto (P1)

Dentro do container que executa as ações, `/workspace` é o **monorepo do próprio
Brabo** — não o worktree do projeto, que fica em
`/data/project-workspaces/<projectId>/.worktrees/<agentId>`.

O dev agent do `hello-limpo` gastou turnos ali achando que era o projeto dele:
leu `apps/engine/mix.exs`, e chegou a propor `cat lib/engine/actions/git_executor.ex`
e `sed -n '1,120p' lib/engine/dev/context_builder.ex` — o executor de git e o
construtor de contexto da plataforma que o executava.

E o alcance não para no Brabo. Um `for` sobre `/data/project-workspaces/*/`
listou o worktree de **outro projeto** (`dbd3e508-e0c7-4e29-b134-5d393f518269`)
com seus commits e arquivos; o passo seguinte que o agente propôs era entrar
nele para ler `git remote -v` e o `git log`. Foi recusado à mão.

Nada disso é malícia do modelo: ele está procurando o próprio projeto e o
sistema de arquivos não diz onde ele acaba. Num deploy multi-inquilino, o mesmo
comando leria o repositório de outro cliente.

O [ADR 0055](../adr/0055-escopo-de-caminho-na-politica-de-terminal.md) desenha a
metade de POLÍTICA disso e diz explicitamente que não resolve a outra: escopo de
caminho depende de a regra acertar, e o que falta é **isolamento** — montagem
por projeto, ou container por projeto. Este achado é a metade que o ADR deixou
declarada em aberto.

- **Evidência:** `proposed_actions` `d1bfeda3` (recusada) e `56374def`
  (aprovada, listou o outro projeto) da sessão `1f94de49`.

### V. Sessão consta `closed` enquanto a execução continua (P2)

`sessions.status` da `1f94de49` é `closed` desde **23:34:42**, trinta segundos
depois de nascer. A execução seguiu até **00:56** — mais de uma hora de agente
trabalhando, propondo ações e gastando token numa sessão que o banco dá por
encerrada.

Os dois lados ficam incoerentes ao mesmo tempo: a UI mostra "Sessão closed — não
é possível enviar mensagens" **e** renderiza os cards de aprovação, que
funcionam normalmente. Aprovar numa sessão fechada executa comando de verdade.

Contraria a máquina de estados que o CLAUDE.md declara
(`created → active → closing → closed | closed_abnormally`): `closed` deveria
ser terminal. Também envenena qualquer medição por sessão — duração, custo e
"quantas sessões terminaram bem" leem um estado que não descreve o que houve.

Não investiguei quem escreveu o `closed` nem por quê; isso é trabalho da fase
que endereçar, não da triagem.

- **Evidência:** `sessions.updated_at` = 23:34:42 com `status = closed`;
  `session_events` da mesma sessão até seq 152, às 00:56:46.

## Confirmado em produção nesta rodada
- **RN-066** (cegueira do Arquiteto): 4 chamadas de `assign_story_modules` em vez
  de 18, zero nome inventado, 1 module_map em vez de 4, cada história no módulo
  semanticamente certo. Custo da sessão caiu de 7.271 para 3.259 micros.
- **RN-067** (sessão sem processo): a sessão de execução `dbb84ce8` aparece em
  `sessions` E em `engine.session_states` — antes a de `activate-execution`
  nascia órfã.

## Execução da validação da Fase 12 — 2026-08-07

Primeira corrida real de `pnpm --filter api validacao:fase-12`, a pendência
13a.1. O critério fechou (saída `0`), mas só depois de quatro correções — três
no INSTRUMENTO e uma no PRODUTO. As do instrumento estão contadas em
[validacao-fase-12.md](validacao-fase-12.md); esta é a do produto.

### W. Dev agent MORRE quando a fila do módulo esvazia (P1) — FECHADO

Com a fila vazia, `POST /internal/sessions/:id/tasks/claim` responde `201` com
`content-length: 0`. O caso de uso devolve `null`, mas o NestJS serializa isso
como corpo VAZIO — o `Req` entrega `""`, que não é `nil`.

`AgentIo.try_claim/2` casava com a cláusula de task encontrada e chamava
`run_task("")`, estourando `BadMapError` em `Map.get("", "id", nil)`. Como o
server é `restart: :temporary`, o agente morria de vez, com o `Monitor`
apagando a linha de estado logo atrás.

**Vale para o dev agent REAL**, não só para o Noop: `try_claim/2` mora no
`AgentIo` compartilhado. E dispara no desfecho mais comum que existe — a fila
acabando. O efeito é o oposto exato do que a Fase 12b entregou: em vez de
`dev.idle` supervisionado e acordável por evento, processo morto.

A suite nunca pegou porque o fake devolve `nil` corretamente. **Só execução
real expõe** — que é, literalmente, a tese desta fase.

> **FECHADO** — corrigido na fronteira (`EngineApiClient.claim_task/4`
> normaliza corpo vazio) e guardado no contrato (`AgentIo.try_claim/2` aceita
> `""` junto com `nil`), sem mexer no status HTTP da rota. Exceção ao
> congelamento da FASE 13 autorizada pelo usuário, pelo mesmo motivo da Fase F:
> a medição não era alcançável sem isto. Verificado por mutação.

## Execução real com GitHub remoto (FASE 13b) — 2026-08-07

Primeira execução contra repositório remoto de verdade (`daneiel/test`), com
dev agent real e `openai/gpt-5-mini`. A cadeia até a promoção passou inteira; o
dev agent não. Detalhe e medição em [validacao-real.md](validacao-real.md).

### X. O dev agent queima o teto de iterações em repositório vazio (P1)

Task *"Expor GET /saudacao"* num repositório recém-provisionado — só o template
do Gitflow, sem código. O agente gastou as oito iterações em
`search_workspace`/`read_file` procurando "onde está o projeto", **nunca rodou
um comando e nunca escreveu um arquivo**. Bloqueio: `limite de iterações
atingido`, origem `modelo`, diagnóstico `(nenhum terminal rodado)`.

A origem `modelo` é tecnicamente verdadeira e praticamente inútil: o modelo não
errou um julgamento, ele nunca chegou a julgar. Custo: 8 chamadas, 205 tokens
de saída.

É o **primeiro** cenário em que o dev agent começa do zero absoluto — todo teste
e toda demo partiram de workspace com código.

### Y. `search_workspace` não distingue "vazio" de "não encontrei"

As cinco primeiras chamadas devolveram `nenhum resultado`, e o agente leu isso
como "procure melhor" em vez de "não há nada aqui". Provável peça acionável
do achado X.

### Funcionou como projetado (registrar também)

O **Psicólogo diagnosticou sozinho**, em tier pesado, lendo o event log da
execução fracassada — e nomeou as duas causas com precisão maior que a de
qualquer asserção do script: a ausência de `tool.call` de terminal, e o
`search_workspace` enganando o agente. A introspecção do produto funciona.
