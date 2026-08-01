-- =====================================================================
-- Kit de colheita da Fase 10c — as queries que produzem o relatório
--
-- Uso:
--   docker exec -i brabo-postgres-1 psql -U brabo -d brabo \
--     -f - < docs/missions/colheita-queries.sql
--
-- Cada bloco diz qual parte de `colheita-esqueleto.md` ele preenche. O
-- esqueleto referencia estas queries pelo nome no comentário `-- [nome]`.
--
-- PRÉ-REQUISITO: `pnpm --filter api db:migrate`. As queries de custo usam
-- `input_price_per_million_micros`, `output_price_per_million_micros` e
-- `upstream_provider`, que só existem a partir das migrações da Fase 9.
--
-- CONVENÇÃO: todas as queries são de LEITURA. Nenhuma escreve, nenhuma
-- apaga. Rodar duas vezes dá o mesmo resultado.
-- =====================================================================


-- ---------------------------------------------------------------------
-- [cliques-por-sessao] → esqueleto §2, coluna "cliques de aprovação"
--
-- ATENÇÃO — esta é a métrica principal da fase, e as duas formas óbvias
-- de contá-la estão erradas:
--
--   1. NÃO conte por `status`: ação aprovada que executa vira `executed`,
--      não fica em `approved`. Contar `status = 'approved'` perde quase
--      tudo.
--   2. NÃO conte `status = 'denied'` como negativa humana: parte vem de
--      `resolved_policy = 'deny'`, ou seja, a política barrou e o pedido
--      NUNCA chegou a um humano.
--
-- O que separa clique de não-clique é `decided_at`: ele só é preenchido
-- quando uma pessoa decidiu. Ver o achado #17 da missão — estes eventos
-- NÃO estão em `session_events`, só no outbox e nesta tabela.
-- ---------------------------------------------------------------------
\echo '=== [cliques-por-sessao] ==='
SELECT
  a.session_id,
  count(*) FILTER (WHERE a.decided_at IS NOT NULL AND a.status <> 'denied') AS aprovou,
  count(*) FILTER (WHERE a.decided_at IS NOT NULL AND a.status  = 'denied') AS negou,
  count(*) FILTER (WHERE a.decided_at IS NOT NULL)                          AS cliques,
  count(*) FILTER (WHERE a.resolved_policy = 'auto_approve')                AS sem_clique,
  count(*) FILTER (WHERE a.resolved_policy = 'deny')                        AS barrado_pela_politica,
  count(*) FILTER (WHERE a.status = 'pending')                              AS ainda_pendente
FROM proposed_actions a
GROUP BY a.session_id
ORDER BY cliques DESC;


-- ---------------------------------------------------------------------
-- [cliques-por-tipo] → esqueleto §3, "onde a atenção foi gasta"
--
-- Qual tipo de ação consumiu mais decisão humana. É o que diz onde
-- afrouxar a política valeria mais a pena — e o que a fase mediu ao
-- proibir afrouxar.
-- ---------------------------------------------------------------------
\echo '=== [cliques-por-tipo] ==='
SELECT
  a.action_type,
  count(*) FILTER (WHERE a.decided_at IS NOT NULL) AS cliques,
  count(*) FILTER (WHERE a.resolved_policy = 'auto_approve') AS sem_clique,
  round(
    100.0 * count(*) FILTER (WHERE a.decided_at IS NOT NULL)
    / NULLIF(count(*), 0)
  , 1) AS pct_que_exigiu_humano
FROM proposed_actions a
GROUP BY a.action_type
ORDER BY cliques DESC;


-- ---------------------------------------------------------------------
-- [custo-por-agente] → esqueleto §4, tabela "custo por agente"
--
-- `cost_micros` é micro-USD: divida por 1e6 para dólar.
-- ---------------------------------------------------------------------
\echo '=== [custo-por-agente] ==='
SELECT
  u.actor_kind,
  u.actor_id                                   AS agente,
  count(*)                                     AS chamadas,
  sum(u.input_tokens)                          AS tokens_entrada,
  sum(u.output_tokens)                         AS tokens_saida,
  round(sum(u.cost_micros) / 1e6, 4)           AS usd,
  count(*) FILTER (WHERE u.estimated)          AS contagens_estimadas
FROM token_usage u
GROUP BY u.actor_kind, u.actor_id
ORDER BY sum(u.cost_micros) DESC;


-- ---------------------------------------------------------------------
-- [custo-por-provider-de-llm] → esqueleto §4
--
-- `upstream_provider` (Fase 9b) distingue quem SERVIU de quem recebeu:
-- num hub, o provider de entrada não é o provedor real. NULL = não
-- passou por hub.
-- ---------------------------------------------------------------------
\echo '=== [custo-por-provider-de-llm] ==='
SELECT
  u.provider                                 AS provider_de_entrada,
  coalesce(u.upstream_provider, '(sem hub)') AS provedor_real,
  u.model_name,
  count(*)                                   AS chamadas,
  round(sum(u.cost_micros) / 1e6, 4)         AS usd
