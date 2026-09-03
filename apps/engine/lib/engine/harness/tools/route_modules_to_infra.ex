defmodule Engine.Harness.Tools.RouteModulesToInfra do
  @moduledoc """
  Ferramenta do Arquiteto: roteia CADA módulo do `module_map` vigente para uma
  imagem de container CANDIDATA, com o porquê (ADR 0131).

  Arquiteto candidata, Infra elege — a escolha final entre as candidatas (ou a
  recusa de todas) é do Infra Lead, num PR à parte; esta ferramenta só produz
  a lista de candidaturas. A api valida (módulo existente no module_map
  vigente; imagem com tag/digest explícito, `latest` recusado, `rationale`
  real — mesma regra de `choose_project_image`, aplicada por item) e a recusa
  volta pelo tool-result com o motivo inteiro — RN-061, o mesmo mecanismo que
  faz o Arquiteto corrigir um `module_map` com ciclo em vez de reemitir igual.

  `:direct`, fora do `@registry` global: rotear é decisão interna do
  Arquiteto, sem efeito externo, e não vira `proposed_action`.
  """

  @behaviour Engine.Harness.Tool

  alias Engine.Sessions.EngineApiClient

  @impl true
  def spec do
    %{
      name: "route_modules_to_infra",
      description:
        "Roteia CADA módulo do module_map vigente para uma imagem de container " <>
          "CANDIDATA — um item por módulo, com uma referência OCI com TAG explícita " <>
          "(`latest` é recusado) e o porquê dessa imagem para ESTE módulo. Você " <>
          "candidata; quem elege entre as candidatas é a Infra, depois. Exige que " <>
          "create_module_map já tenha rodado nesta sessão: não há módulo sem " <>
          "module_map.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "roteamento" => %{
            "type" => "array",
            "description" =>
              "Um item por módulo do module_map vigente. Módulo fora do mapa, " <>
                "módulo repetido ou lista vazia são recusados.",
            "items" => %{
              "type" => "object",
              "properties" => %{
                "modulo" => %{
                  "type" => "string",
                  "description" => "Nome do módulo — precisa existir no module_map vigente."
                },
                "imagemCandidata" => %{
                  "type" => "string",
                  "description" =>
                    "Referência OCI com TAG ou digest, ex.: \"node:22-bookworm-slim\"."
                },
                "porque" => %{
                  "type" => "string",
                  "description" => "Por que ESTA imagem para ESTE módulo. Mínimo 10 caracteres."
                }
              },
              "required" => ["modulo", "imagemCandidata", "porque"]
            }
          }
        },
        "required" => ["roteamento"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(%{"roteamento" => roteamento} = _args, ctx) when is_list(roteamento) do
    normalizado = Enum.map(roteamento, &normalize/1)

    case EngineApiClient.route_modules_to_infra(ctx.project_id, ctx.session_id, normalizado) do
      {:ok, %{"version" => version, "roteamento" => rotas}} ->
        modulos = Enum.map_join(rotas, ", ", &Map.get(&1, "modulo", "?"))

        {:ok,
         "roteamento fixado (version #{version}): #{length(rotas)} módulo(s) — " <>
           "#{modulos}. A Infra elege entre as candidatas."}

      {:ok, _outro} ->
        {:ok, "roteamento fixado."}

      {:error, reason} ->
        {:error, "roteamento recusado: #{inspect(reason)}"}
    end
  end

  def run(_args, _ctx),
    do:
      {:error,
       "route_modules_to_infra exige `roteamento` (lista de {modulo, imagemCandidata, porque})"}

  # Mapeia as chaves do tool call (string, do LLM) para o corpo que a api
  # espera — mesmo padrão de `CreateModuleMap.normalize/1`: explícito por
  # campo, com default vazio para o que faltar, em vez de repassar o map cru
  # e depender de o modelo ter usado exatamente as chaves certas.
  defp normalize(item) do
    %{
      modulo: Map.get(item, "modulo", ""),
      imagemCandidata: Map.get(item, "imagemCandidata", ""),
      porque: Map.get(item, "porque", "")
    }
  end
end
