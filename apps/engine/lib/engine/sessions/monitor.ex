defmodule Engine.Sessions.Monitor do
  @moduledoc """
  Observa cada SessionServer via Process.monitor/1 (não link — uma sessão
  morta não deve derrubar o resto do engine) e decide, ao receber :DOWN,
  se um callback HTTP pra api é necessário.

  Sem mirror de log: o event log vive em Postgres (api), diferente do
  spike que provou este padrão — aqui só guardamos metadado de supervisão.
  """

  use GenServer

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

  # :normal precedido de expect_stop -> api já sabe, sem callback.
  # :killed, crash, ou :normal SEM expect_stop (defensivo) -> reporta.
  defp maybe_report(%{expect_stop: true}, :normal), do: :ok

  defp maybe_report(entry, reason) do
    Task.Supervisor.start_child(Engine.TaskSupervisor, fn ->
      client().report_termination(entry.project_id, entry.session_id, format_reason(reason))
    end)
  end

  defp client do
    Application.get_env(:engine, :engine_api_client, Engine.Sessions.EngineApiClient.Live)
  end

  defp format_reason(:normal), do: "normal"
  defp format_reason(:killed), do: "killed"
  defp format_reason({error, _stacktrace}) when is_exception(error), do: Exception.message(error)
  defp format_reason(other), do: inspect(other)
end