FROM token_usage u
GROUP BY u.provider, u.upstream_provider, u.model_name
ORDER BY sum(u.cost_micros) DESC;


-- ---------------------------------------------------------------------
-- [custo-reproduzivel] → esqueleto §4, nota de confiabilidade
--
-- RN-044: cada linha grava o preço que produziu o custo, então
-- `tokens × preço gravado` tem que fechar com `cost_micros` mesmo depois
-- de o preço do modelo mudar. Esta query procura linhas que NÃO fecham.
--
-- Dois casos MUITO diferentes, que a query separa de propósito:
--
--   `sem_preco_gravado` — linha anterior às migrações da Fase 9. A
--     migração preencheu preço 0/0 nas linhas existentes, porque o dado
--     não existia. NÃO é defeito: é história. Some sozinho conforme a
--     fase gera linhas novas.
--
--   `nao_fecha` — preço gravado que NÃO reproduz o custo gravado. Este
--     sim é achado sobre o metering, e contradiz a RN-044.
--
-- Resultado esperado na colheita: zero em `nao_fecha`.
-- ---------------------------------------------------------------------
\echo '=== [custo-reproduzivel] (esperado: nenhuma linha `nao_fecha`) ==='
SELECT
  CASE
    WHEN u.input_price_per_million_micros = 0
     AND u.output_price_per_million_micros = 0 THEN 'sem_preco_gravado (pré-Fase 9)'
    ELSE 'nao_fecha'
  END AS caso,
  count(*)          AS linhas,
  min(u.created_at) AS mais_antiga,
  max(u.created_at) AS mais_nova
FROM token_usage u
WHERE u.input_price_per_million_micros IS NOT NULL
  AND u.output_price_per_million_micros IS NOT NULL
  AND abs(
        u.cost_micros - round(
          (u.input_tokens::numeric  * u.input_price_per_million_micros
         + u.output_tokens::numeric * u.output_price_per_million_micros) / 1e6
        )
      ) > 1
GROUP BY 1
ORDER BY linhas DESC;


-- ---------------------------------------------------------------------
-- [voltas-de-gate] → esqueleto §5, "voltas de gate"
--
-- `gate_correction_count` conta as devoluções; o teto é
-- `DEFAULT_MAX_GATE_CORRECTIONS = 3`, configurável na ativação. Task com
-- `blocked = true` e origem preenchida esgotou o ciclo K.
-- ---------------------------------------------------------------------
\echo '=== [voltas-de-gate] ==='
SELECT
  t.id                     AS task_id,
  t.title,
  t.status,
  t.gate_status,
  t.gate_correction_count  AS voltas,
  t.blocked,
  t.blocked_origin         AS origem_do_bloqueio,
  t.blocked_reason
FROM tasks t
WHERE t.gate_correction_count > 0 OR t.blocked
ORDER BY t.gate_correction_count DESC, t.updated_at DESC;


-- ---------------------------------------------------------------------
-- [delegacoes-e-dispensas] → esqueleto §5, "a área de QA funcionou?"
--
-- `dispensed` NUNCA é silêncio: carrega `justification`. Se a coluna de
-- dispensas vier cheia e a de `completed` vazia na subespecialidade de
-- Performance/Segurança, a causa provável é a story não ter RNF com uma
-- das palavras-chave que o QA Lead reconhece (ver missão, 3.2).
-- ---------------------------------------------------------------------
\echo '=== [delegacoes-e-dispensas] ==='
SELECT
  d.area,
  d.lead_agent,
  d.subagent,
  d.status,
  count(*)                                        AS quantas,
  count(*) FILTER (WHERE d.failure_origin IS NOT NULL) AS com_falha,
  -- `failure_origin` é enum: o cast para text é obrigatório no string_agg
  string_agg(DISTINCT d.failure_origin::text, ', ') AS origens_de_falha
FROM delegations d
GROUP BY d.area, d.lead_agent, d.subagent, d.status
ORDER BY d.area, d.subagent, quantas DESC;


-- ---------------------------------------------------------------------
-- [hipoteses-e-decisoes] → esqueleto §6
--
-- `status` é o ciclo compare-and-swap da RN-022: proposed → accepted |
-- dismissed. `decided_at` nulo com status `proposed` = você não decidiu
-- ainda (o que também é dado: quantas ficaram sem resposta).
-- ---------------------------------------------------------------------
\echo '=== [hipoteses-e-decisoes] ==='
SELECT
  h.agente_alvo,
  h.status,
  count(*)                             AS quantas,
  round(avg(h.confianca_percent), 1)   AS confianca_media,
  count(*) FILTER (WHERE h.termination_analysis IS NOT NULL) AS sobre_termino,
  round(avg(jsonb_array_length(coalesce(h.evidence_event_ids, '[]'::jsonb))), 1) AS evidencias_por_hipotese
