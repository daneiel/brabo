defmodule Engine.Harness.Tools.ListarContratosDeModulosTest do
  @moduledoc """
  RN-684 (ADR 0200): o dev agent lê o contrato entre módulos em vez do
  worktree alheio. A leitura é CONTIDA (ADR 0060): sem parâmetro, o módulo do
  dev vem do contexto do laço, e o que ele não consome aparece só pelo nome.
  """

  use ExUnit.Case, async: false

  alias Engine.Harness.Tools.ListarContratosDeModulos

  setup do
    Application.put_env(:engine, :engine_api_client, Engine.Sessions.FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :test_pid)
      Process.delete(:fake_module_contracts_lidos)
    end)

    %{
      ctx: %{
        project_id: "p1",
        session_id: "s1",
        agent: "dev-game-session",
        module: "game-session"
      }
    }
  end

  defp lidos do
    %{
      "status" => "declarados",
      "version" => 3,
      "modulos" => [
        %{
          "modulo" => "board-engine",
          "dependeDe" => [],
          "expoe" => [
            %{
              "tipo" => "funcao",
              "assinatura" => "placePiece(board, piece, pos): Board",
              "descricao" => "Nunca muta o board."
            }
          ]
        },
        %{"modulo" => "scoring", "dependeDe" => [], "expoe" => nil},
        %{
          "modulo" => "game-session",
          "dependeDe" => ["board-engine", "scoring"],
          "expoe" => [
            %{"tipo" => "evento", "assinatura" => "game.over {score}", "descricao" => ""}
          ]
        },
        %{"modulo" => "retro-renderer", "dependeDe" => ["game-session"], "expoe" => nil},
        %{
          "modulo" => "persistence",
          "dependeDe" => [],
          "expoe" => [%{"tipo" => "rota", "assinatura" => "GET /scores", "descricao" => ""}]
        }
      ],
      "contratosForaDoMapa" => []
    }
  end

  test "sem parâmetro e :direct" do
    assert ListarContratosDeModulos.category() == :direct
    assert ListarContratosDeModulos.spec().parameters["properties"] == %{}
  end

  test "está no registro do dev agent, e não no global" do
    assert ListarContratosDeModulos in Engine.Dev.Tools.registry()
    refute ListarContratosDeModulos in Engine.Harness.Tools.registry()
  end

  test "mostra o seu módulo e o que ele consome por inteiro, o resto só pelo nome", %{ctx: ctx} do
    Process.put(:fake_module_contracts_lidos, lidos())

    assert {:ok, texto} = ListarContratosDeModulos.run(%{}, ctx)
    assert_received {:module_contracts_listed, "p1"}

    assert texto =~ "versão 3, declarada pelo Arquiteto"
    assert texto =~ "O SEU módulo é \"game-session\". Ele consome: board-engine, scoring."
    assert texto =~ "- [funcao] placePiece(board, piece, pos): Board — Nunca muta o board."
    assert texto =~ "- [evento] game.over {score}"
    assert texto =~ "Consomem o SEU módulo (não quebre o que você expõe a eles): retro-renderer."
    assert texto =~ "Outros módulos, que você não consome (contrato não mostrado): persistence."
    refute texto =~ "GET /scores"

    # scoring é consumido e não tem contrato: o aviso diz o que fazer em vez
    # de mandar ler o worktree.
    assert texto =~ "## scoring\n(sem contrato declarado"
    assert texto =~ "Não a deduza do\nworktree de outro dev agent"
    assert texto =~ "report_blocked"
  end

  test "projeto sem contrato nenhum diz isso e diz o que fazer", %{ctx: ctx} do
    Process.put(
      :fake_module_contracts_lidos,
      %{lidos() | "status" => "sem_contratos", "version" => 0}
      |> Map.update!("modulos", fn ms -> Enum.map(ms, &Map.put(&1, "expoe", nil)) end)
    )

    assert {:ok, texto} = ListarContratosDeModulos.run(%{}, ctx)
    assert texto =~ "Nenhum contrato entre módulos foi declarado pelo Arquiteto"
    assert texto =~ "report_blocked"
  end

  test "sem módulo no contexto, lista todos, e o corte diz o total", %{ctx: ctx} do
    itens =
      for i <- 1..130, do: %{"tipo" => "funcao", "assinatura" => "f#{i}()", "descricao" => ""}

    Process.put(:fake_module_contracts_lidos, %{
      "status" => "declarados",
      "version" => 1,
      "modulos" => [%{"modulo" => "grande", "dependeDe" => [], "expoe" => itens}],
      "contratosForaDoMapa" => ["antigo"]
    })

    assert {:ok, texto} = ListarContratosDeModulos.run(%{}, Map.delete(ctx, :module))
    assert texto =~ "1 módulo(s) no module_map vigente."
    assert texto =~ "- [funcao] f120()"
    refute texto =~ "f121()"
    assert texto =~ "(+ 10 item(ns) de contrato não mostrado(s) pelo teto de 120"
    assert texto =~ "não tem mais: antigo"
  end

  test "falha da api é erro nomeado, nunca texto vazio", %{ctx: ctx} do
    Process.put(:fake_module_contracts_lidos, {:error, {500, "boom"}})

    assert {:error, texto} = ListarContratosDeModulos.run(%{}, ctx)
    assert texto =~ "falha ao listar contratos de módulos"
  end
end
