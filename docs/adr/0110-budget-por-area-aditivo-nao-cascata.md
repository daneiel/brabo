# ADR 0110 — Orçamento por área é ADITIVO, ao lado de projeto/sessão — não uma cascata, e não uma tabela nova

- **Status:** Aceito
- **Data:** 2026-08-23
- **Contexto:** fecha o item "orçamento por área" do corte do ADR 0038, acompanhado desde a FASE 8 e mencionado por último nas Consequências do ADR 0053 ("`budget per area`... está um passo mais perto: a tabela que faltava agora existe")
- **Estende (sem editar):** [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md) (`agent_areas`/`max_parallel`), [ADR 0063](0063-duas-audiencias-para-o-mesmo-gasto.md) (orçamentos de projeto/sessão, `CheckBudgetGateUseCase`/`RecordLlmUsageUseCase`), [ADR 0064](0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md) (o mecanismo DIFERENTE com o qual este não deve ser confundido)

## Contexto {#context}

`agent_areas` (`dev`/`qa`/`infra`, por projeto) tem `max_parallel` desde a
FASE 14d — um teto que o lead pode gastar sem pedir, acima do qual o usuário
autoriza. O gasto de tokens, por sua vez, só tinha dois tetos: projeto e
sessão (tabela `budgets`, `CheckBudgetGateUseCase` bloqueando antes da
chamada, `RecordLlmUsageUseCase` incrementando depois dela). Nada limitava o
que uma única ÁREA podia queimar — uma área dev com cinco agentes em paralelo
e nenhum teto individual podia gastar tanto quanto o limite da sessão
permitisse, igual a uma com um agente só, sem como ver ou limitar a diferença
por área.

## Decisão {#decision}

### 1. Aditivo, não cascata — um mecanismo diferente do ADR 0064 {#1-additive-not-cascade-a-different-mechanism-from-adr-0064}

Esta é a constatação que este ADR existe para registrar, porque os dois
mecanismos compartilham uma palavra do vocabulário ("área") e nada mais. A
cascata de binding de modelo do ADR 0064
(`session > agent > area > project > workspace`) escolhe UM vencedor — o
escopo mais específico que tem valor sobrepõe tudo abaixo dele. Orçamento não
funciona assim, e nunca funcionou: os orçamentos de projeto e de sessão já
eram checagens independentes, cada uma capaz de bloquear sozinha
(`CheckBudgetGateUseCase.execute` roda as duas em paralelo e devolve
`blocked: true` no instante em que qualquer uma estoura). O orçamento de área
entra como TERCEIRA checagem independente, no mesmo `Promise.all`, com a mesma
semântica de qualquer-uma-bloqueia-tudo. Não existe "orçamento de área
sobrepõe orçamento de projeto" nem o contrário — um agente pode ser bloqueado
por QUALQUER uma das três, independentemente do que as outras duas digam.

### 2. As colunas moram em `agent_areas`, não na tabela genérica `budgets`, nem numa nova {#2-the-columns-live-on-agent_areas-not-the-generic-budgets-table-not-a-new-one}

Três opções estavam na mesa:

- **A tabela genérica `budgets`.** Ela tem uma CHECK constraint
  (`budgets_scope_check`) que impõe que EXATAMENTE UM de `project_id`/
  `session_id` esteja preenchido — a forma inteira da tabela é construída em
  torno da exclusão mútua entre dois escopos. Encaixar um terceiro (`area_id`,
  que precisa de chave composta própria com `project_id`, já que áreas não são
  únicas globalmente) por essa constraint significaria retrabalhá-la numa
  regra de exclusão a três numa tabela que nunca foi desenhada para carregar
  mais de dois, e área é um tipo de escopo fundamentalmente diferente: ela não
  precisa de `policy` (`block`/`allow`) nem das notificações de limiar
  70/90/100 que os outros dois têm — é um teto liga/desliga mais simples, sem
  modo só-aviso.
- **Uma tabela nova `area_budgets`.** Tecnicamente limpa, mas significaria
  duas idas ao banco (e duas janelas potenciais de inconsistência) para toda
  leitura e escrita que já toca `agent_areas` — exatamente a mesma forma de
  pergunta que `max_parallel` já responde direto na linha: "quanto o lead
  desta área pode fazer sem pedir". Um join para o que já é uma relação 1:1
  com uma linha lida em toda decisão de paralelismo.
- **`agent_areas.budget_micros`/`spent_micros` (escolhida).** Espelha
  `max_parallel` exatamente — mesma tabela, mesma linha, mesmo padrão "o teto
  do lead, a decisão do usuário", mesma forma `setBudget`/`setMaxParallel` em
  `AgentAreaRepository`. `budget_micros` é anulável (`null` = sem teto, o
  padrão — a maioria dos projetos nunca vai configurar um) com uma CHECK
  (`IS NULL OR >= 0`); `spent_micros` é `NOT NULL DEFAULT 0` com CHECK
  própria (`>= 0`), incrementado atomicamente (`spent_micros = spent_micros +
  delta`) pelo mesmo caminho único de metering (`RecordLlmUsageUseCase`) que
  já incrementa o gasto de projeto e de sessão — SEMPRE, haja teto
  configurado ou não, para que o gasto real da área fique visível desde o
  primeiro turno de agente, antes de alguém definir um limite.

