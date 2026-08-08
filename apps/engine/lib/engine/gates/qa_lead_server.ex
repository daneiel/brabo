defmodule Engine.Gates.QaLeadServer do
  @moduledoc """
  QA Lead (Fase 8b, ADR 0038) — assume o papel que o `QAAgent` da Fase 4a
  tinha sozinho: um processo por projeto (`Engine.Gates.Registry`, chave
  `{project_id, "qa"}` — MESMA chave de antes, então `Engine.Gates.Dispatcher`
  não precisa saber que a área existe), único ponto de contato do gate
  `awaiting_qa`.

  Decide a quem delegar (`Engine.Gates.QaAutomacaoAgent` sempre;
  `Engine.Gates.QaPerformanceSegurancaAgent` só quando a story tem RNF de
  performance pertinente — `Engine.Gates.QaLead.rnf_de_performance?/1`), roda
  as delegações ativas (sequencial — ver `rodar_ativas/6` sobre por que não é
  `Task.async`), registra CADA desfecho (`completed` | `failed` | `dispensed`)
  como uma linha de `delegations` + evento imutável, e consolida
  (`Engine.Gates.QaLead.consolidar/1`) num `qa_verdict` só — o MESMO artefato
  e a MESMA chamada a `EngineApiClient.record_gate_verdict/8` que o QAAgent
  fazia sozinho. A api nunca sabe que existe mais de um agente aqui dentro.

  Falha de subagente (origem `infra`/`modelo`/`codigo`/`politica`) NUNCA vira
  `changes_requested` — o Lead bloqueia a task com a origem real, a mesma
  lição do ADR 0020 um nível acima: não há achado sobre o código do dev, e
  fingir que há devolveria pro dev sem nada corrigível e ainda queimaria uma
  correção do teto (RN-015).
  """

  use GenServer, restart: :temporary

  # DERIVADO da lista canônica da api (FASE 18) — era a terceira cópia escrita
  # à mão, e a única que nenhum teste travava: subagente novo lá dentro passava
  # a existir sem que este `Wake.subscribe` soubesse.
  @subagentes Engine.Agents.Areas.membros("qa")

  alias Engine.Dev.{ContextBuilder, DevAgentServer, DevAgentState, Wake}
  alias Engine.Gates.{Dispatcher, QaAutomacaoAgent, QaLead, QaPerformanceSegurancaAgent}
  alias Engine.Harness.ArtifactEmitter
  alias Engine.Sessions.EngineApiClient

  def start_link(project_id) do
    GenServer.start_link(__MODULE__, project_id, name: via(project_id))
  end

  def via(project_id), do: {:via, Registry, {Engine.Gates.Registry, {project_id, "qa"}}}

  @doc "Dispara a revisão de QA pra `task_id`."
  def run(project_id, task_id), do: GenServer.cast(via(project_id), {:run, task_id})

  @impl true
  def init(project_id) do
    # Assina pelos SUBAGENTES, não por "qa": `task.action_settled` chega
    # chaveado pelo ator que PROPÔS a ação (`acao.actor.id`), e quem propõe é
    # a subespecialidade que está rodando o laço.
    for sub <- @subagentes, do: :ok = Wake.subscribe(project_id, sub)

    {:ok, %{project_id: project_id, pendente: nil}}
  end

  @impl true
  def handle_cast({:run, task_id}, state) do
    case DevAgentState.find_by_task_id(state.project_id, task_id) do
      nil -> {:noreply, state}
      dev_state -> {:noreply, run_area(state, dev_state, task_id)}
    end
  end

  # A decisão que segurava o laço de um subagente chegou (ADR 0052, agora
  # também para gates). Retoma DAQUELE subagente de onde parou e segue a área
  # do ponto em que ela havia parado — as delegações já registradas e os
  # resultados já colhidos continuam valendo.
  @impl true
  def handle_info(
        {:action_settled, %{action_id: action_id} = desfecho},
        %{pendente: %{action_id: action_id} = p} = state
      ) do
    resultado = agente(p.delegacao.subagent).retomar(p, texto_do_desfecho(desfecho), p.task_id)

    state = %{state | pendente: nil}

    {:noreply,
     continuar_area(state, p.em_voo, [{p.delegacao, resultado} | p.colhidos], p.restantes)}
  end

  # Desfecho de OUTRA ação, ou o lead já não está esperando: ignora em vez de
  # derrubar. A entrega é por agente, e nada garante que só chegue o esperado.
  def handle_info({:action_settled, _}, state), do: {:noreply, state}
  def handle_info(_msg, state), do: {:noreply, state}

  defp run_area(state, dev_state, task_id) do
    project_id = state.project_id
    session_id = dev_state.session_id

    case ContextBuilder.fetch(project_id, session_id, task_id) do
      {:ok, dev_context} ->
        delegacoes = decidir_delegacoes(dev_context.story)
        registrar_dispensas(project_id, session_id, task_id, delegacoes)

        emVoo = %{
          project_id: project_id,
          session_id: session_id,
          task_id: task_id,
          dev_state: dev_state,
          dev_context: dev_context
        }

        continuar_area(state, emVoo, [], Enum.filter(delegacoes, & &1.ativo))

      {:error, _reason} ->
        state
    end
  end

  # Roda as delegações restantes UMA A UMA. Se alguma suspender esperando
  # aprovação, o estado em voo é guardado e a área PARA — sem consolidar, sem
  # bloquear a task. O que retoma é `{:action_settled, ...}`.
  #
  # Antes isto era um `Enum.map` que não tinha como parar no meio: a suspensão
  # caía no catch-all do subagente, virava `origin: infra` e a task era
  # bloqueada por uma decisão que ninguém tinha tomado (achado AB).
  defp continuar_area(state, emVoo, colhidos, restantes) do
    case restantes do
      [] ->
        finalizar_area(state, emVoo, Enum.reverse(colhidos))

      [d | resto] ->
        case agente(d.subagent).run(
               emVoo.project_id,
               emVoo.session_id,
               emVoo.task_id,
               emVoo.dev_state,
               emVoo.dev_context
             ) do
          {:awaiting, pendente} ->
            %{
              state
              | pendente:
                  Map.merge(pendente, %{
                    delegacao: d,
                    colhidos: colhidos,
                    restantes: resto,
                    task_id: emVoo.task_id,
                    em_voo: emVoo
                  })
            }

          resultado ->
            continuar_area(state, emVoo, [{d, resultado} | colhidos], resto)
        end
    end
  end

  defp finalizar_area(state, emVoo, resultados) do
    registrar_resultados(emVoo.project_id, emVoo.session_id, emVoo.task_id, resultados)

    resultados
    |> Enum.map(fn {d, resultado} -> {d.label, resultado} end)
    |> QaLead.consolidar()
    |> aplicar(emVoo.project_id, emVoo.dev_state, emVoo.task_id)

    state
  end

  # Mesma tradução do `DevAgentServer`: o desfecho vira o texto que entra no
  # lugar onde estaria a palavra "pending". Recusa é RESPOSTA, não silêncio.
  defp texto_do_desfecho(%{status: "executed", execution_result: %{} = exec}) do
    "exit #{Map.get(exec, "exitCode", "?")}\n#{Map.get(exec, "stdout", "")}"
  end

  defp texto_do_desfecho(%{status: "failed", execution_result: %{} = exec}) do
    "falhou: #{Map.get(exec, "stderr", "")}#{Map.get(exec, "stdout", "")}"
  end

  defp texto_do_desfecho(%{status: "denied"} = desfecho) do
    motivo = Map.get(desfecho, :rejection_reason) || "sem motivo informado"
    "recusado pelo usuário: #{motivo}"
  end

  defp texto_do_desfecho(%{status: status}), do: "desfecho da ação: #{status}"

  # Automação sempre; Performance/Segurança só com RNF pertinente — e a
  # decisão SEMPRE vira registro, dispensada ou não (nunca silêncio, ver
  # CLAUDE.md 8b item 2).
  defp decidir_delegacoes(story) do
    [
      %{subagent: "qa-automacao", label: "QA de Automação", ativo: true, justification: nil},
      delegacao_perf_seguranca(story)
    ]
  end

  defp delegacao_perf_seguranca(story) do
    base = %{subagent: "qa-performance-seguranca", label: "QA de Performance e Segurança"}

    if QaLead.rnf_de_performance?(story["rnf"] || []) do
      Map.merge(base, %{ativo: true, justification: nil})
    else
      Map.merge(base, %{
        ativo: false,
        justification: "story sem RNF de performance pertinente"
      })
    end
  end

  defp registrar_dispensas(project_id, session_id, task_id, delegacoes) do
    delegacoes
    |> Enum.reject(& &1.ativo)
    |> Enum.each(fn d ->
      record_delegation(project_id, session_id, task_id, %{
        area: "qa",
        subagent: d.subagent,
        status: "dispensed",
        justification: d.justification
      })
    end)
  end

  # SEQUENCIAL, não `Task.async` — de propósito, não por limitação.
  #
  # O `ToolLoop` de cada subagente fala com a api de LLM via
  # `EngineApiClient`, trocável em teste por `Process.put(:fake_llm_turns,
  # ...)` — o mesmo mecanismo que todo o resto do harness usa (ver
  # `fake_engine_api_client.ex`). Dicionário de processo NÃO atravessa
  # `Task.async`: um subagente rodando numa Task filha não enxergaria o que o
  # teste escreveu no processo pai, e o fake pareceria vazio — quebrando a
  # suíte inteira em silêncio, sem nenhum erro que apontasse pra causa.
  # Rodar aqui, no processo do próprio `QaLeadServer`, mantém o mesmo
  # mecanismo de teste que `QaAutomacaoAgentTest`/`QaPerformanceSegurancaAgentTest`
  # já usam.
  #
  # A ORDEM da lista de entrada (Automação primeiro) é a mesma que
  # `QaLead.consolidar/1` usa pra priorizar qual falha reportar quando mais de
  # uma delegação bloqueia.
  defp agente("qa-automacao"), do: QaAutomacaoAgent
  defp agente("qa-performance-seguranca"), do: QaPerformanceSegurancaAgent

  defp registrar_resultados(project_id, session_id, task_id, resultados) do
    Enum.each(resultados, fn {d, resultado} ->
      registrar_resultado(project_id, session_id, task_id, d, resultado)
    end)
  end

  defp registrar_resultado(project_id, session_id, task_id, d, {:ok, verdict}) do
    case emit_parecer_interno(project_id, session_id, task_id, d.subagent, verdict) do
      {:ok, event} ->
        record_delegation(project_id, session_id, task_id, %{
          area: "qa",
          subagent: d.subagent,
          status: "completed",
          parecer_artifact_id: Map.get(event, "id")
        })

      {:error, reason} ->
        # O parecer do subagente não passou na validação de artefato — raro
        # (a tool já valida a forma), mas se acontecer é problema de FORMA do
        # payload, não de infraestrutura nem de decisão de política: `codigo`.
        record_delegation(project_id, session_id, task_id, %{
          area: "qa",
          subagent: d.subagent,
          status: "failed",
          failure_origin: "codigo",
          failure_reason: "parecer inválido: #{inspect(reason)}"
        })
    end
  end

  defp registrar_resultado(project_id, session_id, task_id, d, {:blocked, info}) do
    record_delegation(project_id, session_id, task_id, %{
      area: "qa",
      subagent: d.subagent,
      status: "failed",
      failure_origin: info.origin,
      failure_reason: "#{info.reason} — #{info.diagnosis}"
    })
  end

  # Parecer do SUBAGENTE, reaproveitando o schema `qa_verdict` (a matriz de
  # cobertura vazia é aceita — não é chave obrigatória). Nunca vai pro gate:
  # é o que vira `delegations.parecer_artifact_id`. `emit_returning/5` porque
  # o id é justamente o que se precisa referenciar.
  defp emit_parecer_interno(project_id, session_id, task_id, subagent, verdict) do
    ArtifactEmitter.emit_returning(project_id, session_id, subagent, "qa_verdict", %{
      taskId: task_id,
      veredito: verdict.veredito,
      resumo: verdict.resumo,
      itens: verdict.itens,
      coverageMatrix: Map.get(verdict, :coverage_matrix, [])
    })
  end

  defp record_delegation(project_id, session_id, task_id, campos) do
    EngineApiClient.record_delegation(
      Map.merge(
        %{
          project_id: project_id,
          session_id: session_id,
          task_id: task_id,
          lead_agent: "qa-lead"
        },
        campos
      )
    )

    :ok
  end

  defp aplicar(
         {:ok, %{veredito: veredito, resumo: resumo, itens: itens} = verdict},
         project_id,
         dev_state,
         task_id
       ) do
    ArtifactEmitter.emit(project_id, dev_state.session_id, "qa", "qa_verdict", %{
      taskId: task_id,
      veredito: veredito,
      resumo: resumo,
      itens: itens,
      coverageMatrix: Map.get(verdict, :coverage_matrix, [])
    })

    apply_gate_result(project_id, dev_state, task_id, veredito, resumo, itens)
  end

  defp aplicar(
         {:blocked, %{reason: reason, diagnosis: diagnosis, origin: origin}},
         project_id,
         dev_state,
         task_id
       ) do
    emit(project_id, dev_state.session_id, "dev.error", %{agentId: "qa-lead", reason: reason})

    ArtifactEmitter.emit(project_id, dev_state.session_id, "qa-lead", "task_blocked", %{
      taskId: task_id,
      agentId: "qa-lead",
      reason: reason,
      diagnosis: diagnosis,
      origin: origin
    })

    EngineApiClient.mark_task_blocked(
      project_id,
      dev_state.session_id,
      task_id,
      reason,
      diagnosis,
      "qa-lead",
      origin
    )
  end

  # Mesma chamada, byte a byte, que o QAAgent da Fase 4a fazia — é o que
  # garante que `RecordGateVerdictUseCase`/`nextGateStatus` não precisam saber
  # que existe um Lead.
  defp apply_gate_result(project_id, dev_state, task_id, veredito, resumo, itens) do
    result =
      EngineApiClient.record_gate_verdict(
        project_id,
        dev_state.session_id,
        task_id,
        "qa",
        veredito,
        resumo,
        itens,
        dev_state.max_gate_corrections
      )

    case result do
      {:ok, %{"nextAction" => "correct"}} ->
        DevAgentServer.correct(project_id, dev_state.agent_id, %{
          gate: "qa",
          reason: resumo,
          diagnosis: Enum.join(itens, "; ")
        })

      {:ok, %{"nextAction" => "run_secops"}} ->
        :ok = Dispatcher.run_secops(project_id, task_id)

      _ ->
        :ok
    end
  end

  defp emit(project_id, session_id, type, payload) do
    ArtifactEmitter.append(project_id, session_id, "qa-lead", type, payload)
  end
end
