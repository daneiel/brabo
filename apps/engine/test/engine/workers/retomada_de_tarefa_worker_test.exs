defmodule Engine.Workers.RetomadaDeTarefaWorkerTest do
  # RN-864 (AT-525)
  use ExUnit.Case, async: false

  alias Engine.Sessions.FakeEngineApiClient
  alias Engine.Workers.RetomadaDeTarefaWorker

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
    end)
  end

  defp job,
    do: %Oban.Job{
      args: %{"projectId" => "p", "sessionId" => "s", "taskId" => "t1", "agentId" => "dev-api"}
    }

  test "desbloqueia a task pelo caminho do desbloqueio humano" do
    assert :ok = RetomadaDeTarefaWorker.perform(job())
    assert_received {:task_unblocked, "t1", "dev-api"}
  end

  test "falha da api volta como erro (o Oban retenta)" do
    Process.put(:fake_unblock_result, {:error, :econnrefused})
    assert {:error, :econnrefused} = RetomadaDeTarefaWorker.perform(job())
  end

  test "agendar além do teto é :esgotado" do
    assert RetomadaDeTarefaWorker.teto() == 3
    assert :esgotado = RetomadaDeTarefaWorker.agendar(%{}, "t1", 3)
  end
end
