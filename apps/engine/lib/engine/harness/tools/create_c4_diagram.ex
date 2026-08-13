defmodule Engine.Harness.Tools.CreateC4Diagram do
  @moduledoc """
  Ferramenta do Arquiteto: gera o diagrama C4 (modelo de Simon Brown —
  Context + Container) da arquitetura, a partir do `module_map` vigente do
  projeto. A api valida (`system_name` obrigatório, `type` de ator dentro do
  enum) e RECUSA se não houver module_map ainda (tool-result de erro — RN-061,
  o mesmo mecanismo de `create_module_map`/`choose_project_image`).

  O nível Container NÃO é redigitado aqui: ele é DERIVADO do module_map
  vigente pela api, com os mesmos módulos e dependências que
  `create_module_map` já validou sem ciclo. Só o nível Context (nome/
  descrição do sistema e os atores externos) vem deste tool call — é
  julgamento do Arquiteto, sem fonte de verdade para derivar sozinho.

  `:direct`, fora do `@registry` global.
  """

  @behaviour Engine.Harness.Tool

  alias Engine.Sessions.EngineApiClient

  @impl true
  def spec do
    %{
      name: "create_c4_diagram",
      description:
        "Gera o diagrama C4 (Context + Container) da arquitetura deste projeto. " <>
          "O nível Container vem do module_map que você já definiu (create_module_map) " <>
          "— não descreva os módulos de novo aqui. Descreva só o sistema e os atores " <>
          "externos do nível Context (ex.: o usuário, um provedor de Git). Exige " <>
          "module_map vigente: sem ele, é recusado.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "system_name" => %{
            "type" => "string",
            "description" => "Nome do sistema/projeto, para o rótulo do diagrama."
          },
          "system_description" => %{
            "type" => "string",
            "description" => "Uma frase sobre o que o sistema faz."
          },
          "actors" => %{
            "type" => "array",
            "description" =>
              "Atores externos do nível Context: quem usa o sistema ou com quem ele conversa.",
            "items" => %{
              "type" => "object",
              "properties" => %{
                "name" => %{"type" => "string"},
                "type" => %{
                  "type" => "string",
                  "enum" => ["person", "external_system"],
                  "description" =>
                    "\"person\" (default) para quem opera o sistema; \"external_system\" " <>
                      "para outro sistema com o qual ele conversa."
                },
                "description" => %{"type" => "string"}
              },
              "required" => ["name"]
            }
          }
        },
        "required" => ["system_name"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(%{"system_name" => system_name} = args, ctx) when is_binary(system_name) do
    entrada = %{
      systemName: system_name,
      systemDescription: Map.get(args, "system_description", ""),
      actors: Enum.map(Map.get(args, "actors", []), &normalize_actor/1)
    }

    case EngineApiClient.create_c4_diagram(ctx.project_id, ctx.session_id, entrada) do
      {:ok, %{"version" => version}} ->
        {:ok,
         "diagrama C4 gerado (version #{version}): Context + Container. " <>
           "Visível na Visão Geral do projeto."}

      {:ok, _outro} ->
        {:ok, "diagrama C4 gerado."}

      {:error, reason} ->
        {:error, "falha ao gerar diagrama C4: #{inspect(reason)}"}
    end
  end

  def run(_args, _ctx), do: {:error, "create_c4_diagram exige `system_name` (string)"}

  defp normalize_actor(a) do
    %{
      name: Map.get(a, "name"),
      type: Map.get(a, "type", "person"),
      description: Map.get(a, "description", "")
    }
  end
end
