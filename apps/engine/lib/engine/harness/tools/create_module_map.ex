defmodule Engine.Harness.Tools.CreateModuleMap do
  @moduledoc """
  Ferramenta do Arquiteto: define/atualiza o module_map do projeto via a api. A
  api valida contra ciclos de dependência (recusa → tool-result de erro) e
  revalida as stories `ready`. `:direct`, fora do `@registry` global.
  """

  @behaviour Engine.Harness.Tool

  alias Engine.Sessions.EngineApiClient

  @impl true
  def spec do
    %{
      name: "create_module_map",
      description:
        "Define o mapa de módulos do projeto (rejeitado se tiver ciclo de dependência). " <>
          "Cada módulo: name, stack, responsibility, depends_on (nomes de outros módulos).",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "modules" => %{
            "type" => "array",
            "items" => %{
              "type" => "object",
              "properties" => %{
                "name" => %{"type" => "string"},
                "stack" => %{"type" => "string"},
                "responsibility" => %{"type" => "string"},
                "depends_on" => %{"type" => "array", "items" => %{"type" => "string"}}
              },
              "required" => ["name", "stack", "responsibility"]
            }
          }
        },
        "required" => ["modules"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(%{"modules" => modules}, ctx) when is_list(modules) do
    normalized = Enum.map(modules, &normalize/1)

    case EngineApiClient.create_module_map(ctx.project_id, ctx.session_id, normalized) do
      {:ok, %{"version" => version}} ->
        {:ok, "module_map criado (version #{version})."}

      {:error, reason} ->
        {:error, "falha ao criar module_map: #{inspect(reason)}"}
    end
  end

  def run(_args, _ctx), do: {:error, "create_module_map exige `modules` (lista)"}

  # Mapeia depends_on (snake, do LLM) → dependsOn (camel, da api).
  defp normalize(m) do
    %{
      name: Map.get(m, "name"),
      stack: Map.get(m, "stack", ""),
      responsibility: Map.get(m, "responsibility", ""),
      dependsOn: Map.get(m, "depends_on", [])
    }
  end
end
