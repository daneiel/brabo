defmodule Engine.Gates.FakeGateDispatcher do
  @moduledoc """
  Fake de teste pra `Engine.Gates.Dispatcher` — nunca sobe um GenServer real
  (evita tocar o banco fora do sandbox Ecto do processo de teste). Notifica
  `:test_pid` via `send/2`, mesmo padrão de `FakeEngineApiClient`.
  """

  @behaviour Engine.Gates.Dispatcher

  @impl true
  def run_qa(project_id, task_id) do
    notify({:gate_dispatch, :qa, project_id, task_id})
    :ok
  end

  @impl true
  def run_secops(project_id, task_id) do
    notify({:gate_dispatch, :secops, project_id, task_id})
    :ok
  end

  defp notify(msg) do
    if pid = Application.get_env(:engine, :test_pid), do: send(pid, msg)
    :ok
  end
end
