defmodule EngineWeb.RunnerConnectionCommandControllerTest do
  @moduledoc """
  A rota interna que a api chama ao revogar uma chave de dispositivo
  (ADR 0147 ponto 6, RN-520).

  `async: false`: `Engine.Runners.Registry` usa `:global`, global ao node de
  teste inteiro (mesmo motivo de `EngineWeb.TerminalChannelTest`).

  A action é chamada DIRETO, sem passar pelo router — o que está sob teste é a
  decisão do controller, não o pipeline de auth (`VerifyServiceToken` é
  testado à parte). Mesma disciplina de
  `EngineWeb.ExecutionCommandControllerTest`.
  """

  use EngineWeb.ConnCase, async: false

  alias Engine.Runners.Registry
  alias EngineWeb.RunnerConnectionCommandController

  test "sem runner conectado: 200 com desfecho \"sem_runner\" — nunca erro", %{conn: conn} do
    conn =
      RunnerConnectionCommandController.disconnect(conn, %{
        "projectId" => Ecto.UUID.generate(),
        "userId" => Ecto.UUID.generate()
      })

    assert conn.status == 200
    assert %{"desfecho" => "sem_runner"} = json_response(conn, 200)
  end

  test "caminho feliz: o canal registrado responde e o desfecho volta no corpo", %{conn: conn} do
    project_id = Ecto.UUID.generate()
    dono = Ecto.UUID.generate()
    parent = self()

    pid =
      spawn(fn ->
        :ok = Registry.register(project_id, self())
        send(parent, :pronto)

        receive do
          {:derrubar_por_revogacao, ref, ^dono, from} ->
            send(from, {:runner_derrubado, ref, :derrubado})
        end
      end)

    assert_receive :pronto, 1_000
    on_exit(fn -> Process.exit(pid, :kill) end)

    conn =
      RunnerConnectionCommandController.disconnect(conn, %{
        "projectId" => project_id,
        "userId" => dono
      })

    assert %{"desfecho" => "derrubado"} = json_response(conn, 200)
  end

  test "CASO DE FALHA: pedido sem userId é 400 — defeito de quem chamou, não desfecho", %{
    conn: conn
  } do
    conn =
      RunnerConnectionCommandController.disconnect(conn, %{
        "projectId" => Ecto.UUID.generate()
      })

    assert conn.status == 400
    assert %{"error" => mensagem} = json_response(conn, 400)
    assert mensagem =~ "userId"
  end

  test "userId vazio também é 400 — string vazia derrubaria runner nenhum e mentiria", %{
    conn: conn
  } do
    conn =
      RunnerConnectionCommandController.disconnect(conn, %{
        "projectId" => Ecto.UUID.generate(),
        "userId" => ""
      })

    assert conn.status == 400
  end

  describe "disconnect_credential/2 (ADR 0201, RN-685)" do
    test "caminho feliz: 200 com o BALANÇO, mesmo sem runner nenhum para derrubar", %{conn: conn} do
      conn =
        RunnerConnectionCommandController.disconnect_credential(conn, %{
          "credentialKind" => "device_key",
          "credentialId" => Ecto.UUID.generate(),
          "userId" => Ecto.UUID.generate(),
          "projectIds" => [Ecto.UUID.generate()]
        })

      assert %{"derrubados" => 0, "ticketsAnulados" => 0, "semResposta" => 0} =
               json_response(conn, 200)
    end

    test "o canal com a credencial pedida responde, e a contagem volta no corpo", %{conn: conn} do
      project_id = Ecto.UUID.generate()
      chave = Ecto.UUID.generate()
      parent = self()

      pid =
        spawn(fn ->
          :ok = Registry.register(project_id, self())
          send(parent, :pronto)

          receive do
            {:derrubar_por_credencial, ref, %{kind: "device_key", id: ^chave}, _legado, from} ->
              send(from, {:runner_derrubado, ref, :derrubado})
          end
        end)

      assert_receive :pronto, 1_000
      on_exit(fn -> Process.exit(pid, :kill) end)

      conn =
        RunnerConnectionCommandController.disconnect_credential(conn, %{
          "credentialKind" => "device_key",
          "credentialId" => chave
        })

      assert %{"derrubados" => 1} = json_response(conn, 200)
    end

    test "CASO DE FALHA: espécie desconhecida é 400 — \"não mirei nada\" nunca passa por \"não havia nada\"",
         %{conn: conn} do
      conn =
        RunnerConnectionCommandController.disconnect_credential(conn, %{
          "credentialKind" => "sessao",
          "credentialId" => "x"
        })

      assert %{"error" => mensagem} = json_response(conn, 400)
      assert mensagem =~ "credentialKind"
    end

    test "sem credentialId também é 400", %{conn: conn} do
      conn =
        RunnerConnectionCommandController.disconnect_credential(conn, %{
          "credentialKind" => "pat"
        })

      assert conn.status == 400
    end
  end
end
