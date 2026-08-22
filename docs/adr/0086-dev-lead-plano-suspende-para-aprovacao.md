# ADR 0086 — O plano do Dev Lead suspende o turno para aprovação

- **Status:** Aceito
- **Data:** 2026-08-16
- **Contexto:** auditoria `docs/fluxo.yml` × código (achado A2)
- **Revisa parte de:** [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md)
- **Precedente direto:** [ADR 0052](0052-dev-agent-espera-aprovacao-no-meio-do-laco.md),
  [ADR 0057](0057-o-gate-espera-a-aprovacao.md)

## Contexto

Uma sessão de auditoria, só leitura, cruzou `docs/fluxo.yml` (o modelo-alvo
declarado pelo ADR 0085) com o código real
(`docs/explanation/auditoria-fluxo-vs-codigo.md`). O achado A2 encontrou uma
divergência de severidade alta: `fluxo.yml` declara a saída
`plano-de-paralelismo` do `dev-lead` como `via: proposed_action`, mas o
código produzia só um evento simples (`execution.plan_proposed`), sem
pipeline de aprovação nenhum — decisão deliberada, documentada no próprio
comentário de `dev_lead_tools.ex` na época:

> O plano vira EVENTO no log, não `proposed_action`. A distinção não é
> cosmética: propor um plano não tem efeito externo nenhum — o gasto
> acontece quando os agentes sobem, e é lá que o teto da RN-083 cobra
> autorização. Transformar a proposta em ação a decidir faria o usuário
> decidir duas vezes a mesma coisa.

Essa lição não estava errada em 2026-08-07 ([ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md),
FASE 14d): o `proposed_action` tipo `parallelize` que de fato existe é
disparado por AÇÃO DO USUÁRIO na UI pedindo reforço acima do teto
(`POST /sessions/:sessionId/execution/parallelize`), não pela saída inicial
do plano do Dev Lead. São dois mecanismos genuinamente distintos, e
`fluxo.yml` os fundiu numa única saída.

O dono do produto, diante da divergência, decidiu que o CÓDIGO erra: o
plano do Dev Lead é a PRIMEIRA decisão real de quanto a sessão vai gastar
com paralelismo — o usuário hoje só o lê narrado no fio e clica "Ativar
execução" separadamente, sem uma aprovação de verdade no meio. O plano
passa a nascer `proposed_action`, e o usuário decide olhando para ele, não
para uma linha de log.

### Por que isto é estruturalmente novo

Os quatro agentes conversacionais (Criativo, PO, Arquiteto, Dev Lead) rodam
turno SÍNCRONO via `GenServer.call` de até 180s, mediado por
`Engine.Agents.TurnoAssincrono` (RN-122) — o `handle_call` fica bloqueado
esperando a Task terminar, e quem chama (a rota HTTP do engine) espera
junto. O padrão de suspensão em aprovação já existia duas vezes:

- o dev agent ([ADR 0052](0052-dev-agent-espera-aprovacao-no-meio-do-laco.md)),
  disparado por `cast` (`work/2`, `correct/3`);
- os gates de QA/Infra ([ADR 0057](0057-o-gate-espera-a-aprovacao.md)),
  também disparados por `cast` (`run/2`).

Nenhum dos dois precisou lidar com um `from` síncrono pendente — o `cast`
não tem `from` nenhum para responder. O Dev Lead É `call`: alguém está
esperando uma resposta HTTP quando o turno suspende, e essa resposta
precisa vir NA HORA (para não travar a rota por até 180s), mesmo que o
turno em si continue pendente por muito mais tempo que isso.

## Decisão

**O plano de execução nasce `proposed_action` (tipo `propose_execution_plan`),
e o turno do Dev Lead SUSPENDE — sem terminar — enquanto ela está `pending`.**

### As peças

