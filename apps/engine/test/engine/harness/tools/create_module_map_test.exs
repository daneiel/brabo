defmodule Engine.Harness.Tools.CreateModuleMapTest do
  @moduledoc """
  O tool-result de `create_module_map` tem que devolver os NOMES (RN-066).

  O Arquiteto não tem ferramenta para ler o module_map vigente: o que ele sabe
  sobre os módulos é o que as respostas de ferramenta contam. Enquanto o sucesso
  dizia apenas "module_map criado (version 1)", ele escrevia o mapa e no passo
  seguinte — `assign_story_modules`, que exige os nomes — não sabia mais como
  chamá-los.

  Numa execução real isso virou força bruta: 18 chutes (`api`, `core`, `http`,
  `greeting`, `domain`, `web`, `hello-api`, `app`, `server`, …) até acertar um
  por sorte, e as quatro histórias terminaram no mesmo módulo com o desfecho
  afirmando que estava tudo certo.
  """

  # async: false (AT-133). O cliente da api é escolhido por
  # `Application.get_env(:engine, :engine_api_client)` — env GLOBAL da VM, não
  # do processo. Com `async: true` este módulo rodava junto de outro módulo
  # async que, no `on_exit`, APAGA a chave (`AppSecContextBuilderTest`), e a
  # chamada caía no `Live` em `localhost:3000` (`:econnrefused`): 4 falhas em
  # 80 rodadas do par. Quem troca env global não roda em paralelo.
  use ExUnit.Case, async: false

  alias Engine.Harness.Tools.CreateModuleMap

  setup do
    Application.put_env(:engine, :engine_api_client, Engine.Sessions.FakeEngineApiClient)

    on_exit(fn ->
      Process.delete(:fake_module_map_error)
      Application.delete_env(:engine, :engine_api_client)
    end)

    %{ctx: %{project_id: "p1", session_id: "s1"}}
  end

  defp modulos do
    [
      %{
        "name" => "saudacao",
        "stack" => "ts",
        "responsibility" => "regra da saudação",
        "depends_on" => []
      },
      %{
        "name" => "api_http",
        "stack" => "ts",
        "responsibility" => "endpoint público",
        "depends_on" => ["saudacao"]
      }
    ]
  end

  test "o sucesso devolve os nomes canônicos, não só a versão", %{ctx: ctx} do
    assert {:ok, texto} = CreateModuleMap.run(%{"modules" => modulos()}, ctx)

    assert texto =~ "saudacao"
    assert texto =~ "api_http"
  end

  test "a versão continua no texto — ninguém perdeu informação", %{ctx: ctx} do
    assert {:ok, texto} = CreateModuleMap.run(%{"modules" => modulos()}, ctx)
    assert texto =~ "version 1"
  end

  # Se a resposta não trouxer os módulos, ecoar os ENVIADOS é melhor que ecoar
  # nada: o agente segue sabendo os nomes que pediu.
  test "sem `modules` na resposta, cai para os nomes enviados", %{ctx: ctx} do
    Process.put(:fake_module_map_sem_modulos, true)

    assert {:ok, texto} =
             CreateModuleMap.run(
               %{"modules" => [%{"name" => "unico", "stack" => "ts", "responsibility" => "r"}]},
               ctx
             )

    assert texto =~ "unico"
  after
    Process.delete(:fake_module_map_sem_modulos)
  end

  test "erro da api vira tool-result de erro, com o motivo", %{ctx: ctx} do
    Process.put(:fake_module_map_error, :ciclo_de_dependencia)

    assert {:error, texto} = CreateModuleMap.run(%{"modules" => modulos()}, ctx)
    assert texto =~ "falha ao criar module_map"
    assert texto =~ "ciclo_de_dependencia"
  end

  # RN-683 (ADR 0199): o que o módulo declara precisar viaja até a api, e o
  # módulo que não declarou viaja SEM a chave — nunca com um default inventado
  # aqui, porque quem decide o que "não declarou" vale é a api.
  test "`resources` declarado viaja; ausente não ganha chave", %{ctx: ctx} do
    Application.put_env(:engine, :test_pid, self())

    [com, sem] = modulos()
    com = Map.put(com, "resources", %{"cpus" => 1, "memoryMb" => 1024, "pidsLimit" => 128})

    assert {:ok, _} = CreateModuleMap.run(%{"modules" => [com, sem]}, ctx)
    assert_received {:module_map_created, [enviado_com, enviado_sem]}

    assert enviado_com.resources == %{"cpus" => 1, "memoryMb" => 1024, "pidsLimit" => 128}
    refute Map.has_key?(enviado_sem, :resources)
  after
    Application.delete_env(:engine, :test_pid)
  end

  test "o schema pede `resources` por módulo" do
    item = get_in(CreateModuleMap.spec(), [:parameters, "properties", "modules", "items"])
    assert "resources" in item["required"]
    assert item["properties"]["resources"]["required"] == ["cpus", "memoryMb", "pidsLimit"]
  end

  test "sem `modules` nos argumentos, recusa dizendo o que falta", %{ctx: ctx} do
    assert {:error, texto} = CreateModuleMap.run(%{}, ctx)
    assert texto =~ "exige `modules`"
  end
end
