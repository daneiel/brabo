# 0192 — O plano de teste nasce depois da entrega do dev, e o gate `implementavel` passa a se julgar sobre a história e o `module_map`

## Status

**Accepted.** 2026-10-01 (AT-269, história HS-069, épico EP-030, rodada 35;
decisão do dono em 01/10: *"QA só depois da entrega do dev"* — a saída (b) da
atividade, escolhida sabendo que contradiz o ADR 0090). Revisa parte do
[ADR 0090](0090-qa-estrategia-e-appsec-segundo-momento.md) sem editá-lo: a
QA-estratégia continua sendo o `qa-lead` num segundo MOMENTO, sem agente novo,
mas o momento muda de lugar — sai do design (PRE-DEV) e vai para o começo do
ciclo de revisão da entrega. O appsec, a outra metade do 0090, NÃO muda.

## Context

### O sintoma

Uso real de 29/09 (análise `analise-uso-real.md`, item A23): duas rodadas de
`toolloop.limit_reached` 8/8 seguidas de `agent.error` origem `modelo`,
"limite de iterações atingido sem emit_plano_de_teste" (sessão `be70`,
seq 373/374 e 463/464). O laço gastou as oito iterações lendo docs, um RAG
vazio e pastas (seq 375–463), e a seq 454 diz o motivo em texto: *"O código
ainda não existe"*. O Dev Lead nunca teve parecer.

### O que o código fazia (medido em `dev`, 2026-10-01)

- **Quem abre o gate.** O `implementavel` (`docs/gates.yml`) é do `dev-lead`,
  `fluxo: pre-dev`, `severidade: warn`, `aprovacao_humana: true`, evidência no
  event log (`proposed_action.*` filtrado por
  `actionType: assess_implementability`). Quem o abre é a ferramenta
  `assess_implementability` (`Engine.Agents.DevLeadTools.run_assessment/2`),
  que o kickoff do Dev Lead apresenta como OPCIONAL ("use o julgamento").
- **O que ele julgava.** `run_assessment/2` lia a cauda da sessão; sem
  `artifact.plano_de_teste` da story, chamava
  `Dispatcher.run_qa_estrategia/3` → `QaLeadServer.run_design/3` →
  `QaEstrategiaAgent.run/4` e devolvia `{:error, "chame de novo em
  instantes"}`; com plano, propunha o parecer (`implementavel`/`inviavel` +
  justificativa) com `planoDeTeste` e `criteriosExecutaveis` embutidos no
  payload. O insumo era o plano; o JULGAMENTO já era do Dev Lead.
- **O contexto da QA-estratégia.** `QaEstrategiaContext.fetch/3` dava story +
  `module_map`, sem worktree; `ReadFile`/`SearchWorkspace` caíam no checkout
  compartilhado do projeto. `EmitPlanoDeTeste` só aceita depois de uma leitura
  — então, sem código para ler, o modelo procura até o teto.
- **O teto.** `"qa-estrategia"` cai no default `:conversacional` (8) de
  `Engine.Harness.Iteracoes`, de propósito (ADR 0090: sem
  `token_budget_micros` por baixo, subir o teto multiplicaria o pior caso).
- **Quem depende do veredito.** Ninguém no código. Nenhum caso de uso da api
  nem módulo do engine lê a decisão de `assess_implementability`: a ativação
  da execução não a consulta, nenhum outro gate a tem como `entrada`, e o único
  consumidor é a tela (a frase em `apps/web/src/lib/aprovacoes.ts`). O gate é
  `warn`: a passagem é evidência, não trava.
- **O gate de depois.** `qa-verificada` (`block`, dono `area-qa`) roda em
  `QaLeadServer.run/2` sobre o worktree do dev: `ContextBuilder.fetch/3`,
  delegações (Automação sempre, Performance/Segurança por RNF) e UM
  `qa_verdict` consolidado. A Automação monta a `coverageMatrix` pelas regras
  da story (RF + RNF) e só aprova com suite verde e toda regra coberta.

## Decision

