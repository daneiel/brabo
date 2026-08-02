defmodule Engine.Dev.DevAgentServer do
  @moduledoc """
  Dev agent supervisionado por {project_id, agent_id} (Fase 4a). Ciclo de
  task: reivindica (claim atômico na api), monta um worktree isolado, monta o
  contexto rico da task (`Engine.Dev.ContextBuilder`) e implementa via o
  `Engine.Harness.ToolLoop` real — o modelo lê/escreve arquivos e roda a
  suite via `terminal`, TUDO escopado ao worktree (`workspace_root`). Só abre
  PR quando o modelo sinaliza `report_done` (que por sua vez só aceita depois
  de um `terminal` com exit 0 — ver `Engine.Dev.Tools.ReportDone`); qualquer
  outro desfecho (`report_blocked`, limite de iterações, orçamento de tokens
  estourado, ou o modelo parar sem sinalizar) devolve a task com diagnóstico
  (`blocked`), nunca abre PR vermelha nem entra em loop infinito. Estado
  durável em `dev_agent_states` (rehydration no boot).

  ## Máquina de estados (Fase 12b — reagendamento após gate)

  `status`: `:working | :awaiting_gate | :idle | :idle_tripped`, persistido
  em `dev_agent_states.status`.

  PR aberta não libera o agente — ele entra em `:awaiting_gate` e MANTÉM
  `task_id`/`worktree`/`branch`: o worktree é um por AGENTE (não por task,
  ver `WorktreeManager`), e os gates de QA/SecOps o encontram via
  `DevAgentState.find_by_task_id/2`. Reivindicar a próxima task nesse
  meio-tempo destruiria fisicamente o worktree que o gate ainda está
  varrendo. Só um desfecho TERMINAL do gate (`task.gate_resolved` via
  outbox — ver `Engine.Workers.DevAgentWakeWorker`) libera o agente pra
  tentar a próxima task, através de `finish_task/2`.

  Task que termina `blocked` — localmente (no ToolLoop) ou REMOTAMENTE (teto
  de correções do gate estourado, via `task.gate_resolved`) — passa por
  `finish_task/2`, que incrementa `consecutive_blocked`; N consecutivas
  (teto por projeto, `max_consecutive_blocked`) para o agente em
  `:idle_tripped` — o circuit breaker da RN-047. Um sucesso terminal
  (`:approved`, via `task.gate_resolved` com `nextAction: "done"`) zera o
  contador e tenta a próxima task.

  Dois `handle_info/2` recebem os wakes entregues por `Engine.Dev.Wake`
  (PubSub, não Registry — o job que os dispara pode rodar em qualquer
  réplica): `{:gate_resolved, %{task_id:, next_action:}}` só age se
  `task_id` bater E o agente estiver `:awaiting_gate` — entrega
  duplicada/tardia é no-op; `{:wake, :became_claimable}` só age se `:idle`.

  ## Reidratação (Fase 12b-6)

  `Engine.Dev.DevRehydrator` passa um `resume` (a linha durável, ou `nil`
  num start fresco) como último elemento do tuple de `init/1`. Os quatro
  estados voltam assim:

  - `idle`/`idle_tripped` — campos zerados/preservados como estavam, sem
    claim. `idle_tripped` ignora wake até um rearm explícito.
  - `awaiting_gate` — `task_id`/`worktree` voltam intactos (`branch` não é
    persistido; reconstruído do `task_id`, igual a `run_task/2`), sem
    claim — a linha de outbox pendente (ou uma escrita depois do
    restart) drena e acorda, exatamente como um wake normal.
  - `working` — o ToolLoop não existe mais pra retomar (turno, mensagens e
    edições do worktree só existiam em memória). Bloqueia a task retida
    com diagnóstico do restart e segue pro próximo claim — SEM incrementar
    `consecutive_blocked` (reiniciar o engine não é o agente queimando o
    teto).
  """

  use GenServer, restart: :temporary

  alias Engine.Dev.{AgentIo, ContextBuilder, Tools, Wake}
  alias Engine.Dev.Hooks.Termination
  alias Engine.Gates.Dispatcher
  alias Engine.Harness.ToolLoop
  alias Engine.Harness.Hooks
  alias Engine.Harness.Hooks.{ActionPipeline, EventLog}
  alias Engine.Sessions.EngineApiClient

  # Marca da implementação no estado durável: a reidratação sobe o server
  # certo a partir dela (ver Engine.Dev.DevRehydrator).
  @impl_tag "real"

  # Usado só quando `max_consecutive_blocked` não veio configurado (projeto
  # ainda não migrou pra Fase 12b, ou início de ciclo antes da 12b-4 ligar a
  # superfície de config) — nunca deixa o breaker inoperante por ausência de
  # valor.
  @default_max_consecutive_blocked 3

  def start_link(
        {project_id, agent_id, module, session_id, task_budget_micros, max_gate_corrections,
         max_consecutive_blocked, resume}
      ) do
    GenServer.start_link(
      __MODULE__,
      {project_id, agent_id, module, session_id, task_budget_micros, max_gate_corrections,
       max_consecutive_blocked, resume},
      name: via(project_id, agent_id)
    )
  end

  defdelegate via(project_id, agent_id), to: AgentIo

  @doc "Dispara o ciclo de trabalho (chamado num start FRESCO, não em rehydration)."
  def work(project_id, agent_id), do: GenServer.cast(via(project_id, agent_id), :work)

  @doc """
  Devolução pro dev (Fase 4a — gates): um gate (QA/SecOps) reprovou e o dev
  corrige NO MESMO worktree/branch — distinto de `work/2`, que reivindica
  uma task NOVA. `findings` é `%{gate:, reason:, diagnosis:}`.
  """
  def correct(project_id, agent_id, findings),
    do: GenServer.cast(via(project_id, agent_id), {:correct, findings})

  # --- Callbacks ---

  @impl true
  def init(
        {project_id, agent_id, module, session_id, task_budget_micros, max_gate_corrections,
         max_consecutive_blocked, resume}
      ) do
    base = %{
      project_id: project_id,
      agent_id: agent_id,
      module: module,
      session_id: session_id,
      impl: @impl_tag,
      task_budget_micros: task_budget_micros,
      max_gate_corrections: max_gate_corrections,
      max_consecutive_blocked: max_consecutive_blocked
    }

    state = resume_state(base, resume)
    AgentIo.persist(state)
    :ok = Wake.subscribe(project_id, agent_id)

    final_state =
      if resume && resume.status == "working" do
        state
        |> AgentIo.block_task(
          "engine reiniciou durante a task",
          "o ToolLoop não pôde ser retomado após o restart — turno, mensagens " <>
            "e edições do worktree só existiam em memória"
        )
        |> finish_restart_recovery()
      else
        state
      end

    {:ok, final_state}
  end

  # Start fresco: sempre idle, sem task — igual a antes da Fase 12b-6.
  defp resume_state(base, nil) do
    Map.merge(base, %{
      task_id: nil,
      worktree: nil,
      branch: nil,
      status: :idle,
      consecutive_blocked: 0
    })
  end

  # `awaiting_gate` e `working` retêm task_id/worktree — o worktree
  # reidratado ainda está no disco (não foi apagado; só seria substituído
  # por um `add_worktree/3` futuro), e um gate tardio ainda o encontra via
  # `find_by_task_id/2`. `branch` não é persistido (nunca foi — só
  # task_id/worktree_path), reconstruído do mesmo jeito que `run_task/2` o
  # monta originalmente.
  defp resume_state(base, %{status: status} = row) when status in ["awaiting_gate", "working"] do
    Map.merge(base, %{
      task_id: row.task_id,
      worktree: row.worktree_path,
      branch: "feature/task-" <> String.slice(to_string(row.task_id), 0, 8),
      status: String.to_existing_atom(status),
      consecutive_blocked: row.consecutive_blocked
    })
  end

  # `idle` e `idle_tripped` — nada a reter; o contador do breaker é o único
  # campo que precisa sobreviver ao restart (senão um restart no meio de
  # uma sequência de blocked zeraria o breaker de graça).
  defp resume_state(base, row) do
    Map.merge(base, %{
      task_id: nil,
      worktree: nil,
      branch: nil,
      status: String.to_existing_atom(row.status),
      consecutive_blocked: row.consecutive_blocked
    })
  end

  # Fecha o `working` reidratado: task já bloqueada por `AgentIo.block_task`
  # acima, e SEM passar por `finish_task/2` — reiniciar o engine não é o
  # agente queimando o teto, não pode contar pro circuit breaker.
  defp finish_restart_recovery(state) do
    state
    |> Map.merge(%{task_id: nil, worktree: nil, branch: nil})
    |> try_claim()
  end

  @impl true
  def handle_cast(:work, state) do
    AgentIo.emit(state, "dev.started", %{agentId: state.agent_id, module: state.module})
    {:noreply, try_claim(state)}
  end

  @impl true
  def handle_cast({:correct, findings}, state) do
    state = %{state | status: :working}
    AgentIo.persist(state)

    case ContextBuilder.fetch(state.project_id, state.session_id, state.task_id, state.module) do
      {:ok, dev_context} ->
        {:noreply, implement_correction(state, dev_context, findings)}

      {:error, reason} ->
        AgentIo.emit(state, "dev.error", %{agentId: state.agent_id, reason: inspect(reason)})
        {:noreply, state}
    end
  end

  # Chegou pelo `Engine.Dev.Wake` (outbox → DevAgentWakeWorker). Guard de
  # identidade: só age se for a MESMA task que este agente está esperando, E
  # se ele ainda estiver esperando — entrega duplicada (retry do Oban, drain
  # concorrente) ou tardia (agente já reagendado por outro caminho) vira
  # no-op, nunca um segundo `finish_task/2` pra task que já foi embora.
  @impl true
  def handle_info(
        {:gate_resolved, %{task_id: task_id, next_action: next_action}},
        %{task_id: task_id, status: :awaiting_gate} = state
      ) do
    outcome = if next_action == "done", do: :approved, else: :blocked
    {:noreply, finish_task(state, outcome)}
  end

  def handle_info({:gate_resolved, _}, state), do: {:noreply, state}

  # Só age se estiver livre (`:idle`) — em `:working`/`:awaiting_gate` a fila
  # já está sendo atendida ou o agente está no meio de outra coisa;
  # `:idle_tripped` ignora até rearmar.
  @impl true
  def handle_info({:wake, :became_claimable}, %{status: :idle} = state) do
    {:noreply, try_claim(state)}
  end

  def handle_info({:wake, :became_claimable}, state), do: {:noreply, state}

  # A ÚNICA saída de `idle_tripped` (Fase 12b — RN-047): zera o contador e
  # tenta reivindicar. O registro de QUEM rearmou é da api (`dev.rearmed`,
  # `actor: user`, em `RearmDevAgentUseCase`) — emitir aqui de novo seria o
  # MESMO evento contado duas vezes, uma por ator diferente, na mesma sessão.
  @impl true
  def handle_info(:rearm, %{status: :idle_tripped} = state) do
    state = %{state | consecutive_blocked: 0}
    AgentIo.persist(state)
    {:noreply, try_claim(state)}
  end

  def handle_info(:rearm, state), do: {:noreply, state}

  # --- Máquina de estados (Fase 12b) ---

  # Ponto único de claim — chamado pelo `:work` inicial e por `finish_task/2`
  # sempre que uma task termina e o agente segue livre.
  defp try_claim(state) do
    case AgentIo.claim_task(state) do
      {:ok, nil} ->
        state = %{state | status: :idle}
        AgentIo.persist(state)
        AgentIo.emit(state, "dev.idle", %{agentId: state.agent_id, reason: "sem task pegável"})
        state

      {:ok, task} ->
        run_task(%{state | status: :working}, task)

      {:error, reason} ->
        AgentIo.emit(state, "dev.error", %{agentId: state.agent_id, reason: inspect(reason)})
        state
    end
  end

  # Único lugar que zera task_id/worktree/branch — deixá-los obsoletos faria
  # um gate tardio achar o worktree ERRADO via `find_by_task_id/2`. `:approved`
  # zera o contador do breaker; `:blocked` incrementa e, ao bater o teto, para
  # em `:idle_tripped` SEM tentar reivindicar.
  defp finish_task(state, :approved) do
    state
    |> Map.merge(%{task_id: nil, worktree: nil, branch: nil, consecutive_blocked: 0})
    |> try_claim()
  end

  defp finish_task(state, :blocked) do
    counter = state.consecutive_blocked + 1

    state =
      Map.merge(state, %{
        task_id: nil,
        worktree: nil,
        branch: nil,
        consecutive_blocked: counter
      })

    if tripped?(counter, state.max_consecutive_blocked) do
      state = %{state | status: :idle_tripped}
      AgentIo.persist(state)

      AgentIo.emit(state, "dev.idle_tripped", %{
        agentId: state.agent_id,
        consecutiveBlocked: counter
      })

      state
    else
      try_claim(state)
    end
  end

  defp tripped?(counter, max) when is_integer(max), do: counter >= max
  defp tripped?(counter, _), do: counter >= @default_max_consecutive_blocked

  # --- Ciclo do DevAgent ---

  defp run_task(state, task) do
    task_id = Map.get(task, "id")
    slug = "task-" <> String.slice(to_string(task_id), 0, 8)

    # task_id entra no state ANTES de montar o worktree: se a criação
    # falhar, a task já foi reivindicada (está `in_progress` na api) e
    # block_task precisa saber qual devolver — senão ela fica órfã, sem
    # dono vivo e invisível pro claim (que só pega `todo`).
    state = %{state | task_id: task_id}

    case AgentIo.worktree_manager().create(state.project_id, state.agent_id, slug) do
      {:ok, %{path: path, branch: branch}} ->
        state = %{state | worktree: path, branch: branch}
        AgentIo.persist(state)

        AgentIo.emit(state, "dev.working", %{
          agentId: state.agent_id,
          taskId: task_id,
          # O título viaja no evento porque é o que o painel mostra: sem ele a
          # UI só tem a branch (`task-<8 hex do uuid>`), que não diz nada.
          taskTitle: Map.get(task, "title"),
          branch: branch
        })

        case ContextBuilder.fetch(state.project_id, state.session_id, task_id, state.module) do
          {:ok, dev_context} ->
            implement(state, dev_context)

          {:error, reason} ->
            state
            |> AgentIo.block_task("falha ao montar contexto da task", inspect(reason))
            |> finish_task(:blocked)
        end

      {:error, reason} ->
        AgentIo.emit(state, "dev.error", %{agentId: state.agent_id, reason: inspect(reason)})

        state
        |> AgentIo.block_task("falha ao preparar o worktree", inspect(reason))
        |> finish_task(:blocked)
    end
  end

  defp implement(state, %{
         task: task,
         story: story,
         business_rules_units: business_rules_units,
         task_state_units: task_state_units
       }) do
    ctx = %{
      project_id: state.project_id,
      session_id: state.session_id,
      agent: state.agent_id,
      workspace_root: state.worktree,
      tools: Tools.registry(),
      hooks: dev_hooks(),
      token_budget_micros: state.task_budget_micros,
      business_rules_units: business_rules_units,
      task_state_units: task_state_units,
      messages: [initial_message(task, story)],
      # Janela grande o bastante pra uma task inteira (vários terminals/reads)
      # não disparar compactação no meio do trabalho — o ContextManager ainda
      # roda: só não some com histórico recente por um cálculo de janela
      # pequena demais. TODO: usar a janela real do modelo resolvido quando o
      # turno de LLM devolver isso pro engine.
      context_window: 128_000
    }

    ctx
    |> ToolLoop.run()
    |> handle_outcome(state, task, story)
  end

  defp dev_hooks do
    Hooks.new()
    |> Hooks.register(:pre_tool_use, ActionPipeline)
    |> Hooks.register(:post_tool_use, EventLog)
    |> Hooks.register(:post_tool_use, Termination)
  end

  defp initial_message(task, story) do
    %{
      "role" => "user",
      # Instrução explícita porque modelos menores tendem a DESCREVER a
      # solução (ou imprimir a tool call como JSON no texto) em vez de
      # chamar a ferramenta — o loop então termina sem desfecho e a task é
      # bloqueada sem o modelo ter feito nada.
      "content" =>
        "Implemente a task \"#{task["title"]}\" da story \"#{story["title"]}\". " <>
          "Rode a suite de testes do projeto via `terminal` e só sinalize conclusão com " <>
          "`report_done` depois de vê-la passar (exit 0). Se não conseguir concluir, " <>
          "use `report_blocked` com o diagnóstico do que foi tentado e por que falhou.\n\n" <>
          "IMPORTANTE: aja apenas por chamadas de ferramenta. Não escreva código " <>
          "nem JSON na sua resposta em texto, e não explique o que pretende fazer — " <>
          "chame `write_file` para criar cada arquivo e `terminal` para rodar a suite. " <>
          "Toda resposta sua deve conter pelo menos uma chamada de ferramenta.",
      :pinned => true
    }
  end

  # --- Correção pedida por um gate (mesmo worktree/branch — sem novo claim) ---

  defp implement_correction(
         state,
         %{
           task: task,
           story: story,
           business_rules_units: business_rules_units,
           task_state_units: task_state_units
         },
         findings
       ) do
    ctx = %{
      project_id: state.project_id,
      session_id: state.session_id,
      agent: state.agent_id,
      workspace_root: state.worktree,
      tools: Tools.registry(),
      hooks: dev_hooks(),
      token_budget_micros: state.task_budget_micros,
      business_rules_units: business_rules_units,
      task_state_units: task_state_units,
      messages: [initial_message(task, story), correction_message(findings)],
      context_window: 128_000
    }

    ctx
    |> ToolLoop.run()
    |> handle_correction_outcome(state, findings)
  end

  # O parecer PREVALECE sobre o enunciado da task, e isso precisa estar dito.
  # A task original continua no contexto (é ela que define o que implementar),
  # então quando o gate contradiz uma instrução dela — o caso clássico é o
  # SecOps mandando tirar um segredo que a task pediu pra usar — o agente
  # obedecia ao enunciado e repunha o problema a cada volta, até estourar o
  # teto de correções. Visto na execução do critério de aceite (ADR 0020): três
  # correções seguidas devolvendo o mesmo achado do gitleaks.
  defp correction_message(findings) do
    %{
      "role" => "user",
      "content" =>
        "O gate \"#{findings.gate}\" pediu correção nesta PR (mesma branch, mesmo worktree). " <>
          "Motivo: #{findings.reason}. Diagnóstico: #{findings.diagnosis}.\n\n" <>
          "Este parecer PREVALECE sobre o enunciado da task: onde os dois se " <>
          "contradisserem, siga o parecer. Se o achado for sobre algo que a task pediu " <>
          "explicitamente, corrija mesmo assim — repetir o que o gate acabou de reprovar " <>
          "só esgota o ciclo de correções e bloqueia a task.\n\n" <>
          "Corrija o necessário, rode a suite de novo via `terminal`, e só sinalize " <>
          "conclusão com `report_done` depois de vê-la passar (exit 0). Se ainda não " <>
          "conseguir, use `report_blocked`.",
      :pinned => true
    }
  end

  defp handle_correction_outcome(
         {:halted, {"report_done", %{summary: summary}}, _ctx},
         state,
         findings
       ) do
    # A PR já existe (mesma branch) — só commit+push, sem propose_pr de novo.
    AgentIo.propose_commit(state, summary)
    AgentIo.propose_push(state)
    trigger_gate_recheck(state, findings.gate)

    state = %{state | status: :awaiting_gate}
    AgentIo.persist(state)

    AgentIo.emit(state, "dev.awaiting_gate", %{
      agentId: state.agent_id,
      taskId: state.task_id,
      gate: findings.gate
    })

    state
  end

  defp handle_correction_outcome(
         {:halted, {"report_blocked", %{reason: reason, diagnosis: diagnosis}}, _ctx},
         state,
         _findings
       ) do
    state
    |> AgentIo.block_task(reason, diagnosis)
    |> finish_task(:blocked)
  end

  defp handle_correction_outcome({:limit_reached, ctx}, state, _findings) do
    state
    |> AgentIo.block_task("limite de iterações atingido (correção)", last_terminal_output(ctx))
    |> finish_task(:blocked)
  end

  defp handle_correction_outcome({:budget_exceeded, ctx}, state, _findings) do
    state
    |> AgentIo.block_task(
      "orçamento de tokens excedido (correção)",
      "gasto: #{ctx.tokens_spent_micros} micro-USD (teto: #{ctx.token_budget_micros})"
    )
    |> finish_task(:blocked)
  end

  defp handle_correction_outcome({:ok, ctx}, state, _findings) do
    state
    |> AgentIo.block_task(
      "parou sem concluir nem reportar bloqueio (correção)",
      stop_diagnosis(ctx)
    )
    |> finish_task(:blocked)
  end

  defp trigger_gate_recheck(state, "qa"),
    do: :ok = Dispatcher.run_qa(state.project_id, state.task_id)

  defp trigger_gate_recheck(state, "secops"),
    do: :ok = Dispatcher.run_secops(state.project_id, state.task_id)

  defp handle_outcome({:halted, {"report_done", %{summary: summary}}, _ctx}, state, task, story) do
    AgentIo.propose_commit(state, summary)
    AgentIo.propose_push(state)
    propose_pr(state, task, story)

    _ =
      EngineApiClient.mark_task(
        state.project_id,
        state.session_id,
        state.task_id,
        "in_review",
        state.agent_id
      )

    _ =
      EngineApiClient.open_gate(state.project_id, state.session_id, state.task_id, state.agent_id)

    :ok = Dispatcher.run_qa(state.project_id, state.task_id)

    # Fase 12b: PR aberta não libera o agente — o worktree é por AGENTE, não
    # por task (ver moduledoc), e o gate ainda vai varrê-lo. Só um desfecho
    # TERMINAL do gate (via `task.gate_resolved`) chama `finish_task/2`.
    state = %{state | status: :awaiting_gate}
    AgentIo.persist(state)

    AgentIo.emit(state, "dev.awaiting_gate", %{
      agentId: state.agent_id,
      taskId: state.task_id,
      gate: "qa"
    })

    state
  end

  defp handle_outcome(
         {:halted, {"report_blocked", %{reason: reason, diagnosis: diagnosis}}, _ctx},
         state,
         _task,
         _story
       ) do
    state
    |> AgentIo.block_task(reason, diagnosis)
    |> finish_task(:blocked)
  end

  defp handle_outcome({:limit_reached, ctx}, state, _task, _story) do
    state
    |> AgentIo.block_task("limite de iterações atingido", last_terminal_output(ctx))
    |> finish_task(:blocked)
  end

  defp handle_outcome({:budget_exceeded, ctx}, state, _task, _story) do
    state
    |> AgentIo.block_task(
      "orçamento de tokens excedido",
      "gasto: #{ctx.tokens_spent_micros} micro-USD (teto: #{ctx.token_budget_micros})"
    )
    |> finish_task(:blocked)
  end

  defp handle_outcome({:ok, ctx}, state, _task, _story) do
    state
    |> AgentIo.block_task("parou sem concluir nem reportar bloqueio", stop_diagnosis(ctx))
    |> finish_task(:blocked)
  end

  # Distingue falha de provider (timeout, 5xx) de "o modelo simplesmente parou".
  defp stop_diagnosis(ctx) do
    case Map.get(ctx, :last_error) do
      nil -> "o modelo encerrou o turno sem chamar report_done nem report_blocked"
      error -> "falha na chamada ao modelo: #{error}"
    end
  end

  defp last_terminal_output(ctx) do
    ctx
    |> Map.get(:messages, [])
    |> Enum.filter(&(Map.get(&1, "role") == "tool" and Map.get(&1, "name") == "terminal"))
    |> List.last()
    |> case do
      nil -> "(nenhum terminal rodado)"
      msg -> Map.get(msg, "content", "")
    end
  end

  defp propose_pr(state, task, story) do
    AgentIo.propose_pr(
      state,
      "#{story["title"]} — #{task["title"]}",
      pr_body(task, story)
    )
  end

  defp pr_body(task, story) do
    checklist =
      case Map.get(story, "dod", []) do
        [] -> "(sem DoD registrado)"
        items -> Enum.map_join(items, "\n", &"- [ ] #{&1}")
      end

    "Task: #{task["title"]}\n#{task["description"]}\n\n## Definition of Done\n#{checklist}"
  end
end
