# Testes marcados com a tag de um binário rodam o BINÁRIO de verdade (não um
# Fake). São as regressões dos gates que já aprovaram vazio: `:gitleaks`
# (varria o histórico em vez da árvore, ADR 0020), `:hadolint`/`:yamllint`
# (o gate de QA de infra aprovava qualquer arquivo, ADR 0021), e `:actionlint`
# (o Workflows geraria pipeline de CI sem validação nenhuma, Fase 8c/ADR
# 0039 — mesma lição, um binário depois). Dentro do container do engine os
# quatro existem e os testes rodam; numa máquina sem eles são excluídos,
# mesma disciplina de detecção opcional dos detectors (ausência nunca quebra
# nada).
binary_exclusions =
  Enum.reject(
    [
      if(System.find_executable("gitleaks"), do: nil, else: :gitleaks),
      if(System.find_executable("hadolint"), do: nil, else: :hadolint),
      if(System.find_executable("yamllint"), do: nil, else: :yamllint),
      if(System.find_executable("actionlint"), do: nil, else: :actionlint)
    ],
    &is_nil/1
  )

ExUnit.start(exclude: binary_exclusions)
Ecto.Adapters.SQL.Sandbox.mode(Engine.Repo, :manual)

# outbox_events é gerenciada pela api (Drizzle, schema "public") — o banco
# de teste do engine (engine_test) é isolado do banco de teste da api
# (brabo_test), então a tabela não existe aqui. Este é um fixture de
# teste, nunca uma migration real (não vai em priv/repo/migrations).
# `sandbox: false` faz o checkout numa conexão crua (sem transação
# rollback-able), pra que o CREATE TABLE persista de verdade e fique
# visível pras conexões sandboxed que cada teste vai usar depois.
:ok = Ecto.Adapters.SQL.Sandbox.checkout(Engine.Repo, sandbox: false)

Engine.Repo.query!("""
CREATE TABLE IF NOT EXISTS public.outbox_events (
  id uuid PRIMARY KEY,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
)
""")

# `CREATE TABLE IF NOT EXISTS` não acrescenta coluna numa tabela que já existe,
# e o banco de teste do engine sobrevive entre execuções: sem este ALTER
# idempotente, quem já tinha rodado a suite antes da Fase 5 veria erro de coluna
# inexistente em vez de um fixture atualizado.
Engine.Repo.query!(
  "ALTER TABLE public.outbox_events ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'"
)

# Mesmo motivo do fixture de outbox_events acima — session_events também é
# gerenciada pela api (Drizzle, schema "public") e não existe no banco de
# teste isolado do engine. Enum actor_kind simplificado pra text (o
# PsychologistWorker só lê/escreve strings, não valida o enum).
Engine.Repo.query!("""
CREATE TABLE IF NOT EXISTS public.session_events (
  id text PRIMARY KEY,
  session_id uuid NOT NULL,
  seq integer NOT NULL,
  type text NOT NULL,
  actor_kind text NOT NULL,
  actor_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
)
""")

# Mesmo motivo dos fixtures acima — project_repositories também é
# gerenciada pela api (Drizzle, schema "public"). Enum git_provider
# simplificado pra text (Engine.Projects.ProjectRepository só lê a
# string, não valida o enum).
Engine.Repo.query!("""
CREATE TABLE IF NOT EXISTS public.project_repositories (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  provider text NOT NULL,
  external_id text NOT NULL,
  url text NOT NULL,
  default_branch text NOT NULL DEFAULT 'main',
  visibility text NOT NULL,
  provisioned_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
)
""")

# Mesmo motivo dos fixtures acima — projects e agent_instructions são
# gerenciadas pela api (Drizzle, schema "public"). O harness lê projects
# (nome/slug pra camada de contexto) e agent_instructions (arquivo de agente
# do banco pro InstructionFiles). Só as colunas que o engine lê.
Engine.Repo.query!("""
CREATE TABLE IF NOT EXISTS public.projects (
  id uuid PRIMARY KEY,
  workspace_id uuid,
  name text NOT NULL,
  slug text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
)
""")

# sessions: lida pela Anamnese (Fase 4b) — pra achar a sessão do projeto
# onde narrar a rodada, e pra filtrar a janela de eventos por projeto
# (session_events não carrega project_id). Só as colunas que o engine lê.
Engine.Repo.query!("""
CREATE TABLE IF NOT EXISTS public.sessions (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
)
""")

Engine.Repo.query!("""
CREATE TABLE IF NOT EXISTS public.agent_instructions (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  agent text NOT NULL,
  content text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
)
""")

Ecto.Adapters.SQL.Sandbox.checkin(Engine.Repo)
