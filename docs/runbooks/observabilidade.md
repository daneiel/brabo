# Runbook — observabilidade

Como seguir uma sessão, achar custo e diagnosticar quando não há dado.
Decisões em [ADR 0026](../adr/0026-fase5-observabilidade-e-graceful-shutdown.md).

## Onde está o quê

| ferramenta | endereço local | serve para |
|---|---|---|
| Grafana | <http://localhost:3001> | dashboards, traces, logs, alertas |
| Prometheus | `kubectl -n monitoring port-forward svc/prometheus-server 9090:80` | conferir target e série crua |
| Tempo | datasource do Grafana | traces |
| Loki | datasource do Grafana | logs |

Dois dashboards na pasta **Brabo**: *visão executiva* (custo/hora e tokens/min
por projeto, sessões ativas, decisões de ação) e *visão operacional* (fila do
Oban por estado, latência p50/p95 de LLM por provider, tasks bloqueadas, sessões
por réplica).

## Seguir uma sessão da raiz até um tool call

1. Pegue o `trace_id` da sessão. Ele é o campo do meio do `traceparent`
   persistido em `sessions.trace_parent`:

   ```bash
   # 00-<trace_id>-<span_id>-01
   curl -sS -H "Authorization: Bearer $TOKEN" \
     http://localhost:3000/projects/$PROJ/sessions/$SESS | jq -r .traceParent
   ```

2. No Grafana → **Explore** → datasource **Tempo** → aba **TraceQL**, cole o
   `trace_id`. A árvore vem com `session.create` (api) na raiz e, abaixo,
   `agent.turn` → `tool.call` / `llm.turn` / `gate.scanner` (engine).

3. Estando num span, o botão **Logs for this span** salta para as linhas do Loki
   com aquele `trace_id`. O caminho inverso — de uma linha de log para a trace —
   é o link **TraceID** que aparece no detalhe da linha.

4. Custo daquela sessão: o dashboard *visão executiva* filtra por projeto. Para
   um valor exato por sessão, a fonte é o banco (`token_usage.cost_micros`), não
   a métrica — a métrica é agregada por projeto e provider de propósito, para
   não criar uma série por sessão.

## Quando não há trace nenhuma

Na ordem, do mais provável ao menos:

**1. A variável não está definida.** Sem `OTEL_EXPORTER_OTLP_ENDPOINT` a
instrumentação é desligada de propósito, nos dois serviços.

```bash
kubectl -n brabo exec deploy/api -- printenv OTEL_EXPORTER_OTLP_ENDPOINT
kubectl -n brabo exec deploy/engine -- printenv OTEL_EXPORTER_OTLP_ENDPOINT
```

**2. A NetworkPolicy está bloqueando.** É a falha mais silenciosa de todas: os
spans são criados, o envio falha, e todo o resto fica verde.

```bash
kubectl -n brabo get networkpolicy allow-otlp-egress
kubectl -n brabo logs -l app.kubernetes.io/name=engine --tail=50 | grep -i "error exporting"
```

**3. Protocolo errado.** O exporter do Elixir fala **HTTP/protobuf (4318)**, não
gRPC. Apontá-lo para 4317 dá `socket_closed_remotely` a cada batch — foi
exatamente o erro cometido e corrigido nesta sessão.

**4. O Collector não está recebendo.**

```bash
kubectl -n monitoring logs deploy/otel-collector-opentelemetry-collector --tail=30
```

## Quando um painel está vazio

Quase sempre é **nome de métrica**. Os nomes são referenciados por string em
três lugares que não se enxergam: os dashboards, as regras de alerta e este
runbook. Confira contra o que o serviço realmente expõe:

```bash
curl -sS http://localhost:3000/metrics | grep '^brabo_' | cut -d'{' -f1 | sort -u
kubectl -n brabo exec deploy/engine -- wget -qO- http://127.0.0.1:4000/metrics | grep -E '^(brabo|oban)_'
```

E se o serviço expõe mas o Prometheus não tem, o problema é scrape:

```bash
kubectl -n monitoring port-forward svc/prometheus-server 9090:80
# depois: http://localhost:9090/targets — os jobs são `brabo-api` e `brabo-engine`
```

## Quando não há log no Loki

O Alloy é DaemonSet e lê `/var/log/pods` do nó, filtrando pelo namespace
`brabo`.

```bash
kubectl -n monitoring logs -l app.kubernetes.io/name=alloy --tail=30 | grep -i error
```

Avisos de `tailer stopped ... pods not found` são normais depois de um rollout —
o Alloy insiste em pods que já foram removidos.

As apps **não** conseguem falar com o Loki diretamente, e isso é intencional: a
`allow-otlp-egress` libera só 4317/4318. Para consultar de fora:

```bash
kubectl -n monitoring port-forward svc/loki 3100:3100
curl -sS -G http://localhost:3100/loki/api/v1/query_range \
  --data-urlencode '{app="api"} | json | trace_id != ""' --data 'limit=5'
```

## Alertas

Três regras provisionadas, visíveis em **Alerting → Alert rules** (pasta Brabo):

| alerta | o que investigar |
|---|---|
| Fila do Oban crescendo sem consumo | nenhuma réplica do engine Ready; pool do Postgres esgotado; worker travado num job |
| Sessão presa em `closing` | `closing` é estado de passagem — o drain não completou, ou a transição para `closed` falhou |
| Custo por hora acima do limite | qual projeto e qual agente; o orçamento do domínio continua sendo o controle rígido |

São regras do **Grafana**, não do Prometheus (desvio registrado no ADR 0026):
deixam de ser avaliadas se o Grafana cair. Não há Alertmanager nem destino de
notificação configurado.

## Limites conhecidos

- Nenhuma trace de agente **real** foi observada ponta a ponta: verificar isso
  exige LLM configurado (Ollama ou chave de API). O mecanismo foi validado
  emitindo spans na trace da sessão diretamente.
- A web não exporta spans próprios — ela **gera** o `traceparent` e o manda no
  header, e a api o adota como parent. Os logs do browser saem no console, não
  no Loki.
- Retenção curta: Tempo 24h, Loki 24h, Prometheus 2h. É ambiente local.
