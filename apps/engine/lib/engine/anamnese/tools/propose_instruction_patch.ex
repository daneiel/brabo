defmodule Engine.Anamnese.Tools.ProposeInstructionPatch do
  @moduledoc """
  Ferramenta OPCIONAL da Anamnese (Fase 4b): quando o perfil sugere um
  ajuste COM VALOR (ex.: usuário sênior em NestJS → dev-backend para de
  explicar o básico), propõe um patch no arquivo de instrução do agente
  alvo.

  `:direct` com endpoint dedicado (não o `propose_action` genérico)
  porque a api precisa calcular o diff e recusar repropor um patch já
  negado — lógica de domínio que fica testável em TS. A proposed_action
  em si nasce lá dentro, pelo pipeline normal, e NUNCA é auto-aprovável
  (teto em decide.ts): o valor está no usuário ver o diff.
  """

  @behaviour Engine.Harness.Tool

  alias Engine.Sessions.EngineApiClient

  @impl true
  def spec do
    %{
      name: "propose_instruction_patch",
      description:
        "Propõe reescrever o arquivo de instrução de um agente. Envie o CONTEÚDO " <>
          "COMPLETO já ajustado (não um diff) — a api calcula o diff. Use só quando o " <>
          "perfil sugerir um ajuste com valor real; um patch já negado antes é recusado.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "agent" => %{
            "type" => "string",
            "description" =>
              "slug do agente alvo (ex.: dev-api, po, arquiteto). Pode ser um SUBAGENTE de " <>
                "área (ex.: qa-automacao, qa-performance-seguranca, infra-workflows) quando o " <>
                "ajuste é sobre a instrução daquela subespecialidade especificamente, não do " <>
                "lead da área"
          },
          "proposedContent" => %{
            "type" => "string",
            "description" => "conteúdo COMPLETO da instrução já ajustada"
          },
          "rationale" => %{
            "type" => "string",
            "description" => "por que este ajuste ajuda, ancorado no perfil observado"
          },
          "hypothesisId" => %{
            "type" => "string",
            "description" =>
              "id da hipótese aceita que originou este patch, quando houver — dá a " <>
                "rastreabilidade hipótese→patch→versão"
          }
        },
        "required" => ["agent", "proposedContent", "rationale"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(
        %{
          "agent" => agent,
          "proposedContent" => content,
          "rationale" => rationale
        } = args,
        ctx
      ) do
    hypothesis_id = Map.get(args, "hypothesisId")

    with :ok <- validate_hypothesis(hypothesis_id, ctx) do
      payload = %{
        agent: agent,
        proposedContent: content,
        rationale: rationale,
        hypothesisId: hypothesis_id
      }

      propose(agent, payload, ctx)
    end
  end

  def run(_args, _ctx),
    do: {:error, "propose_instruction_patch exige `agent`, `proposedContent` e `rationale`"}

  # O `hypothesisId` só pode ser um dos que ENTRARAM nesta rodada pela fila.
  # Sem esta checagem um id inventado atravessava até
  # `agent_instruction_versions.source_hypothesis_id` e a rastreabilidade
  # hipótese->patch->versão apontava pra nada. A api revalida contra o
  # projeto; aqui a mensagem volta pro modelo corrigir no turno seguinte.
  defp validate_hypothesis(nil, _ctx), do: :ok

  defp validate_hypothesis(hypothesis_id, ctx) do
    queued = Map.get(ctx, :queued_hypothesis_ids, [])

    if hypothesis_id in queued do
      :ok
    else
      {:error,
       "hypothesisId #{inspect(hypothesis_id)} não está entre as hipóteses aceitas desta " <>
         "rodada (#{format_queued(queued)}) — omita o campo ou use um id recebido no contexto"}
    end
  end

  defp format_queued([]), do: "nenhuma"
  defp format_queued(ids), do: Enum.join(ids, ", ")

  defp propose(agent, payload, ctx) do
    case EngineApiClient.propose_instruction_patch(
           ctx.project_id,
           ctx.session_id,
           payload
         ) do
      {:ok, %{"id" => id, "status" => status}} ->
        {:ok,
         "patch de instrução para #{agent} proposto (ação #{id}, status=#{status}) — " <>
           "aguardando o usuário revisar o diff."}

      {:ok, _other} ->
        {:ok, "patch de instrução para #{agent} proposto."}

      {:error, reason} ->
        {:error, "patch recusado: #{Engine.Anamnese.Tools.describe(reason)}"}
    end
  end
end
