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
            "description" => "slug do agente alvo (ex.: dev-api, po, arquiteto)"
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
    payload = %{
      agent: agent,
      proposedContent: content,
      rationale: rationale,
      hypothesisId: Map.get(args, "hypothesisId")
    }

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

  def run(_args, _ctx),
    do: {:error, "propose_instruction_patch exige `agent`, `proposedContent` e `rationale`"}
end
