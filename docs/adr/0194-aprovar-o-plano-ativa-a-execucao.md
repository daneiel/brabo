# 0194 — Aprovar o plano do Dev Lead ativa a execução, e a tarefa ganha o módulo que ele atribui

## Status

**Accepted.** 2026-10-01 (AT-263 e AT-274, épico EP-030, rodada 36; decisões
do dono em 01/10: *"a ativação da execução passa a ser o APROVAR do plano do
Dev Lead; aceitar o handoff do Dev Lead só o traz para planejar"* e *"quem
atribui o módulo da tarefa é o Dev Lead, ao montar o plano de execução; só o
dev daquele módulo a pega"*). Revisa, sem editá-los, o
[ADR 0069](0069-fusao-condicional-do-handoff-com-a-ativacao-de-execucao.md)
(a fusão condicional do aceite com a ativação, RN-161) e a parte do
[ADR 0086](0086-dev-lead-plano-suspende-para-aprovacao.md) que
dizia que `propose_execution_plan` não tem pipeline de execução. Preserva o
[ADR 0165](0165-o-repositorio-nasce-no-handoff-ao-arquiteto.md) (o repositório
nasce no aceite ao Arquiteto, o do Dev Lead é a segunda porta, e
`execution/activate` sem repositório é 409) e o
[ADR 0061](0061-tipo-da-sessao-na-criacao.md)
(`execution.activated` em sessão consultiva é 409).

## Context

Medido em `dev` (d89f777) antes de mudar:

- **Quem emite `execution.activated`** é só `ActivateExecutionUseCase`, e ele
  só é chamado pela rota `POST .../execution/activate`. O backend do aceite
  (`AcceptHandoffUseCase`) nunca ativou nada: provisiona o repositório quando o
  destino é `arquiteto` ou `dev-lead` e ativa o AGENTE. A "ativação no aceite"
  era do WEB — `handleAcceptHandoff` encadeava `activateExecution` quando o
  destino era `dev-lead` e o papel de workspace era `maintainer`/`owner`
  (RN-161).
- **O plano não tinha consumidor.** `propose_execution_plan` é
  `proposed_action` desde o ADR 0086 e o Dev Lead suspende esperando a decisão,
  mas aprovado ele ficava `approved` para sempre: `ApproveActionUseCase` não
  tinha ramo para o tipo, e o Dev Lead lia "plano aprovado e registrado". No
  uso real de 29/09 a execução subiu às 06:45:01, no aceite; o plano chegou às
  06:47:47 e ficou `pending`.
- **A tarefa não tinha módulo.** `claimNext` pega a próxima tarefa `todo` de
  história `ready` cujo `module_ids` (jsonb, vários) contém o módulo do dev.
  Com uma história de dois módulos, `dev-input-keyboard` pegou "loop de queda
  automática da peça" e `dev-board-engine` pegou "mapear teclas" (sessão d7e9,
  seq 185/187).
- O Dev Lead não via `task_id` nenhum: o kickoff listava só módulos e
  histórias, tirados do log da própria sessão.

## Decision

1. **O aceite do Dev Lead não ativa a execução**, para papel nenhum.
   `handleAcceptHandoff` só aceita; `AcceptHandoffUseCase` não muda (segue
   provisionando como segunda porta). O botão explícito "Ativar execução" do
   card (RN-137) e o da Visão Geral FICAM: são um gesto próprio de quem decide
   pular o plano, e a rota `execution/activate` segue com todas as recusas.
2. **Aprovar `propose_execution_plan` executa o plano**, num executor novo na
   api — `ExecuteExecutionPlanUseCase`, no módulo de execução, ao lado de
   `ExecuteParallelizationUseCase` —, chamado pela aprovação manual e pela
   auto-aprovação (o tipo continua FORA dos tetos absolutos de `decide.ts`,
   como o ADR 0086 decidiu). Ele: relê o plano contra o `module_map` vigente;
   grava o módulo das tarefas; e chama o MESMO `ActivateExecutionUseCase` do
   botão, com quem aprovou (ou, auto-aprovado, quem abriu a sessão) como quem
   ativa. Sem `originSessionId`: a sessão do Dev Lead é onde ele retoma e
   narra. O desfecho é `executed` (`sessaoDeExecucao`, `modulos`,
   `tarefasAtribuidas`) ou `failed` (`motivo`), com
   `execution.plan_applied`/`execution.plan_failed` na timeline, e é o que o
   Dev Lead lê ao retomar.
3. **A tarefa ganha coluna `module`** (`tasks.module text NULL`, migração
   `0068_modulo_da_tarefa`). O plano carrega `tarefas: [{ taskId, modulo }]`,
   validado por uma função PURA (`lerPlanoDeExecucao`) contra o `module_map`
   vigente e as tarefas do projeto, DUAS vezes: na proposta (400
   `plano_de_execucao_invalido`, sem criar a ação — a frase volta ao Dev Lead
   como erro da ferramenta) e na aprovação (o mapa pode ter mudado; recusa
   vira `failed` sem gravar nada). O kickoff do Dev Lead lista as tarefas
   pendentes do backlog do PROJETO (`list_backlog`), com `task_id` e os
   módulos da história.
4. **Só o dev do módulo pega a tarefa.** `claimNext` e `countClaimableByModule`
   passam a usar um predicado só: `t.module = $modulo`, OU tarefa sem módulo
   cuja história tem exatamente UM módulo e ele é `$modulo`.

## Consequences

- **A ativação passa a custar a aprovação de um plano válido**, e um plano só
  é válido com TODA tarefa citada atribuída a um módulo do `module_map`. Um Dev
  Lead que não consiga montar `tarefas` (backlog vazio, tarefas em outro
  projeto) não ativa nada pelo caminho novo; o botão explícito continua sendo a
  saída, e é declarado como tal.
- **A ponte para tarefa sem módulo é deliberada e estreita.** Sem ela, quem
  ativa pela Visão Geral sem plano não teria tarefa pegável nenhuma; com ela
  restrita à história de UM módulo, a regra "só o dev daquele módulo" continua
  verdadeira, porque ali não há outro. Tarefa sem módulo de história com vários
  módulos fica parada até o próximo plano — e o PO não atribui módulo, então
  tarefa criada DEPOIS do plano aprovado cai nesse caso. Fechar isso (o PO
  atribuindo, ou um replanejamento automático) é decisão à parte.
- **O aviso `task.became_claimable` continua roteado pelos módulos da
  HISTÓRIA.** Acordar um dev que não vai pegar nada custa uma consulta e
  nenhum gasto de modelo; rotear pelo módulo da tarefa exigiria mexer nos
  emissores do aviso, fora do escopo.
- **`agentes` por módulo continua informativo.** A ativação sobe um dev por
  módulo do `module_map`, como antes; mais de um por módulo segue pelo
  `parallelize` (RN-083), com o teto dele.
- **A chamada de `propose_action` do engine continua no default de 15 s** do
  Req para este tipo. Auto-aprovado, a api ativa a execução dentro da mesma
  requisição (semeia instruções e autonomia, chama o engine); não foi medido
  um caso que passe de 15 s, e se passar o desfecho chega pela timeline mesmo
  com o tool-result dizendo erro de transporte.
- **A tela não navega até a sessão de execução** depois de aprovar o plano
  (a RN-634 fazia isso no botão): a aprovação é do `ApprovalCard`, de outra
  frente. O Dev Lead diz em qual sessão a execução subiu.
