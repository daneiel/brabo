# 0092 — `platform` nasce como script de relatório sob demanda, não agente

## Status

Aceito. Não muda o `status: planned` nem o `gate_saida` do papel `platform`
em `docs/fluxo.yml` (ADR 0085) — a ativação dele continua sincronizada com
`DEPLOY_ENABLED`, que não existe. Este documento entrega só a metade que já
tem dado real por trás.

## Contexto

`docs/fluxo.yml` (`camada_plataforma`) descreve `platform` como "SRE /
Platform — dono do loop de retorno": ele receberia `pipeline-verde` da
área de Infra e `nfrs-mensuraveis` do Arquiteto, e devolveria
`slo + dashboard + runbook`, `telemetria-consolidada` e `postmortem`. O
`status` é `planned` e a `ativacao` está escrita como "sincronizada com
`DEPLOY_ENABLED`" — uma flag que não existe no produto hoje. Não há ambiente
de produção com tráfego real, não há SLO numérico definido em lugar nenhum,
e não há incidente real para postmortem nenhum analisar.

O dono do produto decidiu, conscientemente, antecipar parte deste papel —
não como agente LLM nem como processo supervisionado (`GenServer`), que
inventariam autoridade sobre um loop que ainda não fecha, mas como o que já
é possível honestamente: um SCRIPT de leitura, no mesmo molde de
`apps/api/scripts/medir-execucao.ts` (FASE 13b) e
`apps/api/scripts/validacao-gates.ts` (FASE 15).

O dado já existe. `DomainGaugesCollector`
(`apps/api/src/infrastructure/observability/domain-gauges.collector.ts`)
roda a cada `METRICS_GAUGE_INTERVAL_MS` e mantém três gauges Prometheus:
sessões ativas/closing por projeto, tasks bloqueadas por projeto, e o estado
do último backup (`backup_runs` — idade, status, tamanho, sempre GLOBAL,
porque o produto faz backup do banco inteiro, não por projeto). O que faltava
não era a métrica: era uma forma de olhar esse retrato AGORA, para um projeto
específico, sem abrir o Grafana.

## Decisão

**`apps/api/scripts/relatorio-telemetria.ts`**, invocado por
`pnpm --filter api relatorio:telemetria [--projeto <uuid>] [--json]`. Ele
faz as MESMAS três perguntas do `DomainGaugesCollector` — mas como leitura
pontual, avulsa, disparada por quem pede, e termina depois de imprimir. Não
é um segundo coletor: não registra gauge nenhum, não roda em `setInterval`.

**As consultas SQL são replicadas, não importadas.** Os métodos do coletor
(`collectSessions`/`collectBlockedTasks`/`collectBackup`) são privados e
terminam escrevendo em `this.metrics.*.set(...)` — não existe uma metade
pura de "só a query" para extrair sem acoplar um script avulso ao ciclo de
vida de um `@Injectable` do NestJS que só faz sentido dentro do módulo.
Replicar uma consulta de LEITURA (mesmas tabelas, mesmos filtros) é mais
barato do que abrir essa dependência.

**O relatório nunca inventa o que não tem.** Duas seções fixas em toda
saída:

- **"Onde ver mais"** — links para o que já existe, versionado: os três
  dashboards em `deploy/k8s/observability/dashboards/*.json`, os alertas em
  `deploy/k8s/observability/alerts/brabo-alerts.yaml`,
  `docs/runbook.md#observabilidade`, e `pnpm dev:obs` para subir a
  observabilidade local. O script LINKA, nunca duplica o conteúdo desses
  arquivos.
- **"Não medido"** — três lacunas nomeadas: SLO numérico formal (nenhum
  está definido em lugar nenhum do produto — inventar um aqui seria o
  mesmo erro que o ADR 0042 já recusa para nota de modelo e o ADR 0077
  recusa para qualidade de código); postmortem (depende de incidente
  real); telemetria de volta ao produto em LOOP FECHADO (este script
  observa e imprime — não decide nem age sozinho; é isso que tornaria
  `platform` `active`, e o gatilho continua ausente).

**`docs/fluxo.yml` ganha uma nota, não um status novo.** O `status: planned`
do papel `platform` NÃO muda, e o `gate_saida: { id: operavel, status:
planned }` também não. A saída `telemetria-consolidada` ganha um campo
`nota` dizendo que a versão MANUAL/sob-demanda já é real (este script) e a
versão AUTOMÁTICA/loop-fechado segue pendente de `DEPLOY_ENABLED` — a
mesma disciplina que o ADR 0077 já aplicou para "recomendado" vs. "nota
inventada": o que existe é dito como existe, e o que não existe continua
dito como não existe.

## Consequências

**O que passa a existir.** Uma forma de responder "como está este projeto
agora" (sessões, tasks bloqueadas, backup) sem abrir o Grafana e sem
esperar o próximo scrape — útil justamente porque `DomainGaugesCollector`
já publica esse dado para o Prometheus, mas ninguém lia isso pontualmente
antes.

**O que continua exatamente como estava.** `platform` continua `planned`.
Nenhum agente novo, nenhum `GenServer`, nenhum SLO numérico, nenhum
postmortem simulado. O script não decide nada e não age — ele só imprime o
que já está no banco.

**A duplicação de consulta é uma escolha, não um descuido.** As mesmas
tabelas (`sessions`, `tasks`/`stories`, `backup_runs`) são lidas duas vezes
por dois caminhos diferentes — o coletor periódico e este script sob
demanda —, e as duas consultas podem divergir com o tempo se uma mudar sem
a outra acompanhar. O custo aceito é menor do que o de acoplar um script de
CLI ao ciclo de vida de um `@Injectable` do NestJS só para reusar código
privado.

## Referências

- [ADR 0085](0085-fluxo-como-registro-declarativo.md) — declara o papel
  `platform` como `planned`; este documento não o promove.
- [ADR 0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md),
  [ADR 0077](0077-ranking-de-modelos-por-capacidade-sem-nota-inventada.md) —
  a mesma disciplina de nunca inventar número/nota sem dado real.
- [RN-385](../business-rules.md#rn-385), [RN-386](../business-rules.md#rn-386).
- `apps/api/scripts/relatorio-telemetria.ts`,
  `apps/api/src/infrastructure/observability/domain-gauges.collector.ts`,
  `docs/fluxo.yml` (`camada_plataforma › platform`).
