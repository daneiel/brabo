# ADR 0094 — A delegação Dev Lead → dev vira dado, com `parecerArtifactId` redefinido

- **Status:** Aceito
- **Data:** 2026-08-17
- **Contexto:** auditoria fluxo.yml × código (Onda 2, item B1,
  `docs/explanation/auditoria-fluxo-vs-codigo.md`, seção D)
- **Revoga corte de:** [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md)
  (item 5, "Delegação interna", declarado como consequência direta do Dev
  Lead existir mas explicitamente **não implementado** à época — ver também
  CLAUDE.md, "O que NÃO fazer" / FASE 14d)
- **Estende:** [ADR 0038](0038-hierarquia-de-agentes.md) (dono do desenho
  original de `delegations`/`RecordDelegationUseCase` — tabela, `area` como
  TEXT, e o padrão `completed`/`failed`/`dispensed` que QA e Infra já usam)

## Contexto

O ADR 0053 (FASE 14d) criou o Dev Lead e, no mesmo texto, já previu que a
ativação de um `dev-<modulo>` seria "delegação de área, privada, na tabela
`delegations` com `area = "dev"` — o mesmo caminho de QA e Infra". Mas
declarou isso **fora do escopo daquela entrega**, junto com o botão "Ativar
execução" mudar de dono — as duas listadas em CLAUDE.md como cortes
reversíveis, "a execução continua no caminho atual".

A auditoria só-leitura de `docs/fluxo.yml` × código (achado B1) confirmou
que a lacuna seguia aberta: `dev_lead_server.ex` só tem duas ferramentas
(`propose_execution_plan`, `assess_implementability`) e NUNCA grava
`delegations` — só QA (`qa_lead_server.ex`) e Infra (`infra_lead_server.ex`)
gravam, e os dois do lado ENGINE, via `EngineApiClient.record_delegation/1`
→ `POST /internal/sessions/:sessionId/delegations` →
`RecordDelegationUseCase`.

### Por que o Dev Lead não pode simplesmente imitar QA/Infra

QA e Infra gravam a delegação do lado ENGINE porque é lá que o subagente
roda e produz um **parecer** — um veredito de uma rodada única
(`record_gate_verdict`, `open_infra_pr`) que justifica `parecerArtifactId`
apontando para o artefato que aquele parecer produziu.

O Dev Lead não tem esse padrão. A ativação de um `dev-<modulo>` acontece do
lado **API**, em `AcceptParallelizationUseCase.execute`
(`apps/api/src/application/use-cases/execution/accept-parallelization.use-case.ts`),
chamada tanto pelo caminho direto (abaixo do teto,
`RequestParallelizationUseCase`) quanto pelo caminho aprovado (acima do
teto, `ExecuteParallelizationUseCase` depois que o usuário aprova a
`proposed_action` tipo `parallelize`). Não existe "parecer" nenhum: o dev
agent não produz um veredito ao subir, ele só começa a trabalhar.

## Decisão

**A gravação entra dentro de `AcceptParallelizationUseCase.execute`, do
lado API — sem tocar Elixir/engine.** Cobre os dois caminhos (direto e
aprovado) de graça, porque os dois já convergem nesse método.

### `status: 'completed'` é redefinido para esta área

Em QA e Infra, `completed` significa "o subagente terminou e emitiu
parecer". Para o dev, `completed` passa a significar **"a delegação foi
EFETIVADA"** — o agente `dev-<modulo>` realmente subiu. É uma redefinição
CONSCIENTE do mesmo campo para uma terceira área, sem mudar o schema: o
tipo (`DelegationStatus`) e a constraint do banco
(`delegations_completed_tem_parecer`) continuam exigindo
`parecerArtifactId` não-nulo em `completed`, mas o que aquele id
JUSTIFICA muda por área.

`parecerArtifactId` aponta para o `id` do evento `artifact.module_map`
mais recente e vigente do projeto — o mesmo artefato que
`QaEstrategiaContext.fetch/3` e `AppSecContextBuilder` já buscam do lado
engine, aqui obtido via `SessionEventRepository.listByTypeForProject
(projectId, 'artifact.module_map')` (método genérico já existente, usado
por `computeCoverage` para `artifact.business_rule` — nenhuma consulta
nova foi escrita, só uma chamada a mais dele), tomando o ÚLTIMO item (a
função ordena por `createdAt` ASC). É o artefato que **justificou a
decisão de delegar**: o Dev Lead decide quantos agentes por módulo olhando
o `module_map`, e é essa leitura — não um parecer de subagente — que dá
sentido à delegação.

### Sem module_map: nunca um id falso

