# ADR 0090 — QA-estratégia e AppSec como segundo MOMENTO, não agente novo

- **Status:** Aceito
- **Data:** 2026-08-17
- **Contexto:** decisão consciente do dono do produto de antecipar o
  gatilho — não "o gatilho natural" que `docs/fluxo.yml` previa
  (`hoje_absorvido_por` + `criterio_de_separacao`), mas o próprio trabalho
  de construir a coisa que liga o gate
- **Ativa:** o gate `implementavel` (`docs/gates.yml`, `status: planned`
  desde a FASE 14d)
- **Revisa parte de:** [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md)
  (que declarou o gate `implementavel` como `planned`)
- **Precedente direto:** [ADR 0038](0038-hierarquia-de-agentes.md) (área de
  QA — Lead + subespecialidades), [ADR 0085](0085-fluxo-como-registro-declarativo.md)
  (`docs/fluxo.yml`, que já previa os dois papéis como `proposto`)

## Contexto

`docs/fluxo.yml` (ADR 0085) registra dois papéis do modelo-alvo como
`proposto`, cada um com o critério de separação escrito no próprio arquivo:

> **qa-estrategia** — hoje_absorvido_por: area-qa (que só atua DEPOIS, na
> PR). criterio_de_separacao: Quando o gate implementavel ativar — o
> plano-de-teste é entrada dele. Pode ser o próprio qa-lead em segundo
> MOMENTO, não necessariamente agente novo: a separação é de entregável.
>
> **appsec** — hoje_absorvido_por: secops (que só atua na PR).
> criterio_de_separacao: Mesmo padrão do QA: dois MOMENTOS, não dois
> agentes por ora. Threat model no design ativa quando o gate implementavel
> existir. Agente separado só com produção real.

O gatilho declarado ("quando o gate `implementavel` ativar") nunca disparou
organicamente — nada no produto precisava dele ainda. O dono do produto
decidiu antecipar: o gatilho **é** o próprio trabalho de construir o
mecanismo que liga o gate, não um sintoma de uso esperando para acontecer.

Esta entrega cobre **qa-estrategia** por completo. **appsec** segue
`proposto`, na MESMA doutrina (dois momentos, não dois agentes), com a
implementação em frente separada — o padrão e a decisão são um só, descrito
aqui; o código de `appsec`/`threat-model` fica para quando essa frente
rodar.

## Decisão

**QA-estratégia é o `qa-lead` num segundo MOMENTO — mesmo processo,
entregável separado.** Nenhum agente novo, nenhum GenServer novo com nome
próprio no roster. `Engine.Gates.QaLeadServer` ganha um ponto de entrada
ADITIVO, `run_design/3`, ao lado do `run/2` de sempre (revisão de PR):

### As peças

