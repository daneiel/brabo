# ADR 0052 — O dev agent espera a aprovação no meio do laço

- **Status:** Aceito — implementado e provado por teste na fase A
- **Data:** 2026-08-05
- **Contexto:** FASE 13b — primeira execução real do dev agent com modelo de API

## Contexto

O `terminal` do dev agent é uma ferramenta `:pipeline`: o hook
`Engine.Harness.Hooks.ActionPipeline` cria um `proposed_action` na api, que
decide via `permissions.json`. Quando a decisão é `auto_approve`, a api executa
na hora e o hook devolve a saída real do comando. Quando é `require_approval`,
o hook devolve **a string** `proposed_action <id> status pending` como resultado
da ferramenta — e o ToolLoop segue para a próxima iteração.

O agente não tem como esperar. Ele lê "pending", não aprendeu nada sobre o
comando, tenta outra coisa, e cada tentativa consome uma iteração do teto.

Numa execução real (projeto `saudacao-local`, task `cd652d85`), o desfecho foi:

```
toolloop.limit_reached  {"iteration": 8, "max_iterations": 8}
backlog.task_blocked    {"reason": "limite de iterações atingido"}
```

Oito iterações queimadas, nenhuma linha escrita, e as aprovações que o usuário
concedeu chegaram depois do laço já ter se esgotado — foram inúteis.

### Por que a allowlist não resolve

`DEV_TERMINAL_ALLOW_PATTERNS` existe justamente para evitar isso, e o comentário
em `activate-execution.use-case.ts:139-144` descreve a falha com precisão. Mas
ela é uma lista de comandos previstos, e o modelo inventa comandos. Depois de
acrescentar os de leitura (`ls`, `find`, `pwd`, `cat`…), o mesmo agente avançou
bastante — worktree criado, comando com `exit 0`, arquivos lidos — e travou de
novo em `git branch -a` e `git rev-parse`.

Cada modelo novo, cada stack nova, um buraco novo. A allowlist é mitigação e
não pode ser a resposta.

### O que já existe e prova o caminho

`:awaiting_approval` **já é** um estado do dev agent, criado na Fase 12e para o
fim da task: quando o `pr_open` fica pendente, o agente retém o worktree e é
solto por `task.pr_settled`, emitido pela api e roteado pelo
`DevAgentWakeWorker`. O mecanismo inteiro — estado persistido, retenção de
worktree, evento de outbox, worker, `Wake.deliver` — está pronto e exercitado.

Falta aplicá-lo ao meio do laço, não inventá-lo.

## Decisão

Quando uma ferramenta `:pipeline` volta `pending`, o ToolLoop **para** e o
agente entra em `:awaiting_approval` retendo tudo. A decisão do usuário emite um
evento que o acorda, e o laço **retoma do ponto em que parou**, com o resultado
real do comando no lugar onde estaria a string "pending".

### Por que parar em vez de bloquear esperando

A alternativa óbvia — o hook esperar a decisão em polling — é mais simples e
está errada: o ToolLoop roda **dentro do callback do GenServer** do agente
(`dev_agent_server.ex:365`). Bloquear ali trava a própria caixa de mensagens que
traria a decisão, além do encerramento gracioso e do circuit breaker. Parar e
retomar por mensagem é o que o `pr_settled` já faz, e pelo mesmo motivo.

### As mensagens ficam em memória

O `ctx` do laço (com o histórico) fica no estado do GenServer enquanto o agente
espera. Não se persiste: o agente continua vivo, só ocioso. Isso mantém a
propriedade que a recuperação de restart já declara — turno e mensagens só
existem em memória, e restart durante a task bloqueia com diagnóstico
(`dev_agent_server.ex:153-159`). Uma aprovação pendente que atravessa um
restart cai nesse mesmo caminho, que é honesto e já existe.

## As cinco peças

| # | Onde | O quê |
|---|---|---|
| 1 | `apps/api/.../approve-action.use-case.ts`, `deny-action.use-case.ts` | emitir `task.action_settled` quando o ator da ação é um dev agent — com `actionId`, `status` e o resultado da execução |
| 2 | `apps/engine/.../hooks/action_pipeline.ex` | ao receber `pending`, sinalizar parada em vez de devolver a string |
| 3 | `apps/engine/.../harness/tool_loop.ex` | suportar `{:awaiting_approval, action_id, ctx}` como desfecho, ao lado dos `halted` que já existem |
| 4 | `apps/engine/.../dev/dev_agent_server.ex` | guardar o `ctx`, persistir `:awaiting_approval` + `action_id`, e retomar `ToolLoop.run/1` ao receber `{:action_settled, …}` |
| 5 | `apps/engine/.../workers/dev_agent_wake_worker.ex` | rotear `task.action_settled` para o agente, como já faz com `task.pr_settled` |

### Recusa também é resposta

Ação negada retoma o laço com o motivo da recusa no lugar do resultado — o
agente aprende que aquele caminho está fechado e tenta outro. Negar não bloqueia
a task: é decisão do usuário, e o mesmo princípio do `pr_settled` com
`opened: false` vale aqui (não conta para o circuit breaker).

### Teto de espera

Espera sem fim é sessão imortal por outro nome. O agente espera até o teto de
inatividade da task; estourado, bloqueia com `origin: política` — a task parou
porque ninguém decidiu, e isso é diferente de defeito de código ou de modelo.

## Consequências

**A favor**

- O agente para de queimar iterações no que não pode executar, e as aprovações
  do usuário passam a valer independentemente de quando chegam.
- A allowlist deixa de ser a única defesa e volta ao papel para o qual foi
  desenhada: dispensar aprovação do que é rotina, não viabilizar o agente.
- O usuário passa a ver `dev.awaiting_approval` no fio e sabe que o agente está
  esperando **ele**, em vez de ver uma task bloqueada por "limite de iterações".

**Contra**

- Um agente esperando ocupa o worktree e não pega a próxima task. É o mesmo
  custo já aceito em `awaiting_gate`, e pelo mesmo motivo: o worktree é por
  AGENTE, não por task.
- O `ctx` em memória significa que restart durante a espera perde o turno. Fica
  no caminho de bloqueio com diagnóstico que já existe; persistir histórico de
  mensagens é problema à parte, não deste ADR.

## Alternativas consideradas

**Aumentar `max_iterations`.** Só adia: com aprovação pendente, toda iteração é
desperdiçada, então qualquer teto é atingido.

**Auto-aprovar `terminal` por `agent_autonomy`.** Liberaria QUALQUER comando
dentro do container do engine, e é exatamente o que
`dev-terminal-patterns.ts:11-15` recusa — com o arquivo, `deny` continua
vencendo `allow` e os `BUILTIN_DENY_PATTERNS` seguem ativos.

**Polling no hook.** Trava o GenServer, como explicado acima.

## Referências

- [ADR 0045](0045-reagendamento-por-evento-do-dev-agent.md) — a máquina de
  estados e o reagendamento por evento que este ADR estende
- [RN-047](../business-rules.md#rn-047) — circuit breaker do dev agent
- Execução real: projeto `saudacao-local`, task `cd652d85`, 2026-08-05
