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

  ## O plano de teste é o primeiro passo do ciclo (ADR 0192, RN-674)

  O ADR 0090 deu a este processo um segundo MOMENTO PRE-DEV, `run_design/3`,
  disparado pelo `assess_implementability` do Dev Lead antes de existir
  código. O uso real mostrou que ali não havia o que ler (`toolloop.limit_reached`
  8/8 sem `emit_plano_de_teste`), e o dono decidiu pela saída (b): o plano
  nasce DEPOIS da entrega. `run_design/3` saiu, e o segundo momento passou a
  morar DENTRO do ciclo de sempre: `run_area/3` monta o plano
  (`Engine.Gates.QaEstrategiaAgent.run/6`, com o worktree do dev e a lista de
  arquivos do diff) ANTES das subespecialidades, e o plano entra no
  `dev_context` que elas recebem, como `:plano_de_teste`. É um INSUMO do gate
  `qa-verificada`, nunca um segundo veredito: o contrato externo continua
  sendo um `qa_verdict` por ciclo.

  O plano é uma vez por TASK: a rodada de correção (RN-015) reencontra o
  `artifact.plano_de_teste` da mesma `taskId` na cauda da sessão e não paga
  outro laço. E plano que falha NÃO segura a revisão — a QA-estratégia já
  narrou a falha com origem (`agent.error`), e a Automação revisa como sempre
  revisou, pelas regras da story. Fazer a falha do plano bloquear a task
  mudaria o comportamento de um gate `block` por um insumo novo, e isso não
  foi decidido.
  """

  use GenServer, restart: :temporary

  # DERIVADO da lista canônica da api (FASE 18) — era a terceira cópia escrita
  # à mão, e a única que nenhum teste travava: subagente novo lá dentro passava
  # a existir sem que este `Wake.subscribe` soubesse.
  @subagentes Engine.Agents.Areas.membros("qa")

  alias Engine.Dev.{ContextBuilder, DevAgentServer, DevAgentState, Wake}

  alias Engine.Agents.Reidratacao

  alias Engine.Gates.{
    ConferenciaDoReadme,
    Diff,
    Dispatcher,
    GateState,
    QaAutomacaoAgent,
    QaEstrategiaAgent,
    QaLead,
    QaPerformanceSegurancaAgent
  }

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

  # RN-722: o `GateRescuer` pergunta por TASK. Em voo aqui = suspensa
  # esperando decisão; a que está RODANDO não responde (o servidor está dentro
  # do `handle_cast`), e o resgate trata o silêncio como "vivo".
  @impl true
  def handle_call({:em_voo?, task_id}, _from, state) do
    {:reply, match?(%{task_id: ^task_id}, state.pendente), state}
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

    # AT-248 (RN-629): o laço retomado PODE suspender de novo — o subagente
    # roda vários comandos e cada um pede aprovação. O resultado da retomada
    # passa pelo MESMO tratamento do resultado de `run/5`; antes o
    # `{:awaiting, _}` entrava em `colhidos` como se fosse parecer.
    {:noreply, tratar_resultado(state, p.em_voo, p.delegacao, resultado, p.colhidos, p.restantes)}
  end

  # Desfecho de OUTRA ação, ou o lead já não está esperando: ignora em vez de
  # derrubar. A entrega é por agente, e nada garante que só chegue o esperado.
  def handle_info({:action_settled, _}, state), do: {:noreply, state}
  def handle_info(_msg, state), do: {:noreply, state}

  defp run_area(state, dev_state, task_id) do
    project_id = state.project_id
    session_id = dev_state.session_id

    # ADR 0067: o ciclo entra em voo AQUI, antes de qualquer subagente rodar —
    # é o que permite ao `Engine.Gates.GateRescuer` achar um ciclo que nunca
    # chegou a registrar veredito nenhum (crash logo no início, ou no meio de
    # um subagente suspenso esperando aprovação).
    GateState.upsert!(%{
      project_id: project_id,
      task_id: task_id,
      gate: "qa",
      session_id: session_id,
      step: "in_progress"
    })

    case ContextBuilder.fetch(project_id, session_id, task_id) do
      {:ok, dev_context} ->
        # ADR 0192: o plano de teste da ENTREGA vem primeiro, e entra no
        # contexto que as subespecialidades recebem (ver o moduledoc).
        plano = plano_de_teste_da_entrega(project_id, session_id, task_id, dev_state, dev_context)
        dev_context = Map.put(dev_context, :plano_de_teste, plano)

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
        resultado =
          agente(d.subagent).run(
            emVoo.project_id,
            emVoo.session_id,
            emVoo.task_id,
            emVoo.dev_state,
            emVoo.dev_context
          )

        tratar_resultado(state, emVoo, d, resultado, colhidos, resto)
    end
  end

  # UM só lugar decide o que fazer com o resultado de um subagente, venha ele
  # de `run/5` ou de `retomar/3` (AT-248, RN-629). `{:awaiting, _}` guarda o
  # estado em voo e PARA a área; qualquer outra coisa é resultado colhido e a
  # área segue.
  defp tratar_resultado(state, emVoo, d, {:awaiting, pendente}, colhidos, resto) do
    # Só diagnóstico (ADR 0067) — o resgate NÃO tenta retomar este `ctx`
    # específico (ele não sobrevive a um restart, mesma limitação do
    # `laço_pendente` do dev agent); ele reinicia a área inteira. `step`
    # continua "in_progress".
    GateState.upsert!(%{
      project_id: emVoo.project_id,
      task_id: emVoo.task_id,
      gate: "qa",
      session_id: emVoo.session_id,
      step: "in_progress",
      subagent: d.subagent
    })

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
  end

  defp tratar_resultado(state, emVoo, d, {tag, _} = resultado, colhidos, resto)
       when tag in [:ok, :blocked],
       do: continuar_area(state, emVoo, [{d, resultado} | colhidos], resto)

  # Resultado que o lead não conhece: NUNCA derruba a área nem some (RN-059).
  # Vira bloqueio com origem `codigo` (falta uma cláusula aqui, não é
  # infra/modelo/política), que `registrar_resultado/5` e
  # `QaLead.consolidar/1` já sabem tratar — a task é bloqueada com o motivo.
  defp tratar_resultado(state, emVoo, d, resultado, colhidos, resto) do
    bloqueio =
      {:blocked,
       %{
         reason: "#{d.label} devolveu um resultado que o QA Lead não reconhece",
         diagnosis: "resultado inesperado: #{inspect(resultado, limit: 5, printable_limit: 200)}",
         origin: "codigo"
       }}

    continuar_area(state, emVoo, [{d, bloqueio} | colhidos], resto)
  end

  defp finalizar_area(state, emVoo, resultados) do
    registrar_resultados(emVoo.project_id, emVoo.session_id, emVoo.task_id, resultados)

    resultados
    |> Enum.map(fn {d, resultado} -> {d.label, resultado} end)
    |> Kernel.++(conferencia_do_readme(emVoo))
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

    # O ciclo desta tentativa terminou (bloqueado) — `mark_task_blocked` já é
    # durável e já acorda o dev agent (mesma transação, outbox própria); nada
    # mais a resgatar (ADR 0067).
    GateState.delete(project_id, task_id, "qa")
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
        # ADR 0067: o veredito JÁ está gravado (durável, na api) — o que falta
        # é só esta chamada em processo. Persiste ANTES de chamá-la, pra o
        # `GateRescuer` reenviar exatamente isto se o processo cair nesta
        # janela; apaga DEPOIS, porque a chamada em si é local e instantânea
        # (sem I/O de rede no meio) — a janela de perda que sobra é a mesma
        # ordem de grandeza de outras já aceitas no produto (ex.: a entrega
        # at-most-once do `Engine.Dev.Wake`, ADR 0045).
        findings = %{gate: "qa", reason: resumo, diagnosis: Enum.join(itens, "; ")}

        GateState.upsert!(%{
          project_id: project_id,
          task_id: task_id,
          gate: "qa",
          session_id: dev_state.session_id,
          step: "dispatch_pending",
          next_action: "correct",
          correction_reason: resumo,
          correction_diagnosis: findings.diagnosis
        })

        DevAgentServer.correct(project_id, dev_state.agent_id, findings)
        GateState.delete(project_id, task_id, "qa")

      {:ok, %{"nextAction" => "run_secops"}} ->
        GateState.upsert!(%{
          project_id: project_id,
          task_id: task_id,
          gate: "qa",
          session_id: dev_state.session_id,
          step: "dispatch_pending",
          next_action: "run_secops"
        })

        :ok = Dispatcher.run_secops(project_id, task_id)
        GateState.delete(project_id, task_id, "qa")

      _ ->
        # `done`, ou um erro/estado inesperado da api (ex.: 500 de
        # `InvalidGateActionError` — sempre possível se o `GateRescuer`
        # reenviar um ciclo cujo veredito já tinha sido registrado por outra
        # via; ver ADR 0067). Nos dois casos não há dispatch pendente: `done`
        # já é durável via outbox (`RecordGateVerdictUseCase`), e um erro não
        # tem o que resgatar de novo.
        GateState.delete(project_id, task_id, "qa")
    end
  end

  defp emit(project_id, session_id, type, payload) do
    ArtifactEmitter.append(project_id, session_id, "qa-lead", type, payload)
  end

  # --- O plano de teste da entrega (ADR 0192, RN-674) ----------------------

  # Uma vez por TASK. A leitura é a CAUDA da sessão com o teto da reidratação
  # (RN-580, ADR 0060) — numa sessão longa o plano pode ter saído da janela, e
  # aí o custo é um laço repetido, nunca um plano errado. Falha de LEITURA
  # também cai em gerar: perguntar de novo à api não é mais barato que o
  # laço, e não gerar deixaria a revisão sem o insumo por uma falha de rede.
  defp plano_de_teste_da_entrega(project_id, session_id, task_id, dev_state, dev_context) do
    case plano_ja_emitido(project_id, session_id, task_id) do
      {:ok, plano} ->
        plano

      :nenhum ->
        arquivos = arquivos_alterados(project_id, dev_state.worktree_path)

        case QaEstrategiaAgent.run(
               project_id,
               session_id,
               task_id,
               dev_state,
               dev_context,
               arquivos
             ) do
          {:ok, plano} -> plano
          # A QA-estratégia já gravou `agent.error` com a origem (RN-059): a
          # revisão segue SEM plano, como sempre seguiu antes do ADR 0192.
          {:error, _motivo} -> nil
        end
    end
  end

  defp plano_ja_emitido(project_id, session_id, task_id) do
    case EngineApiClient.list_events(project_id, session_id,
           latest: true,
           limit: Reidratacao.teto()
         ) do
      {:ok, eventos} ->
        eventos
        |> Enum.filter(&plano_da_task?(&1, task_id))
        |> List.last()
        |> case do
          nil -> :nenhum
          evento -> {:ok, plano_do_payload(Map.get(evento, "payload", %{}))}
        end

      {:error, _reason} ->
        :nenhum
    end
  end

  defp plano_da_task?(%{"type" => "artifact.plano_de_teste", "payload" => payload}, task_id)
       when is_map(payload),
       do: Map.get(payload, "taskId") == task_id

  defp plano_da_task?(_evento, _task_id), do: false

  # A MESMA forma que `Engine.Gates.Hooks.TerminationPlanoDeTeste` produz —
  # quem consome (`QaAutomacaoAgent`) não precisa saber de onde o plano veio.
  defp plano_do_payload(payload) do
    %{
      plano_de_teste: Map.get(payload, "planoDeTeste", ""),
      criterios_executaveis: Map.get(payload, "criteriosExecutaveis", []),
      estrategia_de_automacao: Map.get(payload, "estrategiaDeAutomacao", "")
    }
  end

  # RN-798 (AT-475): README tocado pela entrega é conferido contra os scripts
  # do package.json, sem LLM; divergência entra como parecer próprio.
  defp conferencia_do_readme(%{project_id: project_id, dev_state: dev_state}) do
    worktree = Map.get(dev_state, :worktree_path)

    case ConferenciaDoReadme.conferir(worktree, arquivos_alterados(project_id, worktree)) do
      nil ->
        []

      [] ->
        [{"Conferência do README", {:ok, %{veredito: "approved", resumo: "", itens: []}}}]

      divergencias ->
        [
          {"Conferência do README",
           {:ok,
            %{
              veredito: "changes_requested",
              resumo: "README cita comando que o código não tem",
              itens: divergencias
            }}}
        ]
    end
  rescue
    _ -> []
  end

  defp arquivos_alterados(project_id, worktree_path) do
    case Diff.compute(project_id, worktree_path) do
      {:ok, diff_text} -> {:ok, Diff.changed_paths(diff_text)}
      {:error, reason} -> {:error, reason}
    end
  end
end
