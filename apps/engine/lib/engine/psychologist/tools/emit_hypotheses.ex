defmodule Engine.Psychologist.Tools.EmitHypotheses do
  @moduledoc """
  Ferramenta OBRIGATÓRIA do Psicólogo (Fase 4b): emite o lote de
  hipóteses estruturadas. `:direct` — vai direto pra api, sem
  proposed_action (o Psicólogo é só leitura, nunca propõe ação com
  efeito externo).

  A api VALIDA que toda `evidenciaEventIds` aponta pra um event id real
  da sessão analisada e rejeita o LOTE INTEIRO se qualquer uma falhar
  (mesma disciplina de `emit_artifact`/`emit_qa_verdict`). A mensagem de
  rejeição volta como `{:error, msg}` — que o `ToolLoop` injeta como o
  próximo `tool`-result pro modelo corrigir. O teto de tentativas é o
  `max_iterations` do ctx (ver `Engine.Psychologist.Triage`), sem
  nenhum subsistema de retry novo.
  """

  @behaviour Engine.Harness.Tool

  alias Engine.Sessions.EngineApiClient

  @impl true
  def spec do
    %{
      name: "emit_hypotheses",
      description:
        "Registra as hipóteses da análise. TODA hipótese precisa de evidência apontando " <>
          "para ids de eventos REAIS do log desta sessão — hipótese sem evidência válida é " <>
          "rejeitada e precisa ser corrigida.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "hypotheses" => %{
            "type" => "array",
            "items" => %{
              "type" => "object",
              "properties" => %{
                "agenteAlvo" => %{
                  "type" => "string",
                  "description" => "id do agente sobre quem é a hipótese (ex.: dev-api, po)"
                },
                "observacao" => %{"type" => "string"},
                "hipotese" => %{"type" => "string"},
                "sugestao" => %{"type" => "string"},
                "confiancaPercent" => %{
                  "type" => "integer",
                  "description" => "confiança de 0 a 100"
                },
                "evidenceEventIds" => %{
                  "type" => "array",
                  "items" => %{"type" => "string"},
                  "description" => "ids de eventos do log desta sessão que sustentam a hipótese"
                },
                "terminationAnalysis" => %{
                  "type" => "object",
                  "description" =>
                    "obrigatório em ao menos uma hipótese quando a sessão terminou anormalmente",
                  "properties" => %{
                    "causa" => %{"type" => "string"},
                    "estadoDaSessao" => %{"type" => "string"},
                    "analise" => %{"type" => "string"}
                  },
                  "required" => ["causa", "estadoDaSessao", "analise"]
                }
              },
              "required" => [
                "agenteAlvo",
                "observacao",
                "hipotese",
                "sugestao",
                "confiancaPercent",
                "evidenceEventIds"
              ]
            }
          }
        },
        "required" => ["hypotheses"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(%{"hypotheses" => hypotheses}, ctx) when is_list(hypotheses) do
    case EngineApiClient.propose_hypotheses(
           ctx.project_id,
           ctx.session_id,
           to_string(ctx.tier),
           ctx.triggered_by,
           ctx.event_count,
           to_string(ctx.cause),
           hypotheses
         ) do
      {:ok, _result} ->
        {:ok, "#{length(hypotheses)} hipótese(s) registrada(s) com evidência válida."}

      {:error, reason} ->
        {:error, "hipóteses rejeitadas: #{describe(reason)}"}
    end
  end

  def run(_args, _ctx), do: {:error, "emit_hypotheses exige `hypotheses` (lista)"}

  # A mensagem da api (4xx) é o que guia a correção do modelo — extrai o
  # texto útil em vez de despejar o tuple cru.
  defp describe({_status, %{"message" => message}}) when is_binary(message), do: message
  defp describe({_status, %{"message" => [message | _]}}) when is_binary(message), do: message
  defp describe(reason), do: inspect(reason)
end