Se não houver `artifact.module_map` nenhum no projeto — não deveria
acontecer, já que o Arquiteto sempre entrega module_map antes do Dev Lead
operar (entrada obrigatória dele em `docs/fluxo.yml`) —, a delegação NÃO é
gravada com um id inventado. `AcceptParallelizationUseCase` loga o estado
inesperado com `Logger.error` e retorna, pela mesma lição da
[RN-059](../business-rules/custo.md#rn-059): nunca falha silenciosa, mas também
nunca finge uma justificativa que não existe.

### Falha ao registrar não derruba a ativação

A ativação do dev agent já é sucesso quando a tentativa de gravar a
delegação acontece — ela vem DEPOIS de `engineClient.acceptParallelization`
e do evento `execution.parallelization_accepted`. Se
`RecordDelegationUseCase.execute` lançar (ex.: violação de constraint,
banco fora do ar), o erro é capturado e logado, nunca propagado: o
`AcceptParallelizationUseCase.execute` sempre resolve `{ ok: true }` quando
chegou até esse ponto. Só a GRAVAÇÃO da delegação pode falhar/pular — a
ativação em si, não.

### `area`/`lead_agent`/`subagent`

`area: 'dev'`, `lead_agent: 'dev-lead'` (string literal, mesmo padrão de
`'qa-lead'`/`'infra-lead'`), `subagent`: o id exato do agente
`dev-<modulo>` recém-ativado — `extraDevAgentId(module)`, a MESMA função
que `AcceptParallelizationUseCase` já usa para nomear o agente (inclui o
sufixo `-2` de instância extra, mesmo padrão que a RN-195..201 documenta
em outro contexto). Nenhum formato novo foi inventado.

`taskId` fica `null` (default de `RecordDelegationUseCase`) — mesma
escolha de Infra: a delegação é sobre a SESSÃO/módulo, não sobre uma task
de backlog específica.

## Consequências

**A favor**

- Fecha a divergência entre `docs/fluxo.yml` (que já declarava
  `delegacao`/`dev` como entrega real desde o ADR 0053) e o código —
  mesma classe de correção do ADR 0086.
- `delegations` passa a ter as TRÊS áreas (`qa`, `infra`, `dev`)
  gravando pelo mesmo mecanismo, com o painel do time e qualquer leitura
  futura de "quem o lead delegou" cobrindo o dev sem caso especial.
- Zero schema novo, zero migration: a tabela e a constraint já suportavam
  o caso, só faltava o chamador do lado dev.

**Contra**

- `parecerArtifactId` deixa de significar uma coisa só em `delegations`:
  quem lê a tabela sem contexto de área pode assumir "sempre é um parecer
  de subagente", o que é falso para `area = 'dev'`. Mitigado por este ADR
  e pela RN nova ficarem como referência única da redefinição — nenhuma
  tela hoje interpreta `parecerArtifactId` de forma que dependa dessa
  distinção (é campo opaco, exibido como id).
- A gravação da delegação pode SILENCIOSAMENTE não acontecer (module_map
  ausente, ou `RecordDelegationUseCase` falhando) sem que o usuário veja
  isso na tela — só no log do processo. Aceito pela mesma razão do ADR
  0053 item 5 original: a ativação do agente é o que importa para a
  execução seguir, e bloquear um sucesso já consumado por causa de uma
  gravação auxiliar seria pior.

## Alternativas consideradas

**Gravar a delegação do lado ENGINE, no `dev_lead_server.ex`, imitando
QA/Infra ao pé da letra.** Recusada: exigiria uma chamada HTTP nova
engine→api só para isso, quando a ativação já acontece inteiramente do
lado API. Também obrigaria inventar um "parecer" que o Dev Lead não
produz — o plano de paralelismo (ADR 0086) já é `proposed_action`
separada, e reusar aquele evento como parecer da delegação misturaria dois
desfechos distintos (autorização de paralelismo vs. efetivação da
ativação).

**`status: 'completed'` só depois de o dev agent produzir algo (ex.: abrir
a primeira PR).** Recusada: não há gatilho natural nem evento único que
marque isso, e adiar a gravação até lá deixaria delegações "pendentes" por
tempo indefinido — o schema não tem `status: 'pending'` de propósito
(nota em `record-delegation.use-case.ts`: "o lead resolve cada delegação
síncrona, numa rodada só").

**Travar a ativação se a delegação não puder ser gravada.** Recusada:
inverteria a prioridade errada — a ativação do dev agent é o valor real
entregue ao usuário; a delegação é auditoria sobre um fato que já
aconteceu. Falhar a ativação por causa de auditoria seria pior do que a
lacuna que este ADR fecha.

## Referências

- `apps/api/src/application/use-cases/execution/accept-parallelization.use-case.ts`
  (`recordDevDelegation`)
- `apps/api/src/application/use-cases/execution/record-delegation.use-case.ts`
- `apps/api/test/application/use-cases/execution/accept-parallelization.use-case.spec.ts`
- [RN-404](../business-rules.md#rn-404) (delegação Dev Lead → dev)
- [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md) — item 5,
  corte revogado aqui
- [ADR 0038](0038-hierarquia-de-agentes.md) — desenho original de
  `delegations`/`RecordDelegationUseCase`
- [ADR 0086](0086-dev-lead-plano-suspende-para-aprovacao.md) — outro
  fechamento de divergência entre `docs/fluxo.yml` declarado e código do
  Dev Lead
- `docs/fluxo.yml` — entrada `delegacao`/`dev` (deixa de citar
  `status: lacuna`)