1. **O plano de teste é o primeiro passo do ciclo do `qa-verificada`.**
   `QaLeadServer.run_area/3`, depois de `ContextBuilder.fetch/3` e antes das
   delegações, obtém o plano da ENTREGA:
   - reencontra na cauda da sessão (teto da reidratação, RN-580) o
     `artifact.plano_de_teste` da MESMA `taskId` — a rodada de correção
     (RN-015) não paga outro laço;
   - não havendo, roda `QaEstrategiaAgent.run/6` síncrono, no próprio
     processo (o agente nunca suspende), com o `dev_state`/`dev_context` que as
     subespecialidades recebem: `workspace_root` = worktree do dev, as unidades
     de regra de negócio, e a lista de arquivos que a entrega tocou
     (`Engine.Gates.Diff`, `git diff dev...HEAD`, até 40 nomes) na primeira
     mensagem. Diff que falha vira texto ("não consegui listar: motivo"),
     nunca lista vazia.

   O plano entra no `dev_context` como `:plano_de_teste`, e a Automação o
   recebe NO FIM da mensagem dela, como insumo do passo 2 ("qual teste cobre
   cada regra"). **A régua do veredito não muda**: uma linha de
   `coverageMatrix` por regra da story, `approved` só com suite verde e toda
   regra coberta. O contrato externo continua sendo UM `qa_verdict` por ciclo.

2. **Plano que falha não segura a revisão.** A QA-estratégia já grava
   `agent.error` com origem (RN-059); o Lead segue sem plano, e a mensagem da
   Automação é a de antes, byte a byte. Fazer a falha do plano bloquear a task
   seria trava nova num gate `block` por causa de um insumo novo — isso não foi
   decidido, e a decisão do dono é sobre QUANDO o plano nasce, não sobre ele
   reprovar entrega.

3. **O `implementavel` se julga sobre a história e o `module_map`.**
   `assess_implementability` não lê nem dispara plano: o insumo passa a ser o
   que o Dev Lead JÁ tem no contexto do turno — o kickoff dele lista os
   módulos do `module_map` vigente e as histórias do backlog (RF, RNF, DoD) —, e
   o julgamento vai na `justificativa`. O parecer sai na PRIMEIRA chamada; o
   payload perde `planoDeTeste`/`criteriosExecutaveis`. O gate continua
   existindo, com o mesmo dono, severidade, aprovação humana e evidência —
   muda só a `entrada` (`[story-ready, module_map]`). Nenhum gate novo.

4. **O que sai.** `QaLeadServer.run_design/3`, `Dispatcher.run_qa_estrategia/3`
   (e o callback) e `QaEstrategiaContext` — sem chamador depois do item 3,
   ficariam acionáveis para um momento que a decisão do dono aposentou.

5. **O artefato muda de forma.** `artifact.plano_de_teste` passa a exigir
   `taskId` (`Engine.Harness.ArtifactSchemas`): é o plano de UMA entrega, e é
   por ele que o Lead o reencontra.

6. **O teto CONTINUA 8.** `"qa-estrategia"` não ganha cláusula em
   `Iteracoes.tipo/1`. O que faltava era insumo, não folga: com o código
   existindo e os arquivos da entrega na mensagem, duas ou três leituras
   bastam. O que mudou do lado do gasto é que existe task agora, e o agente
   passa a rodar sob o `task_budget_micros` que as subespecialidades
   compartilham (RN-036) — o critério da RN-085 até permitiria o teto de gate
   com esse orçamento por baixo, e a decisão é NÃO usar essa porta para o
   plano passar.

7. **`docs/gates.yml` e `docs/fluxo.yml` mudam porque mudou quem entrega o quê
   a quem**: `qa-verificada` ganha `plano-de-teste` na `entrada`;
   `implementavel` troca `plano-de-teste` por `module_map`; em `fluxo.yml`, a
   `qa-estrategia` passa a receber a entrega do `dev` e a entregar à
   `area-qa`, com `gate_saida` `qa-verificada` (insumo, não veredito próprio),
   e o `dev-lead` deixa de receber plano de teste.

## Consequences

**A favor**

- O sintoma do uso real deixa de ter causa: o plano não é mais pedido a um
  agente num momento em que não existe o que ele precisa ler.
- O Dev Lead tem o parecer na primeira chamada, sem a janela assíncrona sem
  callback que o ADR 0090 declarou como preço (ele dependia de o MODELO
  decidir chamar de novo).
- O plano passa a ser escrito sobre o código real, com worktree e diff, e é
  consumido por quem verifica — o `qa-verificada` —, no mesmo processo e no
  mesmo ciclo. Zero rota, zero tabela, zero GenServer novo; três peças a
  menos.
- O plano passa a ter orçamento por baixo (o da task).

**Contra**

- **O `implementavel` fica mais raso.** Antes havia um segundo olhar (QA)
  sobre a story antes de gastar tokens escrevendo código; agora o parecer é só
  do Dev Lead, sobre a história e o `module_map`. É o preço direto da decisão
  do dono, e o gate era `warn` e opcional — mas o "shift-left" do QA que o
  ADR 0090 comprou deixa de existir para o QA (o appsec continua no design).
- **Um laço de LLM a mais por ENTREGA**, no caminho crítico da revisão: a
  Automação só começa depois do plano. Por task, não por rodada (o reuso por
  `taskId`); numa sessão longa o plano pode ter saído da janela de 200 eventos
  e é escrito de novo — custo, nunca dado errado.
- **O plano compete pelo mesmo orçamento da task** que a revisão usa: uma
  entrega cara pode chegar à Automação com menos folga.
- **O plano é insumo, não régua.** Se os critérios executáveis do plano
  deveriam virar linhas obrigatórias da `coverageMatrix` (e portanto reprovar
  entrega) é decisão de produto que este ADR NÃO toma.
- **O teto 8 continua podendo estourar** numa entrega grande; aí o desfecho é
  o `agent.error` narrado e a revisão segue sem plano. Medir isso no próximo
  uso real é o que diria se 8 basta.
- O pt-BR traduzido de `docs/fluxo.yml` (`website/i18n/…`) já estava atrás do
  original antes desta mudança, e segue atrás (AT-209).

## Alternatives considered

**Saída (a): manter o plano no design, a partir de história, regras e
`module_map`, sem explorar código, com `emit_plano_de_teste` exigido cedo.**
Não contradizia o 0090 e era a correção mais barata do sintoma. Recusada pelo
dono (01/10) a favor da (b).

**Subir o teto do `qa-estrategia` para 60.** Recusada pela atividade e por
este ADR: seria fazer o plano passar gastando mais, sobre um momento em que
não há o que ler.

**Gate novo para o plano (`plano-de-teste-pronto`) depois da entrega.**
Recusada: gate novo é decisão de produto com ADR próprio, mudaria o contrato
externo (um veredito a mais por PR) e o plano não tem o que vetar sozinho — o
veredito de cobertura já é do `qa-verificada`.

**Disparar a QA-estratégia de forma assíncrona na entrega (`cast` do
`DevAgentServer`), em paralelo à revisão.** Recusada: a Automação começaria
antes do plano existir, que é a corrida que este desenho existe para evitar;
e o resultado voltaria a depender de um evento que ninguém espera.

**Aposentar o `implementavel`.** Recusada: ninguém pediu; o gate continua
tendo o que julgar (a história e o `module_map`) e continua sendo o registro
mensurável de que alguém pensou na story antes do código.

## References

- [ADR 0090](0090-qa-estrategia-e-appsec-segundo-momento.md) — o segundo
  momento do `qa-lead` e do secops; este ADR muda o momento do primeiro
- [ADR 0054](0054-gates-como-registro-declarativo.md) — o contrato externo
  dos gates
- [ADR 0085](0085-fluxo-como-registro-declarativo.md) — `docs/fluxo.yml`
- RN-674 (`docs/business-rules.md`), RN-340/341 (revistas por ela), RN-085,
  RN-036, RN-163, RN-580
- `apps/engine/lib/engine/gates/qa_lead_server.ex`,
  `qa_estrategia_agent.ex`, `qa_automacao_agent.ex`, `dispatcher.ex`;
  `apps/engine/lib/engine/agents/dev_lead_tools.ex`;
  `apps/engine/lib/engine/harness/artifact_schemas.ex`
