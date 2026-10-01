defmodule Engine.Harness.Tools.DeclareModuleContractsTest do
  @moduledoc """
  RN-684 (ADR 0200): `declare_module_contracts` é fino como
  `route_modules_to_infra` — quem valida o contrato é a api. O tool normaliza
  as chaves que o modelo mandou e traduz o resultado, inclusive a recusa.
  """

  use ExUnit.Case, async: false

  alias Engine.Harness.Tools.DeclareModuleContracts

  setup do
    Application.put_env(:engine, :engine_api_client, Engine.Sessions.FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn -> Application.delete_env(:engine, :test_pid) end)

    %{ctx: %{project_id: "p1", session_id: "s1"}}
  end

  test "categoria é :direct e o nome é o do kickoff do Arquiteto" do
    assert DeclareModuleContracts.category() == :direct
    assert DeclareModuleContracts.spec().name == "declare_module_contracts"
  end

  test "o sucesso devolve a versão, os módulos e diz quem lê", %{ctx: ctx} do
    contratos = [
      %{
        "modulo" => "board-engine",
        "expoe" => [%{"tipo" => "funcao", "assinatura" => "placePiece(b, p, pos): Board"}]
      }
    ]

    assert {:ok, texto} = DeclareModuleContracts.run(%{"contratos" => contratos}, ctx)
    assert texto =~ "version 1"
    assert texto =~ "board-engine"
    assert texto =~ "listar_contratos_de_modulos"

    assert_received {:module_contracts_declared,
                     [
                       %{
                         modulo: "board-engine",
                         expoe: [
                           %{
                             tipo: "funcao",
                             assinatura: "placePiece(b, p, pos): Board",
                             descricao: ""
                           }
                         ]
                       }
                     ]}
  end

  test "item malformado normaliza para vazio e deixa a api nomear o defeito", %{ctx: ctx} do
    assert {:ok, _} =
             DeclareModuleContracts.run(
               %{"contratos" => [%{"modulo" => "x", "expoe" => "?"}, 7]},
               ctx
             )

    assert_received {:module_contracts_declared,
                     [%{modulo: "x", expoe: []}, %{modulo: "", expoe: []}]}
  end

  test "a recusa da api volta como erro com o motivo inteiro", %{ctx: ctx} do
    Process.put(
      :fake_module_contracts,
      {:error, {400, %{"message" => "Os módulos válidos são: a, b."}}}
    )

    on_exit(fn -> Process.delete(:fake_module_contracts) end)

    assert {:error, texto} =
             DeclareModuleContracts.run(
               %{"contratos" => [%{"modulo" => "z", "expoe" => []}]},
               ctx
             )

    assert texto =~ "contratos recusados"
    assert texto =~ "Os módulos válidos são: a, b."
  end

  test "sem `contratos` é erro nomeado, sem chamar a api", %{ctx: ctx} do
    assert {:error, texto} = DeclareModuleContracts.run(%{}, ctx)
    assert texto =~ "exige `contratos`"
    refute_received {:module_contracts_declared, _}
  end
end
