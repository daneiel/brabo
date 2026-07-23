ExUnit.start()
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
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
)
""")

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

Ecto.Adapters.SQL.Sandbox.checkin(Engine.Repo)
