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

    # Default do ambiente é DESATIVADO (RN-115); os testes daqui pra baixo
    # exercitam o comportamento de fan-out/reagendamento de uma corrente
    # LIGADA — a corrente desligada tem describe própria mais abaixo.
    Application.put_env(:engine, :anamnese_enabled?, true)
    on_exit(fn -> Application.delete_env(:engine, :anamnese_enabled?) end)

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

  describe "kickoff/0 — flag global (ANAMNESE_ENABLED, decisão do usuário em 2026-08-10)" do
    setup do
      # A fila `:default` NUNCA está vazia em regime normal (três workers se
      # auto-reagendam nela, este entre eles — ver o moduledoc de
      # `Engine.Telemetry.ObanQueueDepthTest`), então `assert/refute_enqueued`
      # sem escopo próprio ficaria refém de ruído alheio. Mesmo remédio que
      # aquele teste já usa: limpar SÓ os jobs deste worker antes de cada
      # verificação.
      Repo.delete_all(
        from(j in "oban_jobs", where: j.worker == "Engine.Workers.AnamneseSchedulerWorker"),
        prefix: "engine"
      )

      on_exit(fn -> Application.delete_env(:engine, :anamnese_enabled?) end)
      :ok
    end

    test "desativada: não agenda o tick — a fila não recebe job nenhum" do
      Application.put_env(:engine, :anamnese_enabled?, false)

      AnamneseSchedulerWorker.kickoff()

      refute_enqueued(worker: AnamneseSchedulerWorker)
    end

    test "ativada: agenda o tick normalmente" do
      Application.put_env(:engine, :anamnese_enabled?, true)

      AnamneseSchedulerWorker.kickoff()

      assert_enqueued(worker: AnamneseSchedulerWorker)
    end

    test "default é DESATIVADO quando a flag não está setada" do
      Application.delete_env(:engine, :anamnese_enabled?)

      refute AnamneseSchedulerWorker.enabled?()
    end
  end

  describe "perform/1 — flag global desligada NO MEIO da corrente (RN-115, bug real)" do
    setup do
      # Job já agendado ANTES de a flag existir (ou de alguém desligá-la)
      # dispara mesmo assim — é exatamente esse caminho que precisa se
      # AUTO-CURAR aqui, sem depender de kickoff/0 ter sido chamado.
      Application.put_env(:engine, :anamnese_enabled?, false)
      on_exit(fn -> Application.delete_env(:engine, :anamnese_enabled?) end)

      # Mesmo remédio do describe de kickoff/0 acima, e pelo mesmo motivo:
      # a fila `:default` não está vazia em regime normal, então
      # refute_enqueued/assert_enqueued sem escopo próprio ficaria refém de
      # jobs REAIS deste worker inseridos fora da sandbox (boot de execução
      # anterior da suite).
      Repo.delete_all(
        from(j in "oban_jobs", where: j.worker == "Engine.Workers.AnamneseSchedulerWorker"),
        prefix: "engine"
      )

      :ok
    end

    test "desativada: não faz fan-out de projeto nenhum" do
      com = seed_projeto!(true)

      assert :ok = perform_job(AnamneseSchedulerWorker, %{})

      refute_enqueued(worker: AnamneseWorker, args: %{project_id: com})
    end

    test "desativada: não reagenda o próprio tick — a corrente morre ali" do
      seed_projeto!(true)

      assert :ok = perform_job(AnamneseSchedulerWorker, %{})

      refute_enqueued(worker: AnamneseSchedulerWorker)
    end
  end
end
