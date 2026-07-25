defmodule Engine.Sessions.Monitor do
  @moduledoc """
  Observa cada SessionServer via Process.monitor/1 (não link — uma sessão
  morta não deve derrubar o resto do engine) e decide, ao receber :DOWN,
  se um callback HTTP pra api é necessário.

  Sem mirror de log: o event log vive em Postgres (api), diferente do
  spike que provou este padrão — aqui só guardamos metadado de supervisão.
  """

  use GenServer

  require Logger

  alias Engine.Sessions.SessionState

  @name __MODULE__

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, %{by_pid: %{}, by_session: %{}}, name: @name)
  end

  def watch(pid, session_id, project_id) do
    GenServer.call(@name, {:watch, pid, session_id, project_id})
  end

  @doc """
  Chamado pelo SessionLifecycleWorker ANTES de parar uma sessão cuja causa
  a api já conhece (consumiu session.closed/session.closed_abnormally via
  outbox) — evita o callback HTTP redundante.
  """
  def expect_stop(session_id), do: GenServer.call(@name, {:expect_stop, session_id})

  @impl true
  def init(state), do: {:ok, state}

  @impl true
  def handle_call({:watch, pid, session_id, project_id}, _from, state) do
    ref = Process.monitor(pid)
    entry = %{ref: ref, session_id: session_id, project_id: project_id, expect_stop: false}

    state = %{
      state
      | by_pid: Map.put(state.by_pid, pid, entry),
        by_session: Map.put(state.by_session, session_id, pid)
    }

    {:reply, :ok, state}
  end

  def handle_call({:expect_stop, session_id}, _from, state) do
    state =
      case Map.fetch(state.by_session, session_id) do
        {:ok, pid} -> put_in(state.by_pid[pid].expect_stop, true)
        :error -> state
      end

    {:reply, :ok, state}
  end

  @impl true
  def handle_info({:DOWN, ref, :process, pid, reason}, state) do
    case Map.fetch(state.by_pid, pid) do
      {:ok, %{ref: ^ref} = entry} ->
        safe_delete(entry.session_id)
        maybe_report(entry, reason)

        state = %{
          state
          | by_pid: Map.delete(state.by_pid, pid),
            by_session: Map.delete(state.by_session, entry.session_id)
        }

        {:noreply, state}

      _ ->
        {:noreply, state}
    end
  end

  # Este Monitor é um SINGLETON: se ele morre, o engine perde de uma vez o
  # monitoramento de todas as sessões vivas (os monitores morrem com ele) e
  # nenhum término posterior vira callback pra api. Uma indisponibilidade do
  # banco não pode ter esse efeito — o :DOWN já foi consumido de qualquer
  # forma, então registra e segue.
  defp safe_delete(session_id) do
    SessionState.delete(session_id)
  rescue
    e ->
      Logger.warning("Monitor: falha ao apagar session_state #{session_id}: #{inspect(e)}")
  catch
    :exit, reason ->
      Logger.warning("Monitor: falha ao apagar session_state #{session_id}: #{inspect(reason)}")
  end

  # :normal precedido de expect_stop -> api já sabe, sem callback.
  # :killed, crash, heartbeat_timeout, ou :normal SEM expect_stop
  # (defensivo) -> reporta, com o destino de transição que cada causa
  # implica.
  defp maybe_report(%{expect_stop: true}, :normal), do: :ok

  defp maybe_report(entry, reason) do
    {reason_string, to} = classify(reason)

    Task.Supervisor.start_child(Engine.TaskSupervisor, fn ->
      client().report_termination(entry.project_id, entry.session_id, reason_string, to)
    end)
  end

  defp client do
    Application.get_env(:engine, :engine_api_client, Engine.Sessions.EngineApiClient.Live)
  end

  # heartbeat_timeout é um jeito normal de uma sessão terminar (ninguém
  # do outro lado) — não é uma falha do engine, então vira "closed" (via
  # o hop implícito active->closing que a api resolve do lado dela), não
  # "closed_abnormally" como as outras causas.
  defp classify({:shutdown, :heartbeat_timeout}), do: {"heartbeat_timeout", "closed"}
  defp classify(:normal), do: {"normal", "closed_abnormally"}
  defp classify(:killed), do: {"killed", "closed_abnormally"}

  defp classify({error, _stacktrace}) when is_exception(error),
    do: {Exception.message(error), "closed_abnormally"}

  defp classify(other), do: {inspect(other), "closed_abnormally"}
end
