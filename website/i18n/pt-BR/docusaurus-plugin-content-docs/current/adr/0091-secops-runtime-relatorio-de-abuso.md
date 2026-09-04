# ADR 0091 — `secops-runtime` como script de relatório sobre `rate_limit_hits`

- **Status:** Aceito
- **Data:** 2026-08-16
- **Contexto:** antecipação decidida do papel `secops-runtime`
  (`docs/fluxo.yml`, `camada_seguranca`)

## Contexto

`docs/fluxo.yml` (ADR 0085) declara `secops-runtime` como papel `proposto`
da camada de segurança, com `papel_de_mercado: detecção e resposta` e
`criterio_de_separacao: produção com tráfego real (pós DEPLOY_ENABLED +
platform ativo)`. Esse gatilho é real: detecção automática de incidente,
resposta a incidente e postmortem de segurança exigem tráfego de produção
contínuo para terem sentido — um alarme calibrado contra zero tráfego real
dispara em ruído ou nunca dispara, e um postmortem sem incidente é ficção.

O dono do produto decidiu antecipar parte do papel mesmo sem o gatilho ter
disparado: o RateLimitGuard (ADR 0027) já grava uma linha por request
contado em `rate_limit_hits`
(`apps/api/src/interfaces/http/shared/rate-limit.guard.ts`), inclusive sob
tráfego de dev/CI — dado real, coletado hoje, e sem relatório nenhum sobre
ele. `apps/api/scripts/medir-execucao.ts` (FASE 13b) já estabeleceu o
padrão para este tipo de instrumento: `NestFactory.createApplicationContext`,
leitura pura via Drizzle, funções extraídas e testadas sem subir o Nest.

## Decisão

`secops-runtime` entra como **script** — `pnpm --filter api
relatorio:seguranca-runtime` —, não como agente LLM nem `GenServer`. Não há
decisão a tomar sobre o dado, só agregação: ranking de baldes (`bucket_key`
= `user:<uuid>` ou `ip:<endereço>`, os dois únicos formatos que
`RateLimitGuard` grava) por volume de hits, e distribuição temporal em
fatias fixas para revelar picos de tentativa.

O que o script explicitamente **não faz**, e por quê:

- **Detecção automática de incidente** — exigiria um threshold calibrado
  contra tráfego real; calibrar contra tráfego de dev/CI produziria um
  número sem relação com abuso de produção.
- **Resposta a incidente** — não há incidente real para responder.
- **Postmortem de segurança** — não há incidente real para investigar.

As três dependem do MESMO gatilho que `docs/fluxo.yml` já declarava
(produção com tráfego real, pós `DEPLOY_ENABLED` + `platform` ativo) e
seguem fora do escopo. O relatório as lista numa seção "não medido" —
nunca simula um incidente de exemplo, nunca inventa um número de detecção
— mesmo princípio que os ADRs 0041/0042/0077 já aplicam a outras
capacidades que o produto ainda não tem: declarar a lacuna, não fingi-la.

A janela de dado é curta e o relatório diz isso: `DomainGaugesCollector.
pruneRateLimit` apaga hits mais velhos que `2 × RATE_LIMIT_WINDOW_MS`
(240s por padrão), a cada `METRICS_GAUGE_INTERVAL_MS` (15s por padrão). O
relatório imprime a janela CONFIGURADA (o teto teórico da poda) e a janela
OBSERVADA (o que os dados efetivamente cobrem), e nunca deixa a segunda
passar por um histórico maior do que realmente é — se as duas coincidem, é
sinal de que hits mais antigos foram podados, não de que não existiram.

`docs/fluxo.yml` muda de `status: proposto` para `status: active` no bloco
`secops-runtime`, com `entregaveis` substituindo `entregaveis_alvo`: o item
`deteccao` vira real (`via: script`), e `resposta-a-incidente`/
`postmortem-de-seguranca` permanecem como `status: lacuna` — o campo não
desaparece, ele passa a apontar exatamente para o que falta.

## Consequências

- Ganho real: um comando (`pnpm --filter api relatorio:seguranca-runtime`)
  que hoje já mostra quem está batendo mais no rate limit e quando, sem
  esperar por produção — útil mesmo em dev/CI para notar padrão de teste
  malformado ou de abuso local.
- O relatório é tão bom quanto o dado que `rate_limit_hits` guarda: sem
  rota, método ou motivo do bloqueio, o ranking não distingue "um cliente
  martelando `/auth/login`" de "um cliente martelando qualquer rota". Uma
  coluna de rota exigiria mudar o que `RateLimitGuard` grava — fora do
  escopo desta fatia, que só lê o que já existe.
- A janela de retenção (minutos, não dias) limita o valor do ranking para
  incidentes que já passaram: rodar o script HOJE só enxerga o que
  aconteceu nos últimos `2 × RATE_LIMIT_WINDOW_MS`. Ampliar a retenção
  seria decisão de produto própria (custo de armazenamento crescente numa
  tabela sem chave estrangeira, ADR 0027) e não foi tomada aqui.
- `secops-runtime` continua sem detecção automática, resposta a incidente
  e postmortem — a promessa completa do papel de mercado ainda depende do
  gatilho original (`DEPLOY_ENABLED` + `platform` ativo). Nada nesta
  decisão antecipa esse dia; ela só evita deixar `rate_limit_hits` sem
  nenhum consumidor até lá.
