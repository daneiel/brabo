defmodule Engine.Harness.Tools.CreateStory do
  @moduledoc """
  Ferramenta do PO: cria uma história do backlog via a api. A api valida que
  cada `business_rule_id` referencia uma regra de negócio existente e promove a
  story pra `ready` se estiver completa (DoD/DoR/RF/regra). `:direct`, fora do
  `@registry` global.
  """

  @behaviour Engine.Harness.Tool

  alias Engine.Sessions.EngineApiClient

  @impl true
  def spec do
    %{
      name: "create_story",
      description:
        "Cria uma história sob um épico, justificada pelas regras de negócio que a originaram. " <>
          "Preencha DoD, DoR, ao menos 1 RF e ao menos 1 business_rule_id para ela virar 'ready'.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "epic_id" => %{"type" => "string"},
          "title" => %{"type" => "string"},
          "description" => %{"type" => "string"},
          "rf" => %{"type" => "array", "items" => %{"type" => "string"}},
          "rnf" => %{"type" => "array", "items" => %{"type" => "string"}},
          "dod" => %{"type" => "array", "items" => %{"type" => "string"}},
          "dor" => %{"type" => "array", "items" => %{"type" => "string"}},
          "business_rule_ids" => %{"type" => "array", "items" => %{"type" => "string"}}
        },
        "required" => ["epic_id", "title", "business_rule_ids"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(%{"epic_id" => epic_id, "title" => title} = args, ctx) do
    fields = %{
      epicId: epic_id,
      title: title,
      description: Map.get(args, "description", ""),
      rf: list(args, "rf"),
      rnf: list(args, "rnf"),
      dod: list(args, "dod"),
      dor: list(args, "dor"),
      businessRuleIds: list(args, "business_rule_ids")
    }

    case EngineApiClient.create_story(ctx.project_id, ctx.session_id, fields) do
      {:ok, %{"id" => id} = story} ->
        {:ok, "história criada: id=#{id}, #{desfecho(story)}"}

      {:error, reason} ->
        {:error, "falha ao criar história: #{inspect(reason)}"}
    end
  end

  def run(_args, _ctx),
    do: {:error, "create_story exige `epic_id`, `title` e `business_rule_ids`"}

  # O que dizer ao modelo sobre o que aconteceu com a história (Fase 12c).
  #
  # Em projeto no modo `manual` a história NÃO vira `ready` sozinha — ela
  # fica proposta, aguardando o usuário. Se o retorno continuasse dizendo só
  # `status=draft`, o PO concluiria que falhou e tentaria "consertar" uma
  # história que está correta; e se dissesse `ready` estaria mentindo. Daí a
  # frase explícita.
  defp desfecho(%{"proposedReady" => true}),
    do: "está COMPLETA e aguardando a promoção do usuário (o projeto exige aprovação manual)."

  defp desfecho(%{"status" => "ready"}), do: "status=ready."

  defp desfecho(%{"status" => status}),
    do: "status=#{status} — faltam RF, DoD, DoR ou business_rule_ids para ficar completa."

  defp list(args, key) do
    case Map.get(args, key) do
      l when is_list(l) -> l
      _ -> []
    end
  end
end
