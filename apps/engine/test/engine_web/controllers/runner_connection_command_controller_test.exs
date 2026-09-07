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
end
