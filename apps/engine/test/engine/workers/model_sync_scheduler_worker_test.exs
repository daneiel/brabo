defmodule Engine.Workers.ModelSyncSchedulerWorkerTest do
  @moduledoc """
  O scheduler é o único caminho pelo qual o catálogo de modelos se atualiza
  sozinho (Fase 9c). Se o auto-reagendamento quebra, o sync simplesmente para
  de rodar sem nada narrar — e um modelo que sumiu do provider continua
  parecendo disponível.
  """

  use Engine.DataCase, async: false
  use Oban.Testing, repo: Engine.Repo, prefix: "engine"

  alias Engine.Sessions.FakeEngineApiClient
  alias Engine.Workers.ModelSyncSchedulerWorker

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
    end)

    :ok
  end

  test "chama o sync na api e se reagenda pra manter a corrente viva" do
    assert :ok = perform_job(ModelSyncSchedulerWorker, %{})

    assert_received :model_catalog_synced
    assert_enqueued(worker: ModelSyncSchedulerWorker)
  end

  test "o tick respeita o intervalo configurado" do
    Application.put_env(:engine, :model_sync_interval_seconds, 60)
    on_exit(fn -> Application.delete_env(:engine, :model_sync_interval_seconds) end)

    assert :ok = perform_job(ModelSyncSchedulerWorker, %{})

    # O sucessor fica agendado, não disponível na hora.
    assert_enqueued(worker: ModelSyncSchedulerWorker, state: "scheduled")
  end

  test "falha de transporte devolve erro MAS o sucessor já está agendado" do
    # A corrente periódica não pode morrer junto com uma rodada ruim: o
    # reagendamento acontece antes do trabalho, de propósito.
    Process.put(:fake_model_sync_error, :econnrefused)
    on_exit(fn -> Process.delete(:fake_model_sync_error) end)

    assert {:error, :econnrefused} = perform_job(ModelSyncSchedulerWorker, %{})

    assert_enqueued(worker: ModelSyncSchedulerWorker)
  end
end
