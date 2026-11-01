# ADR 0087 — O UX Designer entra como agente conversacional

- **Status:** Aceito
- **Data:** 2026-08-17
- **Contexto:** decisão explícita do dono do produto, antecipando o
  gatilho de separação que `docs/fluxo.yml` já declarava para o papel

## Contexto

`docs/fluxo.yml` (ADR 0085) já registrava `ux-designer` como papel do
modelo-alvo do time, com `status: proposto`, `hoje_absorvido_por: criativo
(discovery) + design/ (design system como dado)` e um critério de separação
objetivo:

> Quando o projeto GERENCIADO tiver interface própria a desenhar — hoje o
> design system é insumo estático. Separa quando protótipo virar artefato
> recorrente.

Esse gatilho **não disparou**. O Brabo ainda não constrói projetos com UI
própria de verdade em produção; o design system (`design/tokens.css`,
`design/COMPONENTS.md`) continua sendo insumo estático que o Arquiteto e os
dev agents consultam, nunca um projeto vivo que precise de decisão de UX
recorrente.

O dono do produto decidiu, mesmo assim, construir o agente agora — decisão
CONSCIENTE de antecipar, registrada aqui para não ser confundida com um erro
de leitura do critério. O histórico do que o papel absorvia continua em
`docs/fluxo.yml`, como comentário: o texto anterior não é apagado, só deixa
de ser o estado vigente.

## Decisão

**O UX Designer entra como o quinto agente conversacional — Criativo, PO,
Arquiteto, Dev Lead e agora UX Designer —, SOLO (sem área, sem subagentes),
espelhando o desenho do `Engine.Agents.DevLeadServer`.**

### As peças

1. **`Engine.Agents.UxDesignerServer`**
   (`apps/engine/lib/engine/agents/ux_designer_server.ex`) — GenServer por
   sessão, rehydration do event log, streaming, laço bounded de tool use com
   teto 14 (mesmo calibre de Arquiteto/Dev Lead: agente de RACIOCÍNIO, não
   conversação leve como Criativo/PO, que têm teto 12). Ativado por handoff
   `accepted` endereçado a "ux-designer" — o mecanismo é GENÉRICO
   (`ActivateAgentUseCase`/`canActivateAgent` na api já aceitam qualquer
   agente com handoff aceito; nenhuma linha mudou lá) — e o kickoff só roda
   num start FRESCO (restart não regera o protótipo).
2. **O kickoff lê `artifact.product_brief`**, a MESMA "necessidade de
   negócio" que o Criativo produz — sem artefato novo, mesmo padrão de
   leitura que `ArquitetoServer.build_kickoff/1` já faz.
3. **O sistema de design é DESCRITO na identidade**
   (`Engine.Harness.Agents`, entrada `"ux-designer"`), texto estático com os
   tokens de `design/tokens.css` (cores semânticas, tipografia, espaçamento,
   raio) e as convenções de `design/COMPONENTS.md` (variantes de botão,
   estilo de ícone). Os agentes conversacionais NÃO têm ferramenta de
   leitura de arquivo do repositório — não havia tool a reusar —, e a
   identidade é a única camada do prompt presente em TODO turno, não só no
   kickoff.
4. **`propose_prototype`** (`Engine.Agents.UxDesignerTools`,
   `apps/engine/lib/engine/agents/ux_designer_tools.ex`) — a ÚNICA
   ferramenta: `personas`, `jornadas`, `prototipo` (`telas` + `anotacoes`) e
   `resumo`. Grava `artifact.prototipo_navegavel` e oferece handoff para
   "po" e para "dev-lead" sobre o MESMO artefato.
5. **`Engine.Agents.UxDesignerSupervisor`** — cópia exata do padrão de
   `DevLeadSupervisor`; registrado em `Engine.Application` ao lado dele.
   `EngineWeb.AgentCommandController` ganhou as três cláusulas (`start`,
   `message`, `via_for`) que os outros quatro conversacionais já têm.
6. **`apps/web/src/lib/agents.ts`**: `'ux-designer'` no `AgentKey`, entrada
   com `color: 'var(--accent)'`. Nenhum dos cinco tokens semânticos de
   `design/tokens.css` estava livre de outro agente — `--accent` é o menos
   reusado (só o Arquiteto), e a regra do design system proíbe hex novo.
   `icon: PencilIcon`, o único ícone do catálogo semanticamente ligado a
   design/edição ainda sem dono.

### `artifact.prototipo_navegavel`: sem tabela, e sem caso de uso dedicado na api

Esta é a decisão que precisou de investigação antes de codar, porque os dois
precedentes de "artefato sem tabela" (`artifact.project_image`, ADR 0065;
`artifact.c4_diagram`, RN-149) usam um caminho DIFERENTE do que
`artifact.business_rule`/`artifact.product_brief` usam, e os dois caminhos
parecem intercambiáveis até se olhar POR QUÊ.

`choose_project_image`/`create_c4_diagram` têm caso de uso PRÓPRIO na api
(`DecidirImagemDoProjetoUseCase`, `CreateC4DiagramUseCase`) porque cada um
tem um motivo estrutural para isso:

- o Container level do C4 é DERIVADO do `module_map` vigente — conteúdo que
  o modelo não pode redigitar sem arriscar divergir da fonte real;
- a decisão de imagem tem recusa de domínio (tag explícita, teto de
  recursos) que mais de um consumidor precisa respeitar da mesma forma.

