defmodule Engine.Workers.AnamneseSchedulerWorkerTest do
  @moduledoc """
  O scheduler não tinha teste nenhum, e ele é o único caminho pelo qual uma
  rodada acontece sozinha: se o fan-out ou o auto-reagendamento quebra, a
  Anamnese simplesmente para de rodar sem nada narrar.
  """

  use Engine.DataCase, async: false
  use Oban.Testing, repo: Engine.Repo, prefix: "engine"

  alias Engine.Workers.{AnamneseSchedulerWorker, AnamneseWorker}

  setup do
    Engine.GlobalSessionTestLock.acquire()
    on_exit(fn -> Engine.GlobalSessionTestLock.release() end)
    :ok
  end

  defp seed_projeto!(com_sessao?) do
    project_id = Ecto.UUID.generate()

    Engine.Repo.insert_all("projects", [
      %{
        id: Ecto.UUID.dump!(project_id),
        name: "cobaia",
        slug: "cobaia-#{System.unique_integer([:positive])}",
        created_at: DateTime.utc_now() |> DateTime.truncate(:second),
        updated_at: DateTime.utc_now() |> DateTime.truncate(:second)
      }
    ])

    if com_sessao? do
      Engine.Repo.insert_all("sessions", [
        %{
          id: Ecto.UUID.dump!(Ecto.UUID.generate()),
          project_id: Ecto.UUID.dump!(project_id),
          created_at: DateTime.utc_now() |> DateTime.truncate(:second)
        }
      ])
    end

    project_id
  end

  test "faz fan-out de uma rodada por projeto COM sessão" do
    com = seed_projeto!(true)
    sem = seed_projeto!(false)

    assert :ok = perform_job(AnamneseSchedulerWorker, %{})

    assert_enqueued(worker: AnamneseWorker, args: %{project_id: com})
    # Projeto sem sessão não tem log pra analisar nem onde narrar.
    refute_enqueued(worker: AnamneseWorker, args: %{project_id: sem})
  end

  test "se reagenda pra manter a corrente viva" do
    seed_projeto!(true)

    assert :ok = perform_job(AnamneseSchedulerWorker, %{})

    assert_enqueued(worker: AnamneseSchedulerWorker)
  end

  test "o tick respeita o intervalo configurado" do
    Application.put_env(:engine, :anamnese_interval_seconds, 60)
    on_exit(fn -> Application.delete_env(:engine, :anamnese_interval_seconds) end)

    seed_projeto!(true)

    assert :ok = perform_job(AnamneseSchedulerWorker, %{})

    # O sucessor fica agendado, não disponível na hora.
    assert_enqueued(worker: AnamneseSchedulerWorker, state: "scheduled")
  end
end