### 3. Resolver a que área um ator pertence usa a função pura do catálogo, não uma consulta de pertinência {#3-resolving-which-area-an-actor-belongs-to-uses-the-pure-catalog-function-not-a-membership-query}

`areaDo(agentId)` (`src/domain/agents/agent-areas.ts`, ADR 0053) já responde
"de que área este agente é lead ou membro" SEM tocar o banco — é uma função
pura sobre o catálogo estático (membros fixos de `qa`/`infra`, `dev` casado
pelo prefixo `dev-`, que cobre `dev-<modulo>` E `dev-<modulo>-2` sem precisar
conhecer o `module_map` do projeto). `CheckBudgetGateUseCase` e
`RecordLlmUsageUseCase` a chamam primeiro, só com a string `agentId`, e só
consultam `AgentAreaRepository.findByKey` quando ela devolve uma
correspondência — então um ator sem área (um humano no chat, ou um agente
fora de qualquer área) não custa nada além da chamada à função pura. Este é um
caminho de resolução DIFERENTE do de `RequestParallelizationUseCase`, que já
sabe que o contexto é `dev` e busca essa chave direto
(`this.areas.findByKey(projectId, 'dev')`) — ele não precisa resolver a área
de um ator arbitrário, só ler a que já conhece.

### 4. `maintainer`, sem evento de domínio, o mesmo raciocínio de `max_parallel` {#4-maintainer-no-domain-event-same-reasoning-as-max_parallel}

`SetAreaBudgetUseCase` espelha `SetAreaMaxParallelUseCase`: `maintainer`
(mudar um teto de gasto é decidir quanto o produto pode gastar sem pedir, a
mesma regra de ativar a execução), e nenhum evento é emitido (configuração de
projeto, sem sessão onde registrar — o mesmo raciocínio já registrado em
`SetAreaMaxParallelUseCase`). Diferente de `max_parallel`, o valor pode ser
`null`, e limpá-lo é uma entrada de primeira classe, não uma rota de remoção
separada — a mesma forma de DTO `ValidateIf`-sobre-`IsOptional` já usada por
`RenameSessionDto` (`name: null` limpa o nome da sessão).

## Consequências {#consequences}

**A favor**

- O item "orçamento por área" sai do backlog (`docs/explanation/backlog.md`)
  depois de aberto desde a FASE 8.
- O gasto da área é visível mesmo sem teto — `spent_micros` não depende de
  configurar `budget_micros` primeiro.
- Nenhum custo de migração além de duas colunas e duas CHECKs numa tabela
  existente — nenhuma tabela nova, nenhuma FK nova, nenhum join acrescentado
  ao caminho quente (`agent_areas` já é lida em toda decisão de paralelismo).

**Contra**

- Sem notificações de limiar (70/90/100%) para orçamentos de área, diferente
  de projeto/sessão — uma simplificação deliberada (item 2), não um descuido:
  se se provar necessária, pode ser acrescentada depois sem tocar a decisão
  aditivo-versus-cascata.
- `RecordLlmUsageUseCase` passa a depender de `AgentAreaRepository` além de
  `BudgetRepository` — uma dependência a mais no caminho único de metering,
  aceita porque dividi-lo em dois caminhos de escrita reabriria exatamente o
  risco de "não obrigatório por construção" contra o qual o próprio comentário
  de documentação da classe adverte.

## Alternativas consideradas {#alternatives-considered}

**Um quarto valor `budgetScope: 'area'` na tabela genérica `budgets`.**
Rejeitado no item 2 — a CHECK constraint e a forma de `policy`/limiar não
cabem num escopo tão mais simples, e a área já tem uma casa natural
(`agent_areas`) que `max_parallel` já provou.

**Fazer uma cascata com projeto/sessão (o mais específico vence).** Teria
apagado a diferença entre esta funcionalidade e o binding de modelo do ADR
0064, e teria sido uma garantia MAIS FRACA do que a que existe hoje — "o
orçamento do projeto sempre bloqueia, independentemente de qualquer outra
coisa" deixaria de ser verdade no momento em que um escopo inferior pudesse
sobrepô-lo. Rejeitado de saída; registrado aqui principalmente porque a
colisão de nomes com o ADR 0064 torna a tentação de confundir os dois real o
bastante para merecer ser escrita.

## Referências {#references}

- [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md) — `agent_areas`/
  `max_parallel`, o padrão que este ADR espelha
- [ADR 0063](0063-duas-audiencias-para-o-mesmo-gasto.md) — orçamentos de
  projeto/sessão, `CheckBudgetGateUseCase`/`RecordLlmUsageUseCase`
- [ADR 0064](0064-escopo-de-area-na-cascata-e-o-binding-de-agente-global.md) — a cascata de binding de modelo,
  um mecanismo DIFERENTE deste
- `apps/api/src/domain/llm/area-budget.ts` — `isAreaBudgetExceeded`, o
  predicado puro
- `apps/api/src/domain/agents/agent-areas.ts` — `areaDo`, o resolvedor puro
  de pertinência reusado aqui
- [RN-443](../business-rules.md#rn-443)
