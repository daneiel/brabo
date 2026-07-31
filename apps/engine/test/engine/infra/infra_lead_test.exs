defmodule Engine.Infra.InfraLeadTest do
  use ExUnit.Case, async: true

  alias Engine.Infra.InfraLead

  describe "consolidar/2" do
    test "os dois completos: mescla arquivos (lead primeiro, workflows depois) e título" do
      lead =
        {:ok,
         %{
           files: [%{"path" => "Dockerfile", "content" => "FROM node:24"}],
           summary: "infra setup"
         }}

      workflows =
        {:ok,
         %{
           files: [%{"path" => ".github/workflows/ci.yml", "content" => "on: pull_request"}],
           summary: "pipeline de CI"
         }}

      assert {:ok, %{title: title, files: files}} = InfraLead.consolidar(lead, workflows)
      assert title =~ "infra setup"
      assert title =~ "pipeline de CI"

      assert Enum.map(files, & &1["path"]) == [
               "Dockerfile",
               ".github/workflows/ci.yml"
             ]
    end

    test "colisão de path: o arquivo do Workflows vence" do
      lead = {:ok, %{files: [%{"path" => "ci.yml", "content" => "do lead"}], summary: "s"}}

      workflows =
        {:ok, %{files: [%{"path" => "ci.yml", "content" => "do workflows"}], summary: "w"}}

      assert {:ok, %{files: [arquivo]}} = InfraLead.consolidar(lead, workflows)
      assert arquivo["content"] == "do workflows"
    end

    test "nenhum arquivo se perde quando não há colisão nenhuma" do
      lead =
        {:ok,
         %{
           files: [
             %{"path" => "Dockerfile", "content" => "a"},
             %{"path" => "docker-compose.yml", "content" => "b"}
           ],
           summary: "s"
         }}

      workflows =
        {:ok, %{files: [%{"path" => ".github/workflows/ci.yml", "content" => "c"}], summary: "w"}}

      assert {:ok, %{files: files}} = InfraLead.consolidar(lead, workflows)
      assert length(files) == 3
    end

    test "lead bloqueado: nunca abre PR parcial, origem é a do lead" do
      lead =
        {:blocked, %{reason: "sem terminar", diagnosis: "limite de iterações", origin: "modelo"}}

      workflows = {:ok, %{files: [%{"path" => "x", "content" => "y"}], summary: "w"}}

      assert {:blocked, %{origin: "modelo"} = info} = InfraLead.consolidar(lead, workflows)
      assert info.reason =~ "Infra (Dockerfiles/compose)"
    end

    test "workflows bloqueado: nunca abre PR parcial, origem é a do workflows" do
      lead = {:ok, %{files: [%{"path" => "x", "content" => "y"}], summary: "s"}}

      workflows =
        {:blocked, %{reason: "sem terminar", diagnosis: "orçamento esgotado", origin: "politica"}}

      assert {:blocked, %{origin: "politica"} = info} = InfraLead.consolidar(lead, workflows)
      assert info.reason =~ "Workflows (CI)"
    end

    test "os dois bloqueados: origem do lead prevalece, diagnóstico cita os dois" do
      lead = {:blocked, %{reason: "r1", diagnosis: "d1", origin: "infra"}}
      workflows = {:blocked, %{reason: "r2", diagnosis: "d2", origin: "modelo"}}

      assert {:blocked, %{origin: "infra", diagnosis: diagnosis}} =
               InfraLead.consolidar(lead, workflows)

      assert diagnosis =~ "d1"
      assert diagnosis =~ "d2"
    end
  end
end
