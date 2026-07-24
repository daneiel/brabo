defmodule Engine.Anamnese.Tools.EmitProficiency do
  @moduledoc """
  Ferramenta OBRIGATÓRIA da Anamnese (Fase 4b): emite o lote de perfis de
  proficiência da rodada. `:direct` — a Anamnese só LÊ o event log e
  escreve perfil, nunca propõe ação com efeito externo por aqui.

  A api valida contra o GUARDA-CORPO (catálogo de competências
  permitidas — nada de atributo sensível), contra os membros elegíveis
  (quem apagou o perfil não volta a ser perfilado) e contra evidência
  real; qualquer falha rejeita o LOTE INTEIRO e a mensagem volta como
  `{:error, ...}`, que o `ToolLoop` injeta como o próximo tool-result pro
  modelo corrigir — teto de tentativas é o `max_iterations`.
  """

  @behaviour Engine.Harness.Tool

  alias Engine.Sessions.EngineApiClient

  @impl true
  def spec do
    %{
      name: "emit_proficiency",
      description:
        "Registra os perfis de proficiência da rodada. SÓ competências do catálogo " <>
          "permitido (informado no contexto) — nunca inferir saúde, traços pessoais ou " <>
          "qualquer atributo sensível. Toda entrada precisa de evidência apontando para " <>
          "ids de eventos reais do log.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "profiles" => %{
            "type" => "array",
            "items" => %{
              "type" => "object",
              "properties" => %{
                "userId" => %{"type" => "string"},
                "competency" => %{
                  "type" => "string",
                  "description" => "obrigatoriamente uma do catálogo permitido"
                },
                "level" => %{
                  "type" => "string",
                  "enum" => ["iniciante", "intermediario", "avancado"]
                },
                "rationale" => %{
                  "type" => "string",
                  "description" => "o PORQUÊ do nível, em uma ou duas frases"
                },
                "evidenceEventIds" => %{
                  "type" => "array",
                  "items" => %{"type" => "string"}
                }
              },
              "required" => [
                "userId",
                "competency",
                "level",
                "rationale",
                "evidenceEventIds"
              ]
            }
          }
        },
        "required" => ["profiles"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(%{"profiles" => profiles}, ctx) when is_list(profiles) do
    payload = %{
      windowFrom: DateTime.to_iso8601(ctx.window_from),
      windowTo: DateTime.to_iso8601(ctx.window_to),
      eventCount: ctx.event_count,
      profiles: profiles,
      consumedQueueIds: ctx.queued_ids
    }

    case EngineApiClient.record_proficiency(ctx.project_id, ctx.session_id, payload) do
      {:ok, _result} ->
        {:ok, "#{length(profiles)} perfil(is) de proficiência registrado(s)."}

      {:error, reason} ->
        {:error, "perfis rejeitados: #{Engine.Anamnese.Tools.describe(reason)}"}
    end
  end

  def run(_args, _ctx), do: {:error, "emit_proficiency exige `profiles` (lista)"}
end
