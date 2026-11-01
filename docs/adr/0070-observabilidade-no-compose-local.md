# ADR 0070 — Observabilidade no Compose local: métrica e log, sem trace

- **Status:** aceito
- **Data:** 2026-08-14
- **Estende:** [ADR 0026](0026-fase5-observabilidade-e-graceful-shutdown.md),
  [ADR 0035](0035-observabilidade-legivel-e-trace-sem-coletor.md)

## Contexto

O ADR 0026 montou observabilidade completa — Prometheus, Loki, Tempo, Alloy,
OpenTelemetry Collector e Grafana — **só para Kubernetes**. O critério de aceite
daquela sessão dizia "no Grafana local", e "local" ali significava o cluster
k3d, não o Docker Compose.

A consequência prática: quem desenvolve com `pnpm dev` tem a instrumentação
inteira funcionando — a api expõe 102 séries em `/metrics`, o engine expõe
`oban_queue_depth` e `brabo_engine_sessions_hosted`, os três serviços carimbam
`trace_id` no log — e **nada disso é observável**. Para ver um painel era
preciso subir um cluster, que por desenho não coexiste com o `pnpm dev` (as duas
publicam nas mesmas portas, ADR 0025).

## Decisão

### 1. Um overlay opt-in, não parte do `pnpm dev`

`docker/docker-compose.observability.yml` sobe Prometheus, Loki, Alloy e
Grafana. Não entra no `pnpm dev` porque são quatro containers a mais numa
máquina que já roda Postgres, Ollama e três apps: quem não está investigando
nada não deve pagar por eles.

### 2. Métrica e log. Trace fica de fora, e isso é decisão

O ADR 0026 (decisão 9) estabeleceu que trace passa por um OpenTelemetry
Collector, e que métrica e log **não** passam — métrica é scrape, log é lido do
stdout. Este overlay implementa as duas que não precisam de coletor.

Trace exigiria Collector + Tempo, e o ADR 0035 já separou instrumentar de
exportar justamente para que a ausência de endpoint fosse o estado normal em
desenvolvimento. Por isso o overlay **não** define
`OTEL_EXPORTER_OTLP_ENDPOINT`: apontar para um endereço inexistente produziria
erro de exportação a cada turno, que é pior que não exportar.

O `trace_id` continua no log, e continua sendo o que correlaciona api e engine.

### 3. Os artefatos são os MESMOS do cluster, não uma cópia

O Compose monta `deploy/k8s/observability/dashboards/` diretamente, e os UIDs
de datasource (`brabo-prometheus`, `brabo-loki`) são idênticos aos do
`grafana-values.yaml`. Dashboard referencia datasource por UID: divergir aqui
obrigaria a mais uma cópia dos JSON, e cópia de dashboard diverge no primeiro
painel que alguém corrige de um lado só.

Pelo mesmo motivo o scrape do Prometheus emite os rótulos `app` e `pod` que os
dashboards do cluster agrupam, e o coletor de log emite o rótulo `app`
(`api`/`engine`/`web`) que o Alloy do cluster deriva de
`app.kubernetes.io/name`.

O dashboard novo desta entrega — **Brabo — logs**, com seletor de serviço e de
nível — nasce no mesmo diretório, então vale nos dois ambientes.

### 4. O parsing do log é por regex, e não por `stage.json`

No cluster o Alloy faz `stage.json`, porque em produção o pino escreve uma linha
de JSON por evento. Em desenvolvimento o `pino-pretty` desenha a árvore de
camadas legível, e o engine usa o `PrettyLogFormatter` — decisão deliberada, e
boa, que não se troca para agradar o coletor.

Então o coletor é que se adapta: limpa ANSI, extrai o nível dos dois formatos
(pino e Elixir) e normaliza a caixa. O que **não** muda são os rótulos, que são
o contrato com o dashboard.

### 5. Só as três aplicações vão para o Loki

`api`, `engine` e `web`. Postgres e Ollama são infraestrutura de terceiros com
log volumoso, e quem precisa deles tem `docker compose logs`.

O stack de observabilidade fica de fora por um motivo mais duro: ele roda no
MESMO projeto do Compose, então sem o filtro o Loki ingeriria o próprio log — e
o log dessa ingestão — num laço que se alimenta sozinho.

### 6. `trace_id` é metadado estruturado, nunca rótulo

Mesma decisão do cluster, e o motivo é cardinalidade: um rótulo por trace
explode o índice do Loki. Isso exige `allow_structured_metadata: true` e schema
`v13`, que a config padrão da imagem não traz — daí o
`docker/observability/loki.yml` próprio.

## Consequências

- Métrica e log ficam observáveis sem cluster, e o mesmo dashboard serve os dois
  ambientes.
- **O Grafana local e o do cluster disputam a porta 3001.** É a mesma
  incompatibilidade que já existe entre `pnpm dev` e `make deploy-local`, pelo
  mesmo motivo, e não se resolve mudando a porta de um dos dois — resolve-se não
  rodando os dois.
- O Alloy lê o socket do Docker. É montado somente-leitura, e é dev.
- Painel de custo/tokens nasce vazio num banco sem tráfego: aquelas métricas têm
  rótulo, e no `prom-client` uma métrica rotulada não emite série antes da
  primeira observação. Está registrado no runbook para não virar suspeita de
  painel quebrado.

## Três modos de falha silenciosa que custaram tempo e viraram comentário no código

Valem registro porque a assinatura dos três é a mesma — **configuração válida,
zero erro no log, dado errado no painel**:

1. **`stage.replace` sem grupo de captura.** Ele substitui os grupos, não o
   trecho casado. Sem parêntese a regex casa e nada acontece, e o ANSI vaza para
   o painel.
2. **Escape de `\x1b` em string do River.** O River processa escapes antes de a
   regex compilar, então quantas barras invertidas escrever vira adivinhação. A
   classe POSIX `[[:cntrl:]]` não depende dessa camada.
3. **Template do Go com chave ausente** renderiza o texto literal `<NO VALUE>`,
   que virou um valor de nível no seletor do dashboard. O `else` explícito
   (`OUTRO`) é o que fecha a cardinalidade.

## Alternativas descartadas

- **Pôr os quatro serviços no `docker-compose.yml`**: sempre ligados, custo para
  todo mundo, benefício para quem está investigando.
- **Copiar os dashboards para `docker/observability/`**: duas cópias que
  divergem no primeiro painel corrigido de um lado só.
- **Fazer o log de desenvolvimento virar JSON** para reusar o `stage.json` do
  cluster: trocaria a legibilidade do dia a dia de quem desenvolve pela
  conveniência do coletor. O coletor é que se adapta.
- **Subir Tempo e Collector junto**: escopo próprio, e o ADR 0035 já estabeleceu
  que não exportar é o estado normal em desenvolvimento.
