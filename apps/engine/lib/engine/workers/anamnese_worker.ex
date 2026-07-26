defmodule Engine.Workers.AnamneseWorker do
  @moduledoc """
  Uma rodada da Anamnese pra UM projeto (Fase 4b) — enfileirado pelo
  `AnamneseSchedulerWorker` (tick periódico) ou manualmente.

  Analisa a janela do event log desde a última rodada (interações do
  usuário: linguagem, correções nos agentes, o que aprova/nega, nível das
  perguntas), mantém o `proficiency_profile` por usuário+competência e,
  quando o perfil sugere um ajuste com valor, propõe um
  `instruction_patch`.

  **Pula sem gastar nada** quando não há material novo (ver
  `Engine.Anamnese.Triage.should_run?/2`) — mas hipótese aceita na fila
  SEMPRE força a rodada, senão o loop fechado do Psicólogo nunca
  completaria. Rodada que não conclui não grava `anamnese_runs`, então a
  janela é reprocessada na próxima (mesma disciplina do Psicólogo).
  """

  use Oban.Worker, queue: :default, max_attempts: 3

  require Logger

  alias Engine.Anamnese.{ContextBuilder, Tools, Triage}
  alias Engine.Anamnese.Hooks.Termination
  alias Engine.Harness.Hooks
  alias Engine.Harness.Hooks.EventLog
  alias Engine.Harness.ToolLoop
  alias Engine.Sessions.EngineApiClient

  @impl true
  def perform(%Oban.Job{args: %{"project_id" => project_id} = args}) do
    session_id = Map.get(args, "session_id")

    case ContextBuilder.fetch(project_id) do
      {:ok, context} ->
        maybe_analyze(project_id, session_id, context)

      {:error, reason} ->
        # PRECISA ser `{:error, _}`: `:ok` marcaria o job `completed` e a
        # rodada do projeto sumiria em silêncio até o próximo tick, deixando o
        # `max_attempts: 3` como peso morto neste branch. Sem narrar
        # `anamnese.run_failed` aqui de propósito — o caminho de narração é a
        # própria api, que é justamente quem está fora.
        {:error, reason}
    end
  end

  # Sem sessão pra atribuir eventos/custo, a rodada não tem onde narrar —
  # o scheduler escolhe a sessão; se não houver nenhuma no projeto, não
  # há nada a analisar mesmo.
  defp maybe_analyze(_project_id, nil, _context), do: :ok

  defp maybe_analyze(project_id, session_id, context) do
    # Contagem REAL da janela, não o tamanho do recorte que vai no prompt.
    event_count = context.total_event_count
    queued_count = length(context.queued_hypotheses)
    decision_count = length(context.decisions)

    if Triage.should_run?(event_count, queued_count, decision_count) do
      analyze(project_id, session_id, context, event_count)
    else
      # Pular é legítimo e frequente (um tick a cada 15 min por projeto), então
      # NÃO vira evento no log — seria ruído. Mas precisa deixar rastro: uma
      # rodada pulada sem nada narrado é indiagnosticável, e foi exatamente o
      # que escondeu a janela truncada.
      Logger.info(
        "anamnese: rodada pulada em #{project_id} — " <>
          "#{event_count} evento(s), #{decision_count} decisão(ões), " <>
          "#{queued_count} hipótese(s) na fila (mínimo #{Triage.min_events()})"
      )

      :ok
    end
  end

  defp analyze(project_id, session_id, context, event_count) do
    project_id
    |> build_ctx(session_id, context, event_count)
    |> ToolLoop.run()
    |> handle_outcome(project_id, session_id)
  end

  defp handle_outcome({:halted, {"emit_proficiency", _}, _ctx}, _project_id, _session_id),
    do: :ok

  defp handle_outcome(outcome, project_id, session_id) do
    emit_failure(project_id, session_id, reason_for(outcome))
    :ok
  end

  defp reason_for({:limit_reached, _ctx}), do: "limite de iterações"
  defp reason_for({:budget_exceeded, _ctx}), do: "orçamento excedido"

  # `{:ok, ctx}` com `:last_error` é falha de INFRAESTRUTURA (provider fora,
  # timeout, erro no corpo da resposta), não o modelo desistindo. Sem olhar
  # isso, um provider caído era narrado como "encerrou sem emitir perfis" e o
  # operador não tinha nada em que agir — mesma armadilha já fechada no QA, no
  # Dev e no Psicólogo.
  defp reason_for({:ok, ctx}) do
    case Map.get(ctx, :last_error) do
      nil -> "encerrou sem emitir perfis"
      error -> "falha no provider: #{error}"
    end
  end

  defp reason_for(_other), do: "desfecho inesperado"

  defp emit_failure(project_id, session_id, reason) do
    EngineApiClient.append_event(project_id, session_id, %{
      type: "anamnese.run_failed",
      actorKind: "agent",
      actorId: Triage.agent(),
      payload: %{reason: reason}
    })
  end

  defp build_ctx(project_id, session_id, context, event_count) do
    %{
      project_id: project_id,
      session_id: session_id,
      agent: Triage.agent(),
      tools: Tools.registry(),
      hooks: anamnese_hooks(),
      messages: [initial_message(context)],
      context_window: 128_000,
      max_iterations: Triage.max_iterations(),
      token_budget_micros: Triage.token_budget_micros(),
      # Lidos pelas tools na hora de chamar a api.
      window_from: context.window_from,
      window_to: context.window_to,
      event_count: event_count,
      # Ids das HIPÓTESES (não das linhas da fila): é o `hypothesisId` que o
      # prompt oferece ao modelo e que o patch precisa carregar. A linha da
      # fila é consumida pela api a partir dele, quando o patch nasce — o
      # engine não mexe mais em id de fila.
      queued_hypothesis_ids:
        context.queued_hypotheses
        |> Enum.map(& &1["hypothesisId"])
        |> Enum.reject(&is_nil/1)
    }
  end

  # Sem `:pre_tool_use`: as duas tools da Anamnese são `:direct` e nenhuma se
  # chama `terminal`/`write_file`, que é tudo que o ActionPipeline reconhece —
  # registrá-lo era no-op permanente (mesmo caso já removido no Psicólogo).
  defp anamnese_hooks do
    Hooks.new()
    |> Hooks.register(:post_tool_use, EventLog)
    |> Hooks.register(:post_tool_use, Termination)
  end

  defp initial_message(context) do
    %{
      "role" => "user",
      "content" => """
      Analise a janela do log abaixo e mantenha o perfil de proficiência dos
      membros deste projeto. Observe as INTERAÇÕES DO USUÁRIO: a linguagem que
      usa, as correções que faz nos agentes, o que aprova ou nega, e o nível das
      perguntas que faz.

      REGRAS INEGOCIÁVEIS:
      - Só competências do catálogo abaixo. NUNCA infira saúde, traços de
        personalidade, idade, gênero ou qualquer característica pessoal — perfis
        com competência fora do catálogo são rejeitados.
      - Toda entrada precisa de evidência apontando para ids de eventos REAIS
        da janela, e de um `rationale` explicando o porquê do nível.
      - Feche a rodada com UMA chamada de `emit_proficiency`.
      #{queued_instruction(context.queued_hypotheses)}

      CATÁLOGO DE COMPETÊNCIAS PERMITIDAS:
      #{format_list(context.competency_catalog)}

      MEMBROS ELEGÍVEIS:
      #{format_members(context.members)}

      PERFIS ATUAIS (revise, não duplique):
      #{format_profiles(context.current_profiles)}

      #{format_instructions(context.instructions)}
      #{format_decisions(context.decisions)}
      JANELA DO LOG (#{DateTime.to_iso8601(context.window_from)} → #{DateTime.to_iso8601(context.window_to)})#{omission_note(context)}:
      #{format_events(context.events)}
      """,
      :pinned => true
    }
  end

  defp queued_instruction([]), do: ""

  defp queued_instruction(queued) do
    """

    HIPÓTESES ACEITAS PELO USUÁRIO (input PRIORIZADO — trate como sinal forte):
    #{Enum.map_join(queued, "\n", &format_queued/1)}

    Se alguma delas sugerir um ajuste com valor real no arquivo de instrução do
    agente alvo, chame `propose_instruction_patch` ANTES de fechar a rodada,
    passando o `hypothesisId` correspondente.
    """
  end

  defp format_queued(q) do
    "- [#{q["agenteAlvo"]}] (#{q["hypothesisId"]}) #{q["hipotese"]} — sugestão: #{q["sugestao"]} (confiança #{q["confiancaPercent"]}%)"
  end

  defp format_list([]), do: "(nenhuma)"
  defp format_list(items), do: Enum.map_join(items, "\n", &"- #{&1}")

  defp format_members([]), do: "(nenhum membro elegível)"

  defp format_members(members) do
    Enum.map_join(members, "\n", fn m ->
      "- #{m["userId"]} | #{m["name"] || m["email"]} | papel=#{m["role"]}"
    end)
  end

  defp format_profiles([]), do: "(nenhum ainda)"

  defp format_profiles(profiles) do
    Enum.map_join(profiles, "\n", fn p ->
      "- #{p["userId"]} | #{p["competency"]} = #{p["level"]} (#{p["rationale"]})"
    end)
  end

  defp format_instructions([]), do: ""

  defp format_instructions(instructions) do
    """
    INSTRUÇÕES VIGENTES DOS AGENTES ALVO:
    #{Enum.map_join(instructions, "\n\n", fn i -> "### #{i["agent"]} (v#{i["version"]})\n#{i["content"]}" end)}
    """
  end

  # As decisões NÃO estão no event log (moram em proposed_actions), e o motivo
  # de uma negação é o sinal mais rico da janela: diz o que a pessoa achou
  # errado, com as palavras dela.
  defp format_decisions([]), do: ""

  defp format_decisions(decisions) do
    """

    DECISÕES DO USUÁRIO NA JANELA (o que aprovou e negou — e por quê):
    #{Enum.map_join(decisions, "\n", &format_decision/1)}
    """
  end

  defp format_decision(d) do
    base = "- #{d["decidedAt"]} | #{d["decidedBy"]} | #{d["status"]} #{d["actionType"]}"

    case d["rejectionReason"] do
      nil -> base
      "" -> base
      motivo -> base <> " — motivo: #{motivo}"
    end
  end

  # O corte tem que ser VISÍVEL pro modelo: ele só pode citar ids que vê, e
  # sem a nota concluiria que a janela inteira cabe no que leu.
  defp omission_note(context) do
    omitidos = context.total_event_count - length(context.events)

    if omitidos > 0 do
      " — só os #{length(context.events)} mais recentes de #{context.total_event_count};" <>
        " #{omitidos} evento(s) mais antigo(s) omitido(s), cite apenas ids presentes abaixo"
    else
      ""
    end
  end

  defp format_events([]), do: "(nenhum evento na janela)"

  defp format_events(events) do
    Enum.map_join(events, "\n", fn e ->
      "#{DateTime.to_iso8601(e.created_at)} | #{e.id} | #{e.type} | " <>
        "#{e.actor_kind}:#{e.actor_id} | #{format_payload(e.payload)}"
    end)
  end

  # Payload de `agent.response`/`tool.result` carrega turno de LLM inteiro —
  # sem corte, meia dúzia deles come a janela de contexto sozinha. O id fica
  # intacto (é o que a evidência cita); só o payload é truncado.
  defp format_payload(payload) do
    texto = inspect(payload)
    teto = Triage.max_payload_chars()

    if String.length(texto) > teto do
      String.slice(texto, 0, teto) <> "… (payload truncado)"
    else
      texto
    end
  end
end
