defmodule Engine.Sessions.SessionServer do
  @moduledoc """
  Placeholder de runtime de UMA sessão ativa, supervisionado. Fase 1 não
  executa lógica de agente aqui — o event log de domínio vive em Postgres
  do lado da api (session_events), não neste processo. Este módulo existe
  só para provar supervisão + evento de término (CLAUDE.md, item 6).
  """

  use GenServer, restart: :temporary

  def start_link({session_id, project_id}) do
    GenServer.start_link(__MODULE__, {session_id, project_id}, name: via(session_id))
  end

  def via(session_id), do: {:via, Registry, {Engine.Sessions.Registry, session_id}}

  def stop(pid), do: GenServer.stop(pid, :normal)

  @doc "Hook de teste/ops: provoca um crash real (raise) dentro do processo."
  def crash(pid), do: GenServer.cast(pid, :crash)

  @impl true
  def init({session_id, project_id}) do
    {:ok, %{session_id: session_id, project_id: project_id}}
  end

  @impl true
  def handle_cast(:crash, state) do
    raise "crash simulado da sessão #{state.session_id} (hook de teste/ops)"
  end
end
