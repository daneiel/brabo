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

# `:golden_set_qa` (ADR 0123) é uma exclusão PERMANENTE, nunca detectada
# como os quatro binários acima. A diferença é deliberada: gitleaks/
# hadolint/yamllint/actionlint são grátis e determinísticos — ausência é o
# único motivo de pular. O golden-set chama um LLM real (Ollama, já de pé
# nesta e em outras máquinas de desenvolvimento) e o julgamento que ele mede
# é o que NÃO é determinístico — incluir automaticamente por "Ollama
# alcançável" faria este módulo disparar dentro de QUALQUER `mix test`,
# gastando tokens sem aviso e introduzindo flake de verdade numa suíte que
# hoje é 100% determinística. Só roda com `mix test --only golden_set_qa`
# (ou `mix golden_set.qa`) — decisão deliberada, nunca automática.
ExUnit.start(exclude: [:golden_set_qa | binary_exclusions])
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
# (nome/slug pra camada de contexto, workspace_dir_name pra RN-109) e
# agent_instructions (arquivo de agente do banco pro InstructionFiles). Só as
# colunas que o engine lê.
Engine.Repo.query!("""
CREATE TABLE IF NOT EXISTS public.projects (
  id uuid PRIMARY KEY,
  workspace_id uuid,
  name text NOT NULL,
  slug text NOT NULL,
  workspace_dir_name text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
)
""")

# `CREATE TABLE IF NOT EXISTS` não acrescenta coluna numa tabela que já
# existe — mesmo motivo do ALTER idempotente de outbox_events acima.
# NULLABLE de propósito, ao contrário da api (NOT NULL lá): dezenas de specs
# no engine inserem em "projects" sem saber do conceito de nome de pasta, e
# `Engine.Projects.Project.workspace_dir_name/1` já degrada pra `nil` (que
# quem chama trata como "usa o project_id cru").
Engine.Repo.query!("ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS workspace_dir_name text")

# RN-169/RN-421 (ADR 0072/0104): o localizador da pasta deixou de ser só o
# nome. As colunas são lidas pela MESMA consulta que resolve
# `workspace_dir_name/1`, e sem elas o fixture reprovaria com "column does
# not exist". Nullable e sem default de propósito, como a de cima:
# `case when execution_mode <> 'container'` com a coluna nula cai no ramo
# `container`, que é o comportamento que as dezenas de specs que inserem em
# "projects" sempre tiveram. `text` solto, e não o enum real da api — o
# fixture nunca precisou do CHECK/enum, só do valor lido de volta.
Engine.Repo.query!("ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS execution_mode text")
Engine.Repo.query!("ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS workspace_path text")
# `nil` = não verificado (RN-423) — só ganha sentido em `execution_mode:
# "runner"`, checado por `Engine.Actions.TerminalExecutor` antes de rotear.
Engine.Repo.query!(
  "ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS workspace_verified_at timestamptz"
)

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

# Mesmo motivo dos fixtures acima — session_socket_tickets também é
# gerenciada pela api (Drizzle, schema "public"). RN-108: é o que
# Engine.Sessions.SocketTicket lê e consome pra autenticar connect/3 de
# EngineWeb.SessionSocket. Enum socket_ticket_scope simplificado pra text —
# só a api valida o vocabulário fechado na emissão.
Engine.Repo.query!("""
CREATE TABLE IF NOT EXISTS public.session_socket_tickets (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL,
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  scope text NOT NULL,
  ticket_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
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
