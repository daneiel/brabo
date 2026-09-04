defmodule EngineWeb.PsychologistCommandControllerTest do
  # async: false — mexe no Application env global (`psychologist_enabled?`),
  # mesmo padrão da suite da Anamnese (ver
  # anamnese_command_controller_test.exs). A action é chamada DIRETO (sem
  # passar pelo router): o que está sob teste é a decisão do controller, não
  # o pipeline de auth (isso é `VerifyServiceToken`, testado à parte).
  use EngineWeb.ConnCase, async: false
  use Oban.Testing, repo: Engine.Repo, prefix: "engine"

  alias Engine.Workers.PsychologistWorker
  alias EngineWeb.PsychologistCommandController

  setup do
    on_exit(fn -> Application.delete_env(:engine, :psychologist_enabled?) end)
    :ok
  end

  describe "Psicólogo desativado globalmente (PSYCHOLOGIST_ENABLED=false)" do
    test "recusa com 503 e não cria o job", %{conn: conn} do
      Application.put_env(:engine, :psychologist_enabled?, false)
      session_id = Ecto.UUID.generate()
      project_id = Ecto.UUID.generate()

      conn =
        PsychologistCommandController.reanalyze(conn, %{
          "sessionId" => session_id,
          "projectId" => project_id
        })

      assert conn.status == 503
      assert %{"error" => "psicologo_desativado"} = json_response(conn, 503)
      refute_enqueued(worker: PsychologistWorker, args: %{"aggregate_id" => session_id})
    end
  end

  describe "Psicólogo ativado (PSYCHOLOGIST_ENABLED=true)" do
    test "202 e enfileira a rodada manual", %{conn: conn} do
      Application.put_env(:engine, :psychologist_enabled?, true)
      session_id = Ecto.UUID.generate()
      project_id = Ecto.UUID.generate()

      conn =
        PsychologistCommandController.reanalyze(conn, %{
          "sessionId" => session_id,
          "projectId" => project_id
        })

      assert conn.status == 202

      assert_enqueued(
        worker: PsychologistWorker,
        args: %{
          "aggregate_id" => session_id,
          "payload" => %{"projectId" => project_id, "triggeredBy" => "manual"}
        }
      )
    end
  end

  describe "status/2 (RN-454)" do
    test "reporta enabled: false quando a flag está desligada", %{conn: conn} do
      Application.put_env(:engine, :psychologist_enabled?, false)

      conn = PsychologistCommandController.status(conn, %{})

      assert conn.status == 200
      assert %{"enabled" => false} = json_response(conn, 200)
    end

    test "reporta enabled: true quando a flag está ligada", %{conn: conn} do
      Application.put_env(:engine, :psychologist_enabled?, true)

      conn = PsychologistCommandController.status(conn, %{})

      assert conn.status == 200
      assert %{"enabled" => true} = json_response(conn, 200)
    end
  end
end
