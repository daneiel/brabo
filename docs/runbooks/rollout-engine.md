# Runbook — rollout do engine sem deixar sessão órfã

Decisões em [ADR 0026](../adr/0026-fase5-observabilidade-e-graceful-shutdown.md).

O engine hospeda os processos de sessão. Derrubar uma réplica sem cuidado
deixava, antes da Fase 5, **toda** sessão daquele pod pendurada em `active` sem
processo nenhum — nunca mais avançava e nunca fechava. Este runbook é como
fazer o rollout e o que olhar quando algo escapa.

## O que acontece num rollout, em ordem

| fase | quanto | o que ocorre |
|---|---|---|
| `preStop` | até 45 s (`SHUTDOWN_DRAIN_TIMEOUT_MS`) | `Engine.Shutdown.drain/1`: `/ready` passa a 503, `/internal/sessions` recusa sessão nova, e cada sessão deste nó é oferecida a um par vivo |
| handoff por sessão | 5 s (`@handoff_timeout_ms`) | `:erpc.call` para outro nó assumir o processo |
| não adotadas | — | viram `closing` com causa `node_shutdown` e depois `closed_abnormally` |
| SIGTERM | resto dos 90 s (`terminationGracePeriodSeconds`) | a árvore de supervisão desce |

Os 90 s são deliberados: 45 s de drain + folga para o teardown do BEAM. Baixar
`terminationGracePeriodSeconds` sem baixar o timeout do drain faz o kubelet
matar o pod **no meio** do handoff — que é a forma de recriar exatamente o bug
que o drain existe para evitar.

## Fazer o rollout

```bash
kubectl -n brabo rollout restart deployment/engine
kubectl -n brabo rollout status  deployment/engine --timeout=300s
```

Com uma réplica só, não há par para adotar: **toda** sessão ativa vai terminar
como `closed_abnormally / node_shutdown`. Isso é correto, não é falha — mas se
o objetivo era não interromper ninguém, escale para 2 antes:

```bash
kubectl -n brabo scale deployment/engine --replicas=2
```

## Provar que não sobrou órfã

```bash
make rollout-test
```

Abre 5 sessões ativas, faz o rollout e exige que **cada uma** esteja num de dois
estados: `active` com dono `:global` vivo (adotada), ou `closed_abnormally` com
`node_shutdown` (drenada). Qualquer outra combinação reprova — em especial
`active` sem dono, que é a definição operacional de órfã.

Manualmente, a mesma pergunta:

```sql
-- sessões ativas segundo a api
select id, status, updated_at from sessions where status = 'active';
```

```bash
# donos vivos segundo o engine
kubectl -n brabo exec deploy/engine -- \
  /app/bin/engine rpc ':global.registered_names() |> Enum.filter(&match?({:brabo_session, _}, &1)) |> length()'
```

Ativa na api sem dono no engine = órfã.

## Quando algo escapa

**Sessão presa em `closing`.** `closing` é estado de passagem; parado ali
significa que o drain começou e não completou. O alerta *Sessão presa em
closing* dispara em 15 min. Investigue o log do pod que estava saindo — se ele
já sumiu, o `Adopter` (varredura a cada 30 s) deveria ter reassumido; se não
reassumiu, veja se a linha ainda existe em `engine.session_states`.

**Órfã depois de `kill -9` / OOMKill.** O `preStop` não roda nesses casos, por
definição. Quem cobre é o `SessionAdoptionWorker`, que a cada 30 s procura
linha em `session_states` sem dono `:global` e reassume. Se ele não está
rodando, a fila do Oban está parada — e aí o problema é outro (ver o alerta de
fila sem consumo).

**Rollout que trava em `preStop`.** Sintoma: pod em `Terminating` por 90 s
exatos, sempre. Quase certamente um `:erpc.call` esperando um nó que já morreu
mas ainda está em `Node.list()`. O timeout de 5 s por sessão limita o estrago;
90 s cheios significam ~18 sessões em sequência ou um handoff que não retorna.

**Nada é adotado, mesmo com 2 réplicas.** Os nós não estão se enxergando.
Confira o cluster Erlang:

```bash
kubectl -n brabo exec deploy/engine -- /app/bin/engine rpc 'Node.list()'
```

Lista vazia = o DNSCluster não resolveu o Service headless, ou a NetworkPolicy
está bloqueando a faixa de distribuição (9100–9110). Sem cluster, cada réplica
é uma ilha e todo rollout drena tudo.

## Aumentar a janela de drain

Se as sessões forem longas e o drain de 45 s não bastar, os dois valores sobem
**juntos** — e nesta ordem de raciocínio: escolha o drain, depois dê folga:

```yaml
# deploy/k8s/base/engine/deployment.yaml
terminationGracePeriodSeconds: 150   # drain + ~30s de teardown
# env SHUTDOWN_DRAIN_TIMEOUT_MS: "120000"
```

Mexer só no `terminationGracePeriodSeconds` não alonga o drain; mexer só no
drain faz o kubelet matar no meio.
