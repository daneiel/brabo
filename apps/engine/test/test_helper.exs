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

Ecto.Adapters.SQL.Sandbox.checkin(Engine.Repo)
