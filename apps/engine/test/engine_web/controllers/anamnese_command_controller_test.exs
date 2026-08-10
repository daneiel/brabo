defmodule EngineWeb.AnamneseCommandControllerTest do
  # async: false — mexe no Application env global (`anamnese_enabled?`), como
  # o resto da suite da Anamnese. A action é chamada DIRETO (sem passar pelo
  # router): o que está sob teste é a decisão do controller, não o pipeline
  # de auth (isso é `VerifyServiceToken`, testado à parte).
  use EngineWeb.ConnCase, async: false
  use Oban.Testing, repo: Engine.Repo, prefix: "engine"

  alias Engine.Workers.AnamneseWorker
  alias EngineWeb.AnamneseCommandController

  setup do
    Engine.GlobalSessionTestLock.acquire()

    on_exit(fn ->
      Application.delete_env(:engine, :anamnese_enabled?)
      Engine.GlobalSessionTestLock.release()
    end)

    :ok
  end

  defp seed_projeto_com_sessao! do
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

    Engine.Repo.insert_all("sessions", [
      %{
        id: Ecto.UUID.dump!(Ecto.UUID.generate()),
        project_id: Ecto.UUID.dump!(project_id),
        created_at: DateTime.utc_now() |> DateTime.truncate(:second)
      }
    ])

    project_id
  end

  describe "Anamnese desativada globalmente (ANAMNESE_ENABLED=false)" do
    test "recusa com 503 distinto de \"projeto sem sessão\", mesmo com sessão", %{conn: conn} do
      Application.put_env(:engine, :anamnese_enabled?, false)
      project_id = seed_projeto_com_sessao!()

      conn = AnamneseCommandController.run(conn, %{"projectId" => project_id})

      assert conn.status == 503
      assert %{"error" => "anamnese_desativada"} = json_response(conn, 503)
      refute_enqueued(worker: AnamneseWorker, args: %{project_id: project_id})
    end

    test "recusa com 503 mesmo sem sessão nenhuma (não é o caso de 409)", %{conn: conn} do
      Application.put_env(:engine, :anamnese_enabled?, false)
      project_id = Ecto.UUID.generate()

      conn = AnamneseCommandController.run(conn, %{"projectId" => project_id})

      assert conn.status == 503
    end
  end

  describe "Anamnese ativada (ANAMNESE_ENABLED=true)" do
    test "projeto com sessão: 202 e enfileira a rodada", %{conn: conn} do
      Application.put_env(:engine, :anamnese_enabled?, true)
      project_id = seed_projeto_com_sessao!()

      conn = AnamneseCommandController.run(conn, %{"projectId" => project_id})

      assert conn.status == 202
      assert_enqueued(worker: AnamneseWorker, args: %{project_id: project_id})
    end

    test "projeto sem sessão: 409, comportamento existente intocado", %{conn: conn} do
      Application.put_env(:engine, :anamnese_enabled?, true)
      project_id = Ecto.UUID.generate()

      conn = AnamneseCommandController.run(conn, %{"projectId" => project_id})

      assert conn.status == 409
    end
  end
end
