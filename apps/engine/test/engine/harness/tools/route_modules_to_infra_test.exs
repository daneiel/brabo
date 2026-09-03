defmodule Engine.Harness.Tools.RouteModulesToInfraTest do
  @moduledoc """
  `route_modules_to_infra` é fino: quem valida a lista (módulo existente no
  module_map vigente, imagem com tag/digest, `latest` recusado, `rationale`
  real) é a api. O tool só normaliza as chaves que o modelo mandou e traduz o
  resultado — mesmo padrão de `choose_project_image`/`create_c4_diagram`.
  """

  # async: false — `test_pid` é Application env GLOBAL, mesmo padrão de
  # `create_c4_diagram_test.exs`.
  use ExUnit.Case, async: false

  alias Engine.Harness.Tools.RouteModulesToInfra

  setup do
    Application.put_env(:engine, :engine_api_client, Engine.Sessions.FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :test_pid)
      Process.delete(:fake_module_routing_error)
    end)

    %{ctx: %{project_id: "p1", session_id: "s1"}}
  end

  test "categoria é :direct", do: assert(RouteModulesToInfra.category() == :direct)

  test "o sucesso devolve a versão e os módulos roteados", %{ctx: ctx} do
    roteamento = [
      %{
        "modulo" => "api",
        "imagemCandidata" => "node:22-bookworm-slim",
        "porque" => "motivo real"
      },
      %{
        "modulo" => "web",
        "imagemCandidata" => "node:22-bookworm-slim",
        "porque" => "motivo real"
      }
    ]

    assert {:ok, texto} = RouteModulesToInfra.run(%{"roteamento" => roteamento}, ctx)
    assert texto =~ "version 1"
    assert texto =~ "api"
    assert texto =~ "web"
    assert texto =~ "Infra elege"
  end

  test "normaliza as chaves do tool call antes de enviar", %{ctx: ctx} do
    roteamento = [
      %{
        "modulo" => "api",
        "imagemCandidata" => "node:22-bookworm-slim",
        "porque" => "motivo real"
      }
    ]

    assert {:ok, _} = RouteModulesToInfra.run(%{"roteamento" => roteamento}, ctx)

    assert_received {:module_routing_created, enviado}

    assert [%{modulo: "api", imagemCandidata: "node:22-bookworm-slim", porque: "motivo real"}] =
             enviado
  end

  test "item sem chave conhecida normaliza para string vazia, nunca crasha", %{ctx: ctx} do
    roteamento = [%{"modulo" => "api"}]

    assert {:ok, _} = RouteModulesToInfra.run(%{"roteamento" => roteamento}, ctx)
    assert_received {:module_routing_created, [%{modulo: "api", imagemCandidata: "", porque: ""}]}
  end

  test "imagem inválida (ex.: `latest`) na api vira tool-result de erro, sem crash", %{ctx: ctx} do
    Process.put(:fake_module_routing_error, "módulo \"api\": Imagem inválida")

    roteamento = [
      %{"modulo" => "api", "imagemCandidata" => "node:latest", "porque" => "motivo real"}
    ]

    assert {:error, texto} = RouteModulesToInfra.run(%{"roteamento" => roteamento}, ctx)
    assert texto =~ "roteamento recusado"
    assert texto =~ "Imagem inválida"
  end

  test "sem `roteamento`, recusa dizendo o que falta", %{ctx: ctx} do
    assert {:error, texto} = RouteModulesToInfra.run(%{}, ctx)
    assert texto =~ "exige `roteamento`"
  end
end
