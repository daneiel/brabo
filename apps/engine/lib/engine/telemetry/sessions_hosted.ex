defmodule Engine.Telemetry.SessionsHosted do
  @moduledoc """
  Quantas sessões ESTE nó hospeda (Fase 5, item 4).

  Complementa `brabo_sessions_active` da api, que conta por projeto e vem do
  banco. Esta é por RÉPLICA, e responde uma pergunta que a outra não responde:
  as sessões estão distribuídas entre os pods ou concentradas num só?

  A pergunta deixou de ser acadêmica nesta sessão. O nome da sessão passou a
  viver em `:global`, e o dono é quem a criou (ou quem a adotou) — não há
  rebalanceamento. Um pod que ficou de pé por muito tempo acumula sessões
  enquanto os novos ficam vazios, e é este gráfico que mostra isso.
  """

  @event [:engine, :sessions, :hosted]

  @doc "Medição do `:telemetry_poller`."
  def measure do
    local =
      Engine.Sessions.SessionState.list_non_terminal()
      |> Enum.count(fn s ->
        case Engine.Sessions.SessionServer.whereis(s.session_id) do
          pid when is_pid(pid) -> node(pid) == node()
          nil -> false
        end
      end)

    :telemetry.execute(@event, %{count: local}, %{})
    :ok
  rescue
    # Mesma disciplina do ObanQueueDepth: uma falha de banco aqui não pode
    # derrubar o poller e com ele TODAS as métricas do nó.
    _ -> :ok
  catch
    _, _ -> :ok
  end

  def event, do: @event
end