FROM psychologist_hypotheses h
GROUP BY h.agente_alvo, h.status
ORDER BY h.agente_alvo, quantas DESC;


-- ---------------------------------------------------------------------
-- [hipotese-para-patch] → esqueleto §6, "o loop fechou?"
--
-- A cadeia completa: hipótese → versão de instrução → a ação que você
-- decidiu. `agent_instruction_versions` guarda os dois ponteiros
-- (`source_hypothesis_id` e `source_action_id`), então dá pra ligar cada
-- patch à hipótese que o gerou E ao seu veredito.
--
-- Linha com `patch_id` nulo = hipótese aceita que NÃO virou patch. Isso é
-- achado sobre o loop, não sobre você.
-- ---------------------------------------------------------------------
\echo '=== [hipotese-para-patch] ==='
SELECT
  h.id                AS hipotese_id,
  h.agente_alvo,
  left(h.hipotese, 60) AS hipotese,
  h.status            AS decisao_da_hipotese,
  v.id                AS patch_id,
  v.version           AS versao_gerada,
  a.action_type,
  a.status            AS decisao_do_patch,
  a.rejection_reason
FROM psychologist_hypotheses h
LEFT JOIN agent_instruction_versions v ON v.source_hypothesis_id = h.id
LEFT JOIN proposed_actions a           ON a.id = v.source_action_id
WHERE h.status = 'accepted'
ORDER BY h.decided_at NULLS LAST;


-- ---------------------------------------------------------------------
-- [linha-do-tempo-das-prs] → esqueleto §7
--
-- Cada PR aberta por agente e onde ela parou. `awaiting_user` é terminal
-- de propósito: o merge acontece no provider de git, fora do produto.
-- ---------------------------------------------------------------------
\echo '=== [linha-do-tempo-das-prs] ==='
SELECT
  a.created_at,
  a.session_id,
  a.actor_id       AS quem_abriu,
  a.status         AS status_da_acao,
  a.decided_at,
  a.payload ->> 'title'  AS titulo,
  a.payload ->> 'branch' AS branch
FROM proposed_actions a
WHERE a.action_type = 'pr_open'
ORDER BY a.created_at;


-- ---------------------------------------------------------------------
-- [a-pergunta-da-fase] → esqueleto §1
--
-- "Quanto custou, em dinheiro e em atenção humana, cada provider?"
--
-- Agrupa por MÓDULO, porque é assim que o trabalho é fatiado: o
-- `module_map` do Arquiteto deve ter um módulo por provider, e o dev
-- agent é `dev-<módulo>`. Se o Arquiteto não separou os providers em
-- módulos distintos, esta query não separa também — e isso é achado.
-- ---------------------------------------------------------------------
\echo '=== [a-pergunta-da-fase] ==='
WITH modulo_por_agente AS (
  SELECT DISTINCT
    u.actor_id,
    -- `dev-bitbucket` → `bitbucket`; `dev-generic-2` → `generic`
    regexp_replace(regexp_replace(u.actor_id, '^dev-', ''), '-\d+$', '') AS modulo
  FROM token_usage u
  WHERE u.actor_id LIKE 'dev-%'
)
SELECT
  m.modulo,
  count(DISTINCT u.session_id)                     AS sessoes,
  count(*)                                         AS chamadas_de_llm,
  round(sum(u.cost_micros) / 1e6, 4)               AS usd,
  (SELECT count(*)
     FROM proposed_actions a
    WHERE a.decided_at IS NOT NULL
      AND a.actor_id = u.actor_id)                 AS cliques_que_custou
FROM token_usage u
JOIN modulo_por_agente m ON m.actor_id = u.actor_id
GROUP BY m.modulo, u.actor_id
ORDER BY sum(u.cost_micros) DESC;


-- ---------------------------------------------------------------------
-- [conferencia-cruzada-do-outbox] → esqueleto §8, observabilidade
--
-- O outbox retém as linhas (tem `processed_at`), então serve de trilha
-- secundária para conferir a contagem de cliques. Se este número divergir
-- de [cliques-por-sessao], a divergência é achado sobre a observabilidade
-- — que é exatamente o que o achado #17 já indica.
-- ---------------------------------------------------------------------
\echo '=== [conferencia-cruzada-do-outbox] ==='
SELECT
  o.event_type,
  count(*)                                        AS eventos,
  count(*) FILTER (WHERE o.processed_at IS NULL)  AS nao_drenados
FROM outbox_events o
WHERE o.event_type LIKE 'proposed_action.%'
GROUP BY o.event_type
ORDER BY eventos DESC;
