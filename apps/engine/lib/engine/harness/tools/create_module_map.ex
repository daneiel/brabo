defmodule Engine.Harness.Tools.CreateModuleMap do
  @moduledoc """
  Ferramenta do Arquiteto: define/atualiza o module_map do projeto via a api. A
  api valida contra ciclos de dependência (recusa → tool-result de erro) e
  revalida as stories `ready`. `:direct`, fora do `@registry` global.

  Desde a RN-683 (ADR 0199) cada módulo DECLARA `resources` — o que ele precisa
  sozinho dentro do container (cpus, memoryMb, pidsLimit). A Infra sobe o
  container com a SOMA entre módulos (todos dividem um container), então o
  mínimo da subida vem daqui e não de um preset. O campo é pedido no schema; a
  api aceita módulo sem ele (conta com o padrão de hoje como piso) e recusa
  declaração pela metade ou soma acima do teto, com o motivo no tool-result.
  """

  @behaviour Engine.Harness.Tool

  alias Engine.Sessions.EngineApiClient

  @impl true
  def spec do
    %{
      name: "create_module_map",
      description:
        "Define o mapa de módulos do projeto (rejeitado se tiver ciclo de dependência). " <>
          "Cada módulo: name, stack, responsibility, depends_on (nomes de outros módulos) e " <>
          "resources — o que ESTE módulo precisa sozinho no container (cpus, memoryMb, " <>
          "pidsLimit). Todos os módulos dividem UM container e a Infra o sobe com a SOMA, " <>
          "então declare o mínimo real de cada um; a soma não pode passar de 8 cpus, " <>
          "16384 MiB e 4096 pids.",
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
                "depends_on" => %{"type" => "array", "items" => %{"type" => "string"}},
                "resources" => %{
                  "type" => "object",
                  "description" => "O mínimo deste módulo sozinho, com os três campos.",
                  "properties" => %{
                    "cpus" => %{"type" => "number"},
                    "memoryMb" => %{"type" => "number"},
                    "pidsLimit" => %{"type" => "number"}
                  },
                  "required" => ["cpus", "memoryMb", "pidsLimit"]
                }
              },
              "required" => ["name", "stack", "responsibility", "resources"]
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
      {:ok, %{"version" => version} = map} ->
        # O resultado devolve os nomes CANÔNICOS, como a api os gravou.
        #
        # Enquanto era só "module_map criado (version 1)", o Arquiteto escrevia
        # o mapa e no passo seguinte não sabia mais como chamar os módulos —
        # `assign_story_modules` exige os nomes e não existe ferramenta para
        # relê-los. O desfecho observado foi adivinhação por força bruta.
        #
        # Ecoar o que foi gravado (e não o que foi enviado) também expõe
        # qualquer normalização que a api tenha feito no nome.
        {:ok, "module_map criado (version #{version}). Módulos: #{nomes(map, normalized)}."}

      {:error, reason} ->
        {:error, "falha ao criar module_map: #{inspect(reason)}"}
    end
  end

  def run(_args, _ctx), do: {:error, "create_module_map exige `modules` (lista)"}

  # Nomes do mapa que a api devolveu; cai para os enviados se a resposta não
  # trouxer os módulos — melhor um eco aproximado do que nenhum.
  defp nomes(%{"modules" => modules}, _enviados) when is_list(modules) do
    modules
    |> Enum.map(&Map.get(&1, "name"))
    |> Enum.reject(&is_nil/1)
    |> Enum.join(", ")
  end

  defp nomes(_resposta, enviados), do: Enum.map_join(enviados, ", ", & &1.name)

  # Mapeia depends_on (snake, do LLM) → dependsOn (camel, da api). `resources`
  # só viaja quando o modelo o mandou: ausente é "não declarou" (RN-683), e
  # quem decide o que isso vale é a api, nunca um default inventado aqui.
  defp normalize(m) do
    base = %{
      name: Map.get(m, "name"),
      stack: Map.get(m, "stack", ""),
      responsibility: Map.get(m, "responsibility", ""),
      dependsOn: Map.get(m, "depends_on", [])
    }

    case Map.get(m, "resources") do
      nil -> base
      resources -> Map.put(base, :resources, resources)
    end
  end
end
