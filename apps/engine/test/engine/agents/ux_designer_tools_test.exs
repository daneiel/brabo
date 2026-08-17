defmodule Engine.Agents.UxDesignerToolsTest do
  # Sem DataCase — só o FakeEngineApiClient (scriptado por dicionário de
  # processo). async: false (Application env global).
  use ExUnit.Case, async: false

  alias Engine.Agents.UxDesignerTools
  alias Engine.Sessions.FakeEngineApiClient

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
    end)

    %{ctx: %{project_id: "proj-1", session_id: "sess-1"}}
  end

  defp prototipo_valido do
    %{
      "personas" => [%{"nome" => "Ana", "objetivo" => "achar o botão"}],
      "jornadas" => [%{"titulo" => "Achar o botão", "passos" => ["abrir a tela", "clicar"]}],
      "prototipo" => %{
        "telas" => [%{"nome" => "Home", "descricao" => "lista de projetos"}],
        "anotacoes" => "botão fica no --accent"
      },
      "resumo" => "protótipo de uma tela"
    }
  end

  describe "propose_prototype" do
    test "grava o artefato e oferece handoff ao PO e ao Dev Lead", %{ctx: ctx} do
      assert {:ok, msg} = UxDesignerTools.run(prototipo_valido(), ctx)

      assert msg =~ "1 tela(s)"
      assert msg =~ "PO"
      assert msg =~ "Dev Lead"

      assert_received {:event_appended, "proj-1", "sess-1",
                       %{type: "artifact.prototipo_navegavel", actorId: "ux-designer"}}

      assert_received {:handoff_created, "proj-1", "sess-1", "ux-designer", "po", artifact_id}

      assert_received {:handoff_created, "proj-1", "sess-1", "ux-designer", "dev-lead",
                       ^artifact_id}
    end

    test "personas vazias são recusadas, sem gravar nada", %{ctx: ctx} do
      payload = %{prototipo_valido() | "personas" => []}

      assert {:error, msg} = UxDesignerTools.run(payload, ctx)
      assert msg =~ "inválido"
      refute_received {:event_appended, _, _, _}
    end

    test "jornadas vazias são recusadas", %{ctx: ctx} do
      payload = %{prototipo_valido() | "jornadas" => []}

      assert {:error, _msg} = UxDesignerTools.run(payload, ctx)
      refute_received {:event_appended, _, _, _}
    end

    test "protótipo sem telas é recusado", %{ctx: ctx} do
      payload = %{prototipo_valido() | "prototipo" => %{"telas" => []}}

      assert {:error, msg} = UxDesignerTools.run(payload, ctx)
      assert msg =~ "inválido"
      refute_received {:event_appended, _, _, _}
    end

    test "sem os campos obrigatórios: erro que diz o que falta", %{ctx: ctx} do
      assert {:error, msg} = UxDesignerTools.run(%{"resumo" => "só o resumo"}, ctx)
      assert msg =~ "personas"
    end

    # RN-163: erro é ENTRADA do laço, não fim de linha — o artefato já
    # gravado não se perde por um handoff que falhou.
    test "falha ao ofertar handoff não desfaz o artefato já gravado", %{ctx: ctx} do
      Process.put(:fake_handoff_error, "api fora do ar")

      assert {:error, msg} = UxDesignerTools.run(prototipo_valido(), ctx)

      assert msg =~ "protótipo registrado"
      assert msg =~ "falha ao oferecer handoff"
      assert_received {:event_appended, _, _, %{type: "artifact.prototipo_navegavel"}}
    end

    test "falha ao gravar o artefato não tenta ofertar handoff nenhum", %{ctx: ctx} do
      Process.put(:fake_append_event_error, "postgres fora do ar")

      assert {:error, msg} = UxDesignerTools.run(prototipo_valido(), ctx)
      assert msg =~ "falha ao registrar protótipo"
      refute_received {:handoff_created, _, _, _, _, _}
    end
  end
end
