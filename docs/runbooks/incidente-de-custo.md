# Runbook — orçamento de LLM estourando em produção

Os agentes gastam token a cada turno, e um agente em laço gasta rápido. Este
runbook é para o momento em que o custo por hora dispara e alguém precisa
decidir o que cortar.

## Sinal

O alerta *Custo por hora acima do limite* dispara com gasto projetado acima de
USD 5/hora em qualquer projeto:

```promql
max(sum by (project) (rate(brabo_llm_cost_micros_total[10m])) * 3600 / 1000000)
```

O alerta é **aviso**, não freio. O freio de verdade é o `budgets` do domínio, e
ele age por projeto/sessão, não globalmente.

## 1. Qual projeto, qual agente

Grafana → dashboard **Brabo · visão executiva** → painel de custo por projeto.
Ou direto no banco, que dá também o agente e o modelo:

```sql
select s.project_id,
       tu.actor_id                             as agente,
       tu.model_name,
       count(*)                                as chamadas,
       sum(tu.cost_micros) / 1e6               as usd,
       round(avg(tu.latency_ms))               as latencia_media_ms
  from token_usage tu
  join sessions s on s.id = tu.session_id
 where tu.created_at > now() - interval '1 hour'
 group by 1, 2, 3
 order by usd desc
 limit 20;
```

Duas leituras mudam a ação:

- **Um agente dominando a lista** com muitas chamadas curtas é laço: o ToolLoop
  repetindo a mesma ferramenta sem convergir.
- **Poucas chamadas e custo alto** é modelo caro num trabalho barato — binding
  errado, não laço.

## 2. Ver o orçamento

```sql
select b.project_id, b.session_id,
       b.limit_micros / 1e6  as limite_usd,
       b.spent_micros / 1e6  as gasto_usd,
       round(100.0 * b.spent_micros / nullif(b.limit_micros, 0)) as pct,
       b.policy
  from budgets b
 order by pct desc nulls last;
```

`policy` decide o comportamento no teto:

- **`block`** — a chamada é recusada. É o default e o que se quer em produção.
- **`allow`** — o teto vira apenas registro; o gasto continua. Um projeto em
  `allow` gastando muito **não vai parar sozinho**. Confira isto antes de
  qualquer outra coisa: é a causa mais comum de "o orçamento não segurou".

## 3. Cortar o gasto

Em ordem de reversibilidade, do mais brando ao mais drástico.

**a) Tirar os agentes da autonomia automática.** Eles param de agir sozinhos e
voltam a exigir aprovação por ação, sem perder contexto:

```sql
update agent_autonomy set mode = 'manual' where project_id = '<projeto>';
```

**b) Trocar o binding de modelo para um local.** Ollama custa zero; a qualidade
cai, o gasto para na hora:

```sql
-- veja o binding em vigor e o escopo que o resolve
select scope, scope_id, model_id from model_bindings where scope_id = '<projeto>';
```

Depois aponte o binding do projeto para um modelo `local` pela tela de
configuração (o escopo mais específico vence: sessão > agente > projeto >
workspace).

**c) Baixar o teto e garantir `block`.** Faz o próprio domínio recusar as
próximas chamadas:

```sql
update budgets
   set policy = 'block',
       limit_micros = least(limit_micros, spent_micros + 1000000)  -- +1 USD
 where project_id = '<projeto>';
```

**d) Encerrar as sessões do projeto.** Último recurso: interrompe o trabalho em
andamento. Use a transição normal (`closing`), nunca `kill` no pod — matar o
pod não fecha sessão, só cria órfã (ver
[rollout-engine.md](rollout-engine.md)).

## 4. Depois

- **O Psicólogo já tem a evidência.** Se a causa foi laço de agente, a análise
  dele aponta o agente-alvo e a Anamnese pode propor um patch de instrução.
  Corrigir a instrução é o que impede a repetição; mexer no orçamento só
  compra tempo.
- **Confira se o alerta chegou.** As regras são do Grafana, não do Prometheus
  (desvio registrado no ADR 0026): se o Grafana estava fora do ar, não houve
  aviso, e o silêncio não significou saúde.

## O que este runbook não resolve

O custo já incorrido. O metering é registro, não estorno: `token_usage` conta o
que foi gasto, e nada aqui devolve dinheiro ao provedor. A única prevenção real
é `policy = 'block'` com teto sensato **antes** do incidente.