1. **`decide.ts` ganha o tipo `propose_execution_plan`**
   (`apps/api/src/domain/actions/decide.ts`), papel mínimo `maintainer`
   (mesmo calibre de `parallelize`: decisão de quanto o produto vai gastar
   com paralelismo). Ele é DELIBERADAMENTE deixado FORA do bloco de tetos
   absolutos (merge protegido, `instruction_patch`,
   `parallelize`/`raise_max_parallel`) — pode ser configurado para
   auto-aprovar, como já vale para `open_adr_pr`/`open_infra_pr`. A
   diferença semântica importa: os tetos absolutos existem porque o produto
   recusa deixar o usuário automatizar a PRÓPRIA decisão mesmo com "sempre
   permitir" ligado (`parallelize` é uma ULTRAPASSAGEM de um teto já
   autorizado, `raise_max_parallel` é o produto elevando o próprio limite).
   O plano do Dev Lead é a PRIMEIRA decisão da sessão, não uma ultrapassagem
   — e nada nesta feature pede um quarto absoluto.
2. **`Engine.Agents.DevLeadTools.run/2` chama `EngineApiClient.propose_action/5`**
   em vez de `append_event/3` (mesmo cliente que `Engine.Dev.AgentIo` já
   usa), e devolve um contrato de três desfechos:
   `{:ok, texto}` | `{:pending, action_id}` | `{:error, texto}`. `validar/1`
   continua barrando plano vazio ou com módulo sem agente ANTES de qualquer
   I/O — sem mudança.
3. **`Engine.Agents.DevLeadServer.run_turn/2` para no primeiro `:pending`.**
   O `Enum.reduce`/booleano de antes vira `Enum.reduce_while`, que HALTA sem
   processar mais chamadas nem recursar. O `state` devolvido carrega a
   chave nova `:aguardando_aprovacao` (`%{action_id:, tool_call_id:,
   tool_name:, remaining:}`) — o `remaining` já descontado, porque a
   iteração suspensa conta contra o teto quando retomada. A mensagem
   `role: "tool"` NÃO entra em `state.messages` neste momento: gravar
   "pending" ali mentiria pro modelo que o comando já respondeu isso (mesmo
   raciocínio do dev agent).
4. **`Engine.Agents.TurnoAssincrono.tratar_resultado/2` ganha um ramo.**
   `GenServer.reply(from, :ok)` continua acontecendo sempre, na mesma hora —
   é o que rompe o bloqueio síncrono no momento certo, suspensão ou não.
   Presente `:aguardando_aprovacao` (checado pelo VALOR, `Map.get/2` truthy
   — não pela presença da chave, porque o Dev Lead a carrega
   `nil` desde o `init/1`), chama `suspender/1` em vez de `finalizar/1`: só
   `agent.status: awaiting_approval`, sem `agent.done` — o turno não
   terminou.
5. **`Engine.Sessions.LiveBroadcast.agent_status/4` ganha o status novo**
   na guarda (`["working", "idle", "awaiting_approval"]`) — sem isto o
   `agent.status` do passo 4 nem seria persistido (ADR 0021: é o único
   evento que PRECISA ser durável, não só broadcastado).
6. **A retomada.** `DevLeadServer` assina `Engine.Dev.Wake.subscribe(project_id,
   "dev-lead")` no `init/1` — o MESMO módulo que `Engine.Gates.QaLeadServer`
   já reusa para os subagentes de QA, apesar do nome ser "dev": a entrega de
   `{:action_settled, ...}` é por AGENTE, roteada pelo `agentId` do payload
   (`DevAgentWakeWorker`), não por tipo. Ao chegar, um `handle_info` monta a
   mensagem `role: "tool"` com o resultado REAL (`texto_do_desfecho/1`,
   mesmo vocabulário do dev agent e do `QaLeadServer`), zera
   `aguardando_aprovacao` e retoma com `TurnoAssincrono.iniciar(state, nil,
   fn -> run_turn(state, pendente.remaining) end)`.
7. **Uma segunda `user_message` durante a suspensão não inicia turno novo.**
   Guard em `handle_call({:user_message, _text}, _from,
   %{aguardando_aprovacao: %{}})`, testado ANTES da cláusula genérica, emite
   `agent.error` (origem `politica`) e responde `{:reply, :ok, state}` —
   a resposta HTTP dessa rota já é descartada pelo controller do engine para
   todos os agentes.

### `propose_execution_plan` não tem execute-* pipeline própria

