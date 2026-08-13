defmodule Engine.Harness.Tools.CreateC4DiagramTest do
  @moduledoc """
  `create_c4_diagram` é fino: quem valida a entrada e deriva o Container level
  do module_map vigente é a api (ADR do diagrama C4). O tool só normaliza o
  que o modelo mandou (`actors`, default de `type`) e traduz o resultado —
  mesmo padrão de `choose_project_image`.
  """

  # async: false — igual a `context_builder_test.exs`: `test_pid` é
  # Application env GLOBAL, e o teste de normalização de `actors` depende dele
  # pra capturar o que o tool mandou ao EngineApiClient.
  use ExUnit.Case, async: false

  alias Engine.Harness.Tools.CreateC4Diagram

  setup do
    Application.put_env(:engine, :engine_api_client, Engine.Sessions.FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :test_pid)
      Process.delete(:fake_c4_diagram_error)
    end)

    %{ctx: %{project_id: "p1", session_id: "s1"}}
  end

  test "o sucesso devolve a versão gerada", %{ctx: ctx} do
    assert {:ok, texto} = CreateC4Diagram.run(%{"system_name" => "Brabo"}, ctx)
    assert texto =~ "version 1"
    assert texto =~ "Context"
  end

  test "envia system_description e actors normalizados (type default person)", %{ctx: ctx} do
    assert {:ok, _} =
             CreateC4Diagram.run(
               %{
                 "system_name" => "Brabo",
                 "system_description" => "Plataforma de agentes",
                 "actors" => [
                   %{"name" => "Usuário"},
                   %{"name" => "GitHub", "type" => "external_system"}
                 ]
               },
               ctx
             )

    assert_received {:c4_diagram_created, entrada}
    assert entrada.systemName == "Brabo"
    assert entrada.systemDescription == "Plataforma de agentes"
    assert [%{type: "person"}, %{type: "external_system"}] = entrada.actors
  end

  test "sem actors, envia lista vazia", %{ctx: ctx} do
    assert {:ok, _} = CreateC4Diagram.run(%{"system_name" => "Brabo"}, ctx)
    assert_received {:c4_diagram_created, entrada}
    assert entrada.actors == []
  end

  test "erro da api (sem module_map, por ex.) vira tool-result de erro", %{ctx: ctx} do
    Process.put(:fake_c4_diagram_error, :sem_module_map)

    assert {:error, texto} = CreateC4Diagram.run(%{"system_name" => "Brabo"}, ctx)
    assert texto =~ "falha ao gerar diagrama C4"
    assert texto =~ "sem_module_map"
  end

  test "sem `system_name`, recusa dizendo o que falta", %{ctx: ctx} do
    assert {:error, texto} = CreateC4Diagram.run(%{}, ctx)
    assert texto =~ "exige `system_name`"
  end
end
