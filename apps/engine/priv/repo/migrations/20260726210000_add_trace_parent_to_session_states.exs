defmodule Engine.Repo.Migrations.AddTraceParentToSessionStates do
  use Ecto.Migration

  # Fase 5, item 3 — "uma sessão = uma trace raiz".
  #
  # A api abre a span `session.create`, persiste o `traceparent` dela em
  # `sessions.trace_parent` (tabela dela) e o envia no comando de criação. O
  # engine guarda aqui a sua cópia, porque é deste lado que o trabalho acontece:
  # todo turno de agente, tool call, gate e job do Oban pendura suas spans neste
  # traceparent e compartilha o mesmo trace_id.
  #
  # Cópia e não join: o engine leria a tabela `sessions` da api (schema public) a
  # cada turno de agente só para descobrir um valor imutável. Guardar ao criar
  # troca N leituras por uma escrita.
  def change do
    alter table(:session_states) do
      add :trace_parent, :string
    end
  end
end
