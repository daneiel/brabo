defmodule Engine.Harness.Tools.ChooseProjectImage do
  @moduledoc """
  Ferramenta do Arquiteto: decide QUAL IMAGEM de container sobe para o projeto
  (FASE 25a, ADR 0065).

  É decisão de arquitetura, não configuração: quem escolhe a imagem escolhe o
  runtime, o gerenciador de pacotes e o compilador que o agente vai ter dentro
  do container — e portanto o que ele consegue fazer. Por isso sai como
  artefato versionado no event log, ao lado do `module_map`, e não como
  variável de ambiente.

  A api valida (tag explícita, `latest` recusado, teto de recursos) e a recusa
  volta pelo tool-result com o motivo inteiro — RN-061, o mesmo mecanismo que
  faz o Arquiteto corrigir um `module_map` com ciclo em vez de reemitir igual.
  `:direct`, fora do `@registry` global.
  """

  @behaviour Engine.Harness.Tool

  alias Engine.Sessions.EngineApiClient

  @impl true
  def spec do
    %{
      name: "choose_project_image",
      description:
        "Fixa a imagem de container em que o código deste projeto vai rodar. " <>
          "Enquanto você não decidir, o container do projeto NÃO sobe e a aba Code " <>
          "fica fechada. Use uma referência com TAG explícita (`latest` é recusado). " <>
          "`network` default é \"none\" (sem internet dentro do container); peça " <>
          "\"egress\" só quando a stack precisar baixar dependências, porque quem " <>
          "autoriza saída para a internet é o usuário.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "image" => %{
            "type" => "string",
            "description" => "Referência OCI com tag ou digest, ex.: \"node:22-bookworm-slim\"."
          },
          "rationale" => %{
            "type" => "string",
            "description" => "Por que ESTA imagem para este module_map. Mínimo 10 caracteres."
          },
          "network" => %{
            "type" => "string",
            "enum" => ["none", "egress"],
            "description" => "Postura de rede do container. Default \"none\"."
          },
          "resources" => %{
            "type" => "object",
            "description" => "Teto de recursos: cpus, memoryMb, pidsLimit. Omitir usa o padrão.",
            "properties" => %{
              "cpus" => %{"type" => "number"},
              "memoryMb" => %{"type" => "number"},
              "pidsLimit" => %{"type" => "number"}
            }
          }
        },
        "required" => ["image", "rationale"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(%{"image" => image} = args, ctx) when is_binary(image) do
    payload = %{
      image: image,
      rationale: Map.get(args, "rationale", ""),
      network: Map.get(args, "network", "none"),
      resources: Map.get(args, "resources", %{})
    }

    case EngineApiClient.decide_project_image(ctx.project_id, ctx.session_id, payload) do
      {:ok, %{"version" => version, "decisao" => decisao}} ->
        {:ok,
         "imagem do projeto fixada (version #{version}): #{Map.get(decisao, "image")}, " <>
           "rede #{Map.get(decisao, "network")}. A aba Code está liberada."}

      {:ok, _outro} ->
        {:ok, "imagem do projeto fixada."}

      {:error, reason} ->
        {:error, "imagem recusada: #{inspect(reason)}"}
    end
  end

  def run(_args, _ctx),
    do: {:error, "choose_project_image exige `image` (string) e `rationale` (string)"}
end
