# ADR 0057 — O agente de gate espera a aprovação, como o dev espera

- **Status:** aceito
- **Data:** 2026-08-07
- **Contexto:** FASE 13b, achado AB
- **Estende:** [ADR 0052](0052-dev-agent-espera-aprovacao-no-meio-do-laco.md)

## Contexto

O [ADR 0052](0052-dev-agent-espera-aprovacao-no-meio-do-laco.md) resolveu, para
o **dev agent**, o problema de uma ferramenta que precisa de aprovação no meio
do laço: o agente SUSPENDE retendo o histórico, e a decisão o retoma com o
resultado de verdade no lugar onde estaria a palavra `pending`.

Os agentes de **gate** ficaram de fora daquela correção, e ninguém percebeu
porque nenhuma execução chegava até eles. A FASE 13b chegou.

Na 6ª execução real, o `qa-automacao` rodou:

```
ls -la && find . -name "AGENTS.md" -o -name "package.json" | head -50
```

Comando composto com um segmento fora do `allow` — corretamente recusado, e
corretamente suspenso pelo `ToolLoop`. O que aconteceu em seguida é o defeito:
o `QaLeadServer` não tinha cláusula para esse desfecho, caía no catch-all, e
registrava:

```
delegation.failed  failureOrigin: "infra"
"QA de Automação não concluiu o parecer — desfecho inesperado do ToolLoop"
```

Duas coisas erradas de uma vez:

1. **a task era bloqueada** por uma decisão que ninguém tinha tomado;
2. **a origem era mentira.** Nada de infraestrutura falhou. Isso contraria a
   regra que o [ADR 0020](0020-destravar-gates-qa-secops.md) fixou: origem é
   NOMEADA, nunca obtida por eliminação.

## Decisão

**Os agentes de gate suspendem e retomam, exatamente como o dev agent.**

O subagente ganha um terceiro desfecho, ao lado de `{:ok, parecer}` e
`{:blocked, info}`:

```elixir
{:awaiting, %{action_id:, tool_call_id:, tool_name:, ctx:}}
```

O `ctx` inteiro viaja junto — é ele que torna a retomada possível, e é a mesma
escolha do ADR 0052.

O **Lead** passa a ser quem espera. Ele já era um `GenServer` por projeto, então
ganhou três coisas:

- assina o `Engine.Dev.Wake` pelos **subagentes** (`qa-automacao`,
  `qa-performance-seguranca`), porque `task.action_settled` chega chaveado pelo
  ator que PROPÔS a ação, e quem propõe é a subespecialidade;
- guarda o estado em voo (`pendente`) — a delegação suspensa, o que já foi
  colhido, o que falta rodar;
- em `{:action_settled, ...}` com o `action_id` que ele espera, retoma aquele
  subagente e **continua a área do ponto em que parou**.

### O que mudou de forma, e por quê

`rodar_ativas` era um `Enum.map` sobre as delegações ativas: uma linha reta que
não tinha como parar no meio. Virou `continuar_area/4`, recursiva sobre a lista
de restantes, com os colhidos acumulados. É essa forma que permite suspender
entre duas delegações sem perder a primeira.

## Consequências

**A aprovação deixa de matar o gate.** Enquanto pendente, a área não consolida,
não emite veredito e não bloqueia task — ela espera. O clique do usuário
destrava, em vez de chegar tarde demais.

**Recusa também retoma.** O motivo entra no lugar do resultado e o agente
aprende que aquele caminho fechou, em vez de esperar para sempre. Mesma regra do
ADR 0052.

**A origem `infra` deixa de ser usada para decisão pendente.** O que sobra no
catch-all é desfecho genuinamente inesperado.

### O que isto NÃO resolve

Não elimina a aprovação, e não deveria. O allowlist continua sendo lista fechada
e o agente continua inventando comandos — os achados **X**, **Z** e **AD** da
FASE 13b seguem abertos. O que muda é a consequência: o que antes era uma parede
vira uma fila de decisão.

**Restart no meio da espera perde o laço.** O `pendente` vive na memória do
`QaLeadServer`, que é `restart: :temporary`. O dev agent resolveu isso
persistindo status em `dev_agent_states`; o gate não tem tabela equivalente, e
criá-la é escopo próprio. Fica declarado como limite conhecido — o gate roda de
novo pelo `Dispatcher` quando a task voltar ao ciclo.

## Alternativas consideradas

**Deixar o gate rodar com autonomia total**, sem passar pelo pipeline de
aprovação. Recusada: o gate roda comandos no worktree do dev, e a fronteira
existe justamente porque ele é código de terceiro sendo executado. Trocar a
parede por um buraco não é resolver.

**Só corrigir a origem** (`infra` → `politica`), sem suspender. Foi o passo
intermediário, e não bastava: o gate continuava morrendo, só que com o rótulo
certo. Honesto, e inútil.