Diferente de `parallelize`/`raise_max_parallel` (que de fato SOBEM agentes
na aprovação), aprovar o plano não tem efeito a aplicar — subir os agentes
continua sendo um ato SEPARADO, quando o usuário clica "Ativar execução".
Por isso a aprovação manual nunca sai de `status: "approved"` (a máquina de
estados de `action-state-machine.ts` modela `approved -> executed | failed`
como aberto, mas nada chama essa transição, e não deveria — não há o que
executar). O engine trata `"executed"`, `"auto_approved"` e `"approved"`
igualmente como sucesso.

## Consequências

**A favor**

- O comportamento passa a bater com o que `docs/fluxo.yml` já declarava —
  a divergência do achado A2 fecha sem editar o fluxo.
- O usuário decide o plano olhando para uma aprovação de verdade (frase em
  pt-BR, verbo, payload — RN-096), não para uma linha no fio que ele podia
  não ler.
- O mecanismo de suspensão de `TurnoAssincrono` fica genérico o bastante
  para o PRÓXIMO agente conversacional que precisar suspender não reinventar
  nada — só devolver a chave `:aguardando_aprovacao`.

**Contra**

- **Lacuna aceita, declarada: restart durante a espera.** Ao contrário do
  dev agent (que reidrata `laco_pendente` via `handle_continue` no
  `init/1`), o Dev Lead NÃO reidrata `aguardando_aprovacao` — só em
  memória. Se o engine reiniciar enquanto ele está suspenso, a decisão
  continua registrada e visível em Aprovações (é durável na api), mas o Dev
  Lead não narra o desfecho automaticamente: o processo que assinou o
  `Wake` morreu, e o próximo restart sobe um Dev Lead novo, sem inscrição
  para aquela ação. Fechar isto exigiria o mesmo mecanismo de persistência
  do ADR 0052 (`dev_lead_states`, ou equivalente) — fora do escopo desta
  mudança, que só corrige o desalinhamento entre o fluxo declarado e o
  código.
- Um turno a mais de espera antes de "Ativar execução" ficar disponível,
  quando o plano não é auto-aprovado — o mesmo custo que qualquer
  `proposed_action` já impõe, agora também aqui.

## Alternativas consideradas

**Só corrigir `docs/fluxo.yml` para bater com o código (`via: evento`).**
Recusada por decisão explícita do dono do produto: a divergência não era
erro de documentação, era o código ainda não tendo o pipeline que a decisão
de produto (fazer o usuário decidir o plano de verdade) já pedia.

**Adicionar o tipo ao bloco de tetos absolutos de `decide.ts`.** Recusada
— ver a seção "As peças", item 1. O plano não é uma ultrapassagem de teto
nem o produto elevando o próprio limite; é a decisão INICIAL, e o usuário
pode legitimamente querer configurar "sempre permitir" para ela sem que
isso vire o mesmo furo que os três tetos absolutos existem para fechar.

**Não suspender — manter o evento simples, e abrir uma segunda
`proposed_action` em paralelo (fire-and-forget).** Recusada: o `fluxo.yml`
declara que a saída EM SI é a proposta, não um evento acompanhado de uma
proposta órfã. E deixar o turno seguir sem esperar reintroduziria a mesma
falha que o ADR 0052 fechou para o dev agent — o modelo "aprenderia" que o
plano foi aceito antes de saber se foi.

## Referências

- `docs/explanation/auditoria-fluxo-vs-codigo.md` — achado A2, a origem
  desta mudança
- [ADR 0053](0053-dev-lead-e-paralelismo-autorizado.md) — cria o Dev Lead e
  o teto de paralelismo (RN-083) que motiva a existência dele
- [ADR 0052](0052-dev-agent-espera-aprovacao-no-meio-do-laco.md) — o
  precedente: o dev agent suspende no meio do laço, via `cast`
- [ADR 0057](0057-o-gate-espera-a-aprovacao.md) — o segundo precedente: os
  gates de QA/Infra suspendem, também via `cast`
- [ADR 0021](0021-fechamento-4a-infra-e-painel.md) — por que `agent.status`
  precisa ser persistido, não só broadcastado
- `apps/engine/lib/engine/agents/dev_lead_tools.ex`,
  `dev_lead_server.ex`, `turno_assincrono.ex`
- `apps/engine/lib/engine/sessions/live_broadcast.ex`
- `apps/api/src/domain/actions/decide.ts`