1. **`Engine.Gates.QaEstrategiaContext.fetch/3`** — contexto LEVE: só story
   (de `EngineApiClient.list_backlog/1`, a árvore que o PO já lê desde a
   [RN-164](../business-rules/autenticacao.md#rn-164)) e `module_map` vigente (de
   `EngineApiClient.get_infra_context/2`, o MESMO `GetInfraContextUseCase`
   que o Infra Lead consome, aqui só pelo campo `moduleMap`) — SEM
   `dev_state`, SEM `worktree_path`. Nenhuma rota nova na api: as duas
   funções já existiam, e o gate `implementavel` roda PRE-DEV — não há dev
   agent, worktree nem `task_id` ainda.
2. **`Engine.Gates.QaEstrategiaAgent`** — módulo SEM ESTADO (não é
   `GenServer`), mesma FORMA de `Engine.Gates.QaPerformanceSegurancaAgent`:
   registro de ferramentas SEM `Terminal` (`ReadFile`, `SearchWorkspace`,
   `EmitPlanoDeTeste`), rodando o `ToolLoop` genérico do harness. Nenhuma
   das três ferramentas passa por `Engine.Harness.Hooks.ActionPipeline`
   (só `terminal`/`write_file` passam) — este agente NUNCA suspende, e
   `run_design/3` roda síncrono dentro do próprio `handle_cast`. Emite
   `artifact.plano_de_teste` (schema validado em
   `Engine.Harness.ArtifactSchemas`) no event log da sessão que o chamou.
3. **`Engine.Gates.QaLeadServer.run_design/3`** — `GenServer.cast`, mesmo
   estilo de `run/2`, SEM `DevAgentState.find_by_task_id`. Chamado através
   de `Engine.Gates.Dispatcher.run_qa_estrategia/3` (a MESMA indireção
   trocável em teste que `run_qa/2`/`run_secops/2` já usam — evita subir um
   GenServer real num teste leve).
4. **`Engine.Agents.DevLeadTools.assess_implementability`** — nova
   ferramenta do Dev Lead. Lê o `artifact.plano_de_teste` mais recente da
   story no histórico da PRÓPRIA sessão do Dev Lead:
   - **sem plano ainda** — dispara `Dispatcher.run_qa_estrategia/3` e
     devolve `{:error, texto}` pedindo para tentar de novo. Erro de
     ferramenta é ENTRADA do laço, não fim de linha
     ([RN-163](../business-rules/autenticacao.md#rn-163)) — o Dev Lead tem 14 iterações
     para tentar de novo depois que o plano existir;
   - **com plano** — monta o parecer (`implementavel`/`inviavel` +
     justificativa, com o plano de teste embutido no payload) e chama
     `EngineApiClient.propose_action/5` com `"assess_implementability"`,
     MESMO padrão de três desfechos de `propose_execution_plan`
     ([RN-284](../business-rules.md#rn-284), ADR 0086).
5. **`decide.ts`** ganha `assess_implementability`, papel mínimo
   `maintainer`, DELIBERADAMENTE fora do bloco de tetos absolutos — mesmo
   raciocínio de `propose_execution_plan`: é uma decisão inicial da sessão,
   não uma ultrapassagem de teto já autorizado.
6. **`docs/gates.yml`**, `implementavel`: `status: planned` → `active`, com
   `evidencia` apontando para o event log (`proposed_action.created`
   filtrado por `actionType: assess_implementability`). `severidade`
   continua `warn` — não foi tocada; o registro já dizia "nasce warn mesmo
   quando ativar".

### Por que o teto de iterações NÃO ganhou cláusula nova

`Engine.Harness.Iteracoes.tipo/1` classifica agente desconhecido como
`:conversacional` (teto 8). `"qa-estrategia"` cai nesse default, e é a
decisão CERTA — não uma lacuna. O critério da
[RN-085](../business-rules/custo.md#rn-085) não é "quem trabalha muito": é "o que
segura o gasto além do teto de iterações". Este agente roda SEM
`token_budget_micros` (não há task, PRE-DEV), a mesma situação de
`infra-workflows` — que também fica em 8 mesmo usando ferramenta, porque
subir o teto sem budget por baixo multiplicaria o pior caso sem nada para
conter.

## Consequências

**A favor**

- O comportamento passa a bater com o que `docs/fluxo.yml` já declarava —
  a mesma classe de correção do ADR 0086 (fechar divergência entre fluxo
  declarado e código), só que aqui o "código" nunca tinha existido.
- A separação de entregável se prova sem custo de infraestrutura nova:
  zero GenServer, zero rota HTTP nova, zero tabela.
- O gate `implementavel` ganha evidência mensurável no event log, mesmo
  espírito do ADR 0054 — a decisão registrada é o que torna a passagem do
  gate mensurável.

**Contra**

- **A janela de espera entre "disparei a avaliação" e "o plano existe" é
  assíncrona e sem callback.** O Dev Lead descobre que o plano ficou pronto
  só quando o MODELO decide chamar `assess_implementability` de novo — não
  há retomada automática (ao contrário da suspensão em aprovação do ADR
  0086, que É orientada a evento). Aceito porque `Engine.Gates.QaEstrategiaAgent`
  roda em processo separado (`qa-lead`) e o Dev Lead não pode bloquear um
  `run_turn/2` síncrono esperando um resultado de OUTRO processo sem
  acoplar os dois — e o teto de 14 iterações dá slack suficiente para o
  modelo tentar de novo dentro do MESMO turno.
- **`appsec` continua `proposto`.** Esta entrega não resolve o segundo
  papel que o mesmo trecho de `docs/fluxo.yml` declara — decisão
  consciente de escopo, registrada aqui para a frente seguinte reusar o
  MESMO padrão sem reabrir a decisão.

## Alternativas consideradas

**Agente `qa-estrategia` novo, GenServer próprio.** Recusada: o próprio
`docs/fluxo.yml` já argumentava contra — "não necessariamente agente novo:
a separação é de entregável". Um GenServer novo duplicaria a fiação de
`Wake`/`Registry` da área de QA sem ganho nenhum, já que este caminho nunca
suspende e não precisa da máquina de retomada que justifica um processo
próprio.

**`assess_implementability` bloqueia esperando o plano de teste (chamada
síncrona ponta a ponta).** Recusada — exigiria o Dev Lead chamar
`QaEstrategiaAgent.run/4` diretamente, no PRÓPRIO processo, e rodar o
`ToolLoop` da QA-estratégia DENTRO do turno do Dev Lead. Tecnicamente
possível (nenhum dos dois toolloops suspende), mas acopla os dois agentes
— um erro de leitura na QA-estratégia derrubaria o turno do Dev Lead
inteiro, e o teto de iterações de um passaria a comer o do outro. Manter
os processos separados, com o resultado passando pelo event log, é o MESMO
desenho que toda a comunicação api↔engine já usa.

**Reusar `Engine.Dev.ContextBuilder.fetch/3`** (o builder que
`QaPerformanceSegurancaAgent` já usa) **em vez de um builder novo.**
Recusada: aquele builder é por `task_id` — pressupõe dev agent, worktree e
código já commitado numa branch. Forçar um `task_id` fictício para uma
avaliação PRE-DEV inverteria a ordem que o gate existe para garantir
(avaliar ANTES de queimar token escrevendo código).

## Referências

- `docs/fluxo.yml` — papéis `qa-estrategia` (agora `active`) e `appsec`
  (segue `proposto`)
- `docs/gates.yml` — gate `implementavel` (agora `active`)
- [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md) — declarou o gate
  `implementavel` como `planned`
- [ADR 0038](0038-hierarquia-de-agentes.md) — a área de QA (Lead +
  subespecialidades), o precedente estrutural deste desenho
- [ADR 0086](0086-dev-lead-plano-suspende-para-aprovacao.md) — o padrão de
  `proposed_action` de três desfechos que `assess_implementability` repete
- `apps/engine/lib/engine/gates/qa_estrategia_agent.ex`,
  `qa_estrategia_context.ex`, `qa_lead_server.ex`, `dispatcher.ex`
- `apps/engine/lib/engine/agents/dev_lead_tools.ex`, `dev_lead_server.ex`
- `apps/api/src/domain/actions/decide.ts`
