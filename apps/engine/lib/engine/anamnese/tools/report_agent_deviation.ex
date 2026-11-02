defmodule Engine.Anamnese.Tools.ReportAgentDeviation do
  @moduledoc """
  O desvio de um AGENTE que a Anamnese viu na janela vira sinal de melhoria do
  PRODUTO (RN-717, ADR 0205): o evento durável `anamnese.agent_deviation`.

  É registro SEPARADO do perfil do usuário e não carrega dado pessoal. O
  payload é montado aqui, por lista de PERMITIDOS: o agente, o tipo de desvio
  (de um vocabulário fechado) e os ids dos eventos que o mostram. Não há campo
  de texto livre de propósito — texto livre é onde o modelo escreveria o nome
  da pessoa ou um traço dela. Sessão e projeto vêm do envelope do evento.

  Não termina a rodada: como `propose_instruction_patch`, vem ANTES do fecho
  (`emit_proficiency` ou `skip_proficiency`). `:direct` — grava um evento, não
  propõe ação com efeito externo.
  """

  @behaviour Engine.Harness.Tool

  alias Engine.Sessions.EngineApiClient

  @tipos ["laco", "cancelamento_pelo_usuario", "reparo_pelo_usuario"]
  @teto_de_evidencias 20

  def tipos, do: @tipos

  @impl true
  def spec do
    %{
      name: "report_agent_deviation",
      description:
        "Registra um desvio de AGENTE visto na janela como sinal de melhoria do " <>
          "produto — nunca como traço da pessoa. Use quando um agente entrou em laço, " <>
          "foi cancelado pelo usuário, ou quando a mensagem do usuário reparou uma " <>
          "falha do agente (ex.: \"não vi o handoff, pode passar?\"). Não leva texto: " <>
          "só o agente, o tipo e os ids dos eventos.",
      parameters: %{
        "type" => "object",
        "properties" => %{
          "agente" => %{"type" => "string", "description" => "id do agente que desviou"},
          "tipo" => %{"type" => "string", "enum" => @tipos},
          "evidenceEventIds" => %{"type" => "array", "items" => %{"type" => "string"}}
        },
        "required" => ["agente", "tipo", "evidenceEventIds"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(args, ctx) do
    with {:ok, payload} <- payload(args) do
      case EngineApiClient.append_event(ctx.project_id, ctx.session_id, %{
             type: "anamnese.agent_deviation",
             actorKind: "agent",
             actorId: "anamnese",
             payload: payload
           }) do
        {:error, reason} ->
          {:error, "desvio não registrado: #{Engine.Anamnese.Tools.describe(reason)}"}

        _ ->
          {:ok, "desvio de #{payload.agente} (#{payload.tipo}) registrado."}
      end
    end
  end

  @doc """
  Monta o payload por lista de PERMITIDOS — tudo que não for agente, tipo e
  evidência é descartado, inclusive campo extra que o modelo invente.
  """
  def payload(%{"agente" => agente, "tipo" => tipo, "evidenceEventIds" => ids})
      when is_binary(agente) and agente != "" and is_list(ids) do
    ids = Enum.filter(ids, &(is_binary(&1) and &1 != ""))

    cond do
      tipo not in @tipos ->
        {:error, "tipo de desvio inválido — use #{Enum.join(@tipos, " | ")}"}

      ids == [] ->
        {:error, "desvio sem evidência (evidenceEventIds vazio)"}

      true ->
        {:ok,
         %{
           agente: agente,
           tipo: tipo,
           evidenceEventIds: Enum.take(Enum.uniq(ids), @teto_de_evidencias)
         }}
    end
  end

  def payload(_args),
    do: {:error, "report_agent_deviation exige `agente`, `tipo` e `evidenceEventIds`"}
end
