defmodule Engine.Agents.CatalogoDeFerramentasTest do
  # AT-686 (RN-995): o catálogo bate com a fonte de cada servidor e de cada registro.
  use EngineWeb.ConnCase, async: true

  alias Engine.Agents.CatalogoDeFerramentas

  test "bate com o tool_specs/0 dos 7 conversacionais e com os registros" do
    por_agente = Map.new(CatalogoDeFerramentas.listar(), &{&1.agente, &1})

    esperado = %{
      "criativo" => Engine.Agents.CriativoServer.tool_specs(),
      "po" => Engine.Agents.PoServer.tool_specs(),
      "arquiteto" => Engine.Agents.ArquitetoServer.tool_specs(),
      "dev-lead" => Engine.Agents.DevLeadServer.tool_specs(),
      "ux-designer" => Engine.Agents.UxDesignerServer.tool_specs(),
      "staff" => Engine.Agents.StaffServer.tool_specs(),
      "infra-lead" => Engine.Infra.InfraLeadServer.tool_specs(),
      "dev-*" => Engine.Harness.Tools.specs(Engine.Dev.Tools.registry()),
      "qa-automacao" => Engine.Harness.Tools.specs(Engine.Gates.QaTools.registry()),
      "appsec" => Engine.Harness.Tools.specs(Engine.Gates.AppSecAgent.tools()),
      "infra-workflows" => Engine.Harness.Tools.specs(Engine.Infra.WorkflowsAgent.tools())
    }

    for {slug, specs} <- esperado do
      assert Enum.map(por_agente[slug].ferramentas, & &1.nome) == Enum.map(specs, & &1.name)
      assert is_binary(por_agente[slug].identidade)
    end

    refute inspect(por_agente) =~ "parameters"
  end

  test "descrição tem teto de 1000 caracteres" do
    for a <- CatalogoDeFerramentas.listar(), f <- a.ferramentas do
      assert String.length(f.descricao) <= 1_000
    end
  end

  test "rota exige o service token e devolve o catálogo", %{conn: conn} do
    assert get(conn, "/internal/agents/catalog").status == 401

    token = Application.fetch_env!(:engine, :service_token)

    resp =
      conn
      |> put_req_header("x-brabo-service-token", token)
      |> get("/internal/agents/catalog")
      |> json_response(200)

    assert length(resp["agentes"]) == 13
  end
end