`propose_prototype` não tem nenhum dos dois. Personas, jornadas, telas e
anotações são conteúdo AUTOCONTIDO — só o próprio UX Designer escreve, só
ele lê de volta, nada é derivado de outro artefato e não há uma segunda
regra de domínio compartilhada esperando reuso. Por isso ele segue o
caminho do `business_rule`/`product_brief`: validação de FORMA no ENGINE
(`Engine.Harness.ArtifactSchemas`, tipo `"prototipo_navegavel"`) e gravação
pelo caminho GENÉRICO que a api já expõe para qualquer `session_event`
(`EngineApiClient.append_event_returning/3`, sem rota nova). Abrir um
`CreatePrototipoUseCase` replicaria a forma de `CreateC4DiagramUseCase` sem
nenhum dos dois motivos que a justificam ali — complexidade sem argumento.

### Um artefato, dois handoffs — nunca dois artefatos

`docs/fluxo.yml` lista duas saídas do papel: `prototipo` (para o PO) e
`spec-visual` (para o Dev Lead). A tentação óbvia era um segundo tool call
ou um segundo artefato para "spec-visual". A decisão foi NÃO duplicar: o
protótipo (telas + anotações de comportamento) É a spec visual — o PO lê
`resumo`/`prototipo` para desenhar o backlog, o Dev Lead lê as MESMAS
`telas`/`anotacoes` como referência de implementação. Duas cópias do mesmo
conteúdo divergiriam na primeira revisão feita de um lado só — o mesmo
argumento que já vale para o C4 não redigitar o `module_map`.

### O turno para no primeiro sucesso — a lição do Dev Lead, sem a suspensão dele

`UxDesignerServer` reusa a metade do desenho do `DevLeadServer` que
sobrevive sem o ADR 0086: um `propose_prototype` BEM-SUCEDIDO encerra o
turno, para o modelo não propor de novo e produzir dois protótipos com o
mesmo total (o defeito real que motivou aquela guarda no Dev Lead). A OUTRA
metade do ADR 0086 — suspender esperando `proposed_action` — não se aplica
aqui: `propose_prototype` não tem efeito externo nenhum (é conteúdo, não
ação; não há paralelo do "gasto que o teto da RN-083 cobra"), então nasce
como evento simples, do jeito que `execution.plan_proposed` nascia antes do
0086.

## Consequências

**A favor**

- O papel entra ativo com o MESMO rigor dos outros quatro conversacionais —
  teto de iterações, rehydration, falha narrada com origem (RN-059/163) —,
  em vez de crescer como funcionalidade ad-hoc dentro do Criativo.
- Zero rota nova na api: o mecanismo de ativação por handoff, o
  `append_event_returning` genérico e o `create_handoff` genérico já
  bastavam. A única superfície nova na api é o campo `uxDesignerActive` no
  roster (RN-287), simétrico ao que `infraActive` já fazia.
- `docs/fluxo.yml` deixa de descrever um papel que o código não tinha —
  `status: active`, entradas/saídas reais, sem o sufixo `_alvo`.

**Contra**

- **Gatilho antecipado, por decisão explícita.** O critério de separação
  original (interface própria em projeto gerenciado) não se sustenta
  sozinho como justificativa — é aceito porque o dono do produto pediu,
  ciente disso.
- **`teste-de-usabilidade` fica fora de alcance.** Exige usuário humano
  real testando a interface; nenhum agente substitui isso. Não simulado.
- **`metricas-de-uso` segue lacuna declarada.** Depende do papel
  `analytics` (métrica de PRODUTO), que `docs/fluxo.yml` mantém `proposto`
  — sem ele, a entrada correspondente do UX Designer não tem fonte real.
- **O card do dashboard e o painel do time calculam `uxDesignerActive`
  separadamente** (RN-090) — mesma duplicação que `infraActive` já tinha,
  aceita pelo mesmo motivo: a api responde FATOS, a apresentação é do web.

## Alternativas consideradas

**Esperar o gatilho de separação disparar.** Era a leitura literal de
`docs/fluxo.yml` antes desta mudança. Recusada por decisão explícita do
dono do produto — ver Contexto.

**`artifact.prototipo_navegavel` com caso de uso dedicado na api, no
padrão de `CreateC4DiagramUseCase`.** Recusada: nenhum dos dois motivos que
justificam aquele padrão (conteúdo derivado, recusa de domínio
compartilhada) se aplica aqui. Copiar a forma sem o motivo é complexidade
que a próxima pessoa lendo o código teria de justificar sozinha.

**Um segundo tool call/artefato para "spec-visual".** Recusada: o protótipo
já é a spec visual. Duas cópias do mesmo conteúdo (uma para o PO, outra
para o Dev Lead) arriscariam divergir na primeira revisão feita de um lado
só.

**UX Designer como subagente de uma área nova.** Recusada: nada no papel
pede delegação interna nem múltiplos executores em paralelo — é raciocínio
de UMA pessoa por sessão, como Criativo/PO/Arquiteto/Dev Lead já são.

## Referências

- `docs/fluxo.yml` — bloco `id: ux-designer`, o gatilho de separação
  original
- [ADR 0085](0085-fluxo-como-registro-declarativo.md) — `docs/fluxo.yml`
  como registro declarativo dos papéis
- [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md) — cria o Dev Lead,
  o molde que este ADR replica
- [ADR 0086](0086-dev-lead-plano-suspende-para-aprovacao.md) — por que
  `propose_prototype` NÃO suspende (não tem efeito externo)
- [ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md),
  [RN-149](../business-rules/autenticacao.md#rn-149) — o padrão de artefato sem tabela
  que `artifact.prototipo_navegavel` segue, e por que ele NÃO precisa do
  caso de uso dedicado que os outros dois têm
- `apps/engine/lib/engine/agents/ux_designer_server.ex`,
  `ux_designer_tools.ex`, `ux_designer_supervisor.ex`
- `apps/engine/lib/engine/harness/agents.ex`, `artifact_schemas.ex`
- `apps/web/src/lib/agents.ts`, `agent-status.ts`
