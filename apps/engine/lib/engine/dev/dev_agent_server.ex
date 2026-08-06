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

  `status`: `:working | :awaiting_approval | :awaiting_gate | :idle |
  :idle_tripped`, persistido em `dev_agent_states.status`.

  `:awaiting_approval` entrou na Fase 12e. O agente propõe commit, push e PR e
  LÊ o status de cada uma: se alguma ficou `pending` (autonomia do dev em
  `require_approval`), **o gate não é aberto** — sem PR não há o que julgar. O
  defeito que isso corrige era silencioso e caro: o gate abria assim mesmo, o
  QA varria o WORKTREE (onde os arquivos estão), aprovava, e a task fechava
  sem uma linha commitada. Quem solta o agente é `task.pr_settled`, emitido
  pela api quando o `pr_open` tem desfecho — executado, negado ou falho.

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

  alias Engine.Agents.FalhaDeTurno
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
      max_consecutive_blocked: max_consecutive_blocked,
      # O laço suspenso à espera de aprovação (ADR 0052). Só em memória: o
      # agente continua vivo enquanto espera, e restart cai no caminho de
      # bloqueio com diagnóstico que já existe.
      laco_pendente: nil
    }

    state = AgentIo.resume_state(base, resume)
    AgentIo.persist(state)
    :ok = Wake.subscribe(project_id, agent_id)

    # A recuperação de um `working` interrompido sai do `init/1` por
    # `{:continue, ...}` — ela BLOQUEIA (block_task + claim, que pode rodar um
    # ToolLoop inteiro), e `start_link`/`start_child` esperam `:infinity`.
    # Fazendo isso dentro do `init/1`, o `DevRehydrator` (que roda na árvore
    # de supervisão da aplicação) segurava o BOOT pela duração de uma task de
    # LLM, `Readiness.mark(:dev_agents)` nunca disparava (o `/ready` ficava
    # 503 e o Kubernetes matava o pod), e qualquer exceção derrubava a
    # reidratação de TODOS os outros agentes. Com `handle_continue` o `init`
    # volta a ser instantâneo e a recuperação acontece já supervisionada.
    # `awaiting_approval` entra aqui pelo MESMO motivo que `working`: o laço
    # suspenso vive em memória (`laco_pendente`), e o restart o levou. Sem esta
    # linha o agente reidratava esperando um desfecho que não teria como
    # aplicar — e como `handle_info({:action_settled, _}, state)` ignora quem
    # não tem laço, ele esperaria PARA SEMPRE, sem erro, sem bloqueio e sem
    # diagnóstico. Falha silenciosa é o que o ADR 0052 existe para acabar; ela
    # não pode voltar um degrau acima.
    if resume && resume.status in ["working", "awaiting_approval"] do
      {:ok, state, {:continue, {:restart_recovery, resume.status}}}
    else
      {:ok, state}
    end
  end

  @impl true
  def handle_continue({:restart_recovery, "awaiting_approval"}, state) do
    {:noreply,
     state
     |> AgentIo.block_task(
       "engine reiniciou enquanto a task esperava aprovação",
       "o laço estava suspenso esperando a decisão de uma ação, e o contexto " <>
         "dele só existia em memória — aprovar agora não teria onde ser " <>
         "aplicado. A task volta para a fila; a ação decidida fica no log.",
       # `infra`: quem derrubou o turno foi o processo reiniciando, não o
       # modelo, não o código do agente e não uma política.
       "infra"
     )
     |> finish_restart_recovery()}
  end

  def handle_continue({:restart_recovery, _}, state) do
    {:noreply,
     state
     |> AgentIo.block_task(
       "engine reiniciou durante a task",
       "o ToolLoop não pôde ser retomado após o restart — turno, mensagens " <>
         "e edições do worktree só existiam em memória",
       "infra"
     )
     |> finish_restart_recovery()}
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

  # Guard de estado (D4): correção só faz sentido para quem está ESPERANDO um
  # gate. `DevAgentServer.correct/3` é um cast puro, disparado pelos gates —
  # uma entrega tardia (o agente já seguiu para outra task) rodaria a correção
  # do gate ANTIGO contra o `task_id` ATUAL, corrompendo o trabalho em curso.
  @impl true
  def handle_cast({:correct, findings}, %{status: :awaiting_gate} = state) do
    state = %{state | status: :working}
    AgentIo.persist(state)

    case ContextBuilder.fetch(state.project_id, state.session_id, state.task_id, state.module) do
      {:ok, dev_context} ->
        {:noreply, implement_correction(state, dev_context, findings)}

      {:error, reason} ->
        # DESFECHO TERMINAL, não só um log. Antes o agente voltava com
        # `status: :working` e `task_id` setado, e daí nenhum dos três
        # `handle_info/2` agia nunca mais — travado por uma falha
        # transitória de leitura de contexto.
        AgentIo.emit(state, "dev.error", %{agentId: state.agent_id, reason: inspect(reason)})

        {:noreply,
         state
         |> AgentIo.block_task(
           "falha ao montar contexto da correção",
           inspect(reason),
           # Montar contexto é chamada à api; falhar aqui é infraestrutura,
           # não o modelo (que nem chegou a ser chamado).
           "infra"
         )
         |> finish_task(:blocked)}
    end
  end

  def handle_cast({:correct, _findings}, state), do: {:noreply, state}

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

  # A ação que segurava o laço teve desfecho (ADR 0052). O resultado de verdade
  # entra no lugar onde estaria a palavra "pending", e o laço RETOMA do ponto em
  # que parou — o histórico inteiro estava guardado no `ctx`.
  #
  # Recusa também é resposta: o agente lê o motivo, aprende que aquele caminho
  # está fechado e tenta outro, em vez de esperar para sempre.
  def handle_info(
        {:action_settled, %{action_id: action_id} = desfecho},
        %{status: :awaiting_approval, laco_pendente: %{action_id: action_id} = pendente} = state
      ) do
    ctx =
      Map.update!(pendente.ctx, :messages, fn messages ->
        messages ++
          [
            %{
              "role" => "tool",
              "content" => texto_do_desfecho(desfecho),
              "toolCallId" => pendente.tool_call_id,
              "name" => pendente.tool_name,
              :pinned => false
            }
          ]
      end)

    state = %{state | status: :working, laco_pendente: nil}
    AgentIo.persist(state)

    {:noreply,
     ctx
     |> ToolLoop.run()
     |> handle_outcome(state, pendente.task, pendente.story)}
  end

  # Desfecho de OUTRA ação, ou o agente já não está esperando: ignora em vez de
  # derrubar. A entrega é por agente, e nada garante que só chegue o que se
  # espera.
  def handle_info({:action_settled, _}, state), do: {:noreply, state}

  # Só age se estiver livre (`:idle`) — em `:working`/`:awaiting_gate` a fila
  # já está sendo atendida ou o agente está no meio de outra coisa;
  # `:idle_tripped` ignora até rearmar.
  @impl true
  # Desfecho do `pr_open` que estava pendente de aprovação (Fase 12e).
  # `opened: true` — a PR existe agora; abre o gate, tarde mas correto.
  def handle_info(
        {:pr_settled, %{task_id: task_id, opened: true}},
        %{task_id: task_id, status: :awaiting_approval} = state
      ) do
    {:noreply, abrir_gate(state)}
  end

  # `opened: false` — o usuário negou, ou a abertura falhou. A task volta com
  # diagnóstico em vez de o agente esperar para sempre por um gate que ninguém
  # vai abrir. NÃO conta pro circuit breaker: a decisão foi do usuário, não o
  # agente queimando o teto (mesmo princípio da recuperação de restart).
  def handle_info(
        {:pr_settled, %{task_id: task_id, opened: false}},
        %{task_id: task_id, status: :awaiting_approval} = state
      ) do
    state =
      AgentIo.block_task(
        state,
        "a PR não foi aberta",
        "as ações git da task não foram aprovadas — o trabalho ficou no worktree e o gate nunca abriu",
        # `politica`: foi uma DECISÃO — o usuário negou, ou a política recusou.
        # Nada quebrou.
        "politica"
      )

    {:noreply,
     state
     |> Map.merge(%{task_id: nil, worktree: nil, branch: nil})
     |> try_claim()}
  end

  def handle_info({:pr_settled, _}, state), do: {:noreply, state}

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
  #
  # A lógica vive em `AgentIo.try_claim/2` e `AgentIo.finish_task/3`, junto do
  # resto do que os dois dev agents compartilham: a 12b nasceu só aqui, e o
  # `NoopDevAgentServer` ficou processando UMA task e parando — o achado #10
  # vivo dentro do único veículo de validação sem LLM. Estes dois wrappers
  # existem só para amarrar o `run_task/2` deste agente.

  defp try_claim(state), do: AgentIo.try_claim(state, &run_task/2)

  defp finish_task(state, desfecho), do: AgentIo.finish_task(state, desfecho, &run_task/2)

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
            |> AgentIo.block_task("falha ao montar contexto da task", inspect(reason), "infra")
            |> finish_task(:blocked)
        end

      {:error, reason} ->
        AgentIo.emit(state, "dev.error", %{agentId: state.agent_id, reason: inspect(reason)})

        state
        |> AgentIo.block_task("falha ao preparar o worktree", inspect(reason), "codigo")
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

  # O que o modelo lê no lugar da palavra "pending".
  #
  # Aprovada e executada: a saída real do comando, no mesmo formato que o
  # tool-result teria trazido se a ação fosse auto-aprovada — o modelo não
  # precisa saber que houve uma espera no meio.
  defp texto_do_desfecho(%{status: "executed", execution_result: %{} = exec}) do
    "exit #{Map.get(exec, "exitCode", "?")}\n#{Map.get(exec, "stdout", "")}"
  end

  defp texto_do_desfecho(%{status: "failed", execution_result: %{} = exec}) do
    "falhou: #{Map.get(exec, "stderr", "")}#{Map.get(exec, "stdout", "")}"
  end

  # Recusa é RESPOSTA, não silêncio: o motivo entra no lugar do resultado, para
  # o agente aprender que aquele caminho está fechado e tentar outro.
  defp texto_do_desfecho(%{status: "denied"} = desfecho) do
    motivo = Map.get(desfecho, :rejection_reason) || "sem motivo informado"
    "recusado pelo usuário: #{motivo}"
  end

  defp texto_do_desfecho(%{status: status}), do: "desfecho da ação: #{status}"

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

  # Mesmas origens do caminho normal — a correção pós-gate é o mesmo laço com
  # outro prompt, e o que decidiu parar é o mesmo.
  defp handle_correction_outcome(
         {:halted, {"report_blocked", %{reason: reason, diagnosis: diagnosis}}, _ctx},
         state,
         _findings
       ) do
    state
    |> AgentIo.block_task(reason, diagnosis, "modelo")
    |> finish_task(:blocked)
  end

  defp handle_correction_outcome({:limit_reached, ctx}, state, _findings) do
    state
    |> AgentIo.block_task(
      "limite de iterações atingido (correção)",
      last_terminal_output(ctx),
      "modelo"
    )
    |> finish_task(:blocked)
  end

  defp handle_correction_outcome({:budget_exceeded, ctx}, state, _findings) do
    state
    |> AgentIo.block_task(
      "orçamento de tokens excedido (correção)",
      "gasto: #{ctx.tokens_spent_micros} micro-USD (teto: #{ctx.token_budget_micros})",
      "politica"
    )
    |> finish_task(:blocked)
  end

  defp handle_correction_outcome({:ok, ctx}, state, _findings) do
    state
    |> AgentIo.block_task(
      "parou sem concluir nem reportar bloqueio (correção)",
      stop_diagnosis(ctx),
      origem_da_parada(ctx)
    )
    |> finish_task(:blocked)
  end

  defp trigger_gate_recheck(state, "qa"),
    do: :ok = Dispatcher.run_qa(state.project_id, state.task_id)

  defp trigger_gate_recheck(state, "secops"),
    do: :ok = Dispatcher.run_secops(state.project_id, state.task_id)

  # A ferramenta ficou pendente de aprovação (ADR 0052). O agente PARA e retém
  # tudo — worktree, task e o `ctx` do laço, com o histórico de mensagens —, do
  # mesmo jeito que já retém em `awaiting_gate`.
  #
  # O `ctx` fica em MEMÓRIA, não no banco: o agente continua vivo, só ocioso.
  # Restart durante a espera cai no caminho de bloqueio com diagnóstico que já
  # existe, e persistir histórico de mensagens é problema à parte.
  defp handle_outcome(
         {:halted, {:awaiting_approval, action_id, tool_call_id, tool_name}, ctx},
         state,
         task,
         story
       ) do
    state = %{
      state
      | status: :awaiting_approval,
        laco_pendente: %{
          ctx: ctx,
          action_id: action_id,
          tool_call_id: tool_call_id,
          tool_name: tool_name,
          # `task` e `story` viajam junto porque o desfecho do laço precisa
          # deles (abrir PR, por exemplo) — e na retomada não há de onde
          # buscá-los sem ir ao banco de novo.
          task: task,
          story: story
        }
    }

    AgentIo.persist(state)

    AgentIo.emit(state, "dev.awaiting_approval", %{
      agentId: state.agent_id,
      taskId: state.task_id,
      actionId: action_id,
      tool: tool_name
    })

    state
  end

  defp handle_outcome({:halted, {"report_done", %{summary: summary}}, _ctx}, state, task, story) do
    desfechos = [
      AgentIo.propose_commit(state, summary),
      AgentIo.propose_push(state),
      propose_pr(state, task, story)
    ]

    _ =
      EngineApiClient.mark_task(
        state.project_id,
        state.session_id,
        state.task_id,
        "in_review",
        state.agent_id
      )

    if Enum.all?(desfechos, &(&1 == :executed)) do
      abrir_gate(state)
    else
      aguardar_aprovacao(state, desfechos)
    end
  end

  # As origens abaixo NÃO são chute: cada desfecho do ToolLoop diz quem
  # decidiu parar, e é isso que a origem nomeia (achados P/Q/T).
  #
  # `report_blocked` é o MODELO declarando que não consegue — foi ele que
  # decidiu, com o diagnóstico que ele mesmo escreveu.
  defp handle_outcome(
         {:halted, {"report_blocked", %{reason: reason, diagnosis: diagnosis}}, _ctx},
         state,
         _task,
         _story
       ) do
    state
    |> AgentIo.block_task(reason, diagnosis, "modelo")
    |> finish_task(:blocked)
  end

  # Teto de iterações: o modelo gastou o que tinha sem concluir.
  defp handle_outcome({:limit_reached, ctx}, state, _task, _story) do
    state
    |> AgentIo.block_task("limite de iterações atingido", last_terminal_output(ctx), "modelo")
    |> finish_task(:blocked)
  end

  # Orçamento é POLÍTICA: o teto foi decidido por quem configurou, e a recusa é
  # o produto cumprindo a regra — não uma falha do modelo nem do código.
  defp handle_outcome({:budget_exceeded, ctx}, state, _task, _story) do
    state
    |> AgentIo.block_task(
      "orçamento de tokens excedido",
      "gasto: #{ctx.tokens_spent_micros} micro-USD (teto: #{ctx.token_budget_micros})",
      "politica"
    )
    |> finish_task(:blocked)
  end

  # O caminho do achado T. Quando há `last_error`, a origem sai do MESMO erro
  # que o diagnóstico já narra — antes, `diagnosis` dizia "falha na chamada ao
  # modelo: {413, …}" e `origem` dizia "indeterminada", na mesma linha.
  defp handle_outcome({:ok, ctx}, state, _task, _story) do
    state
    |> AgentIo.block_task(
      "parou sem concluir nem reportar bloqueio",
      stop_diagnosis(ctx),
      origem_da_parada(ctx)
    )
    |> finish_task(:blocked)
  end

  # Caminho normal (autonomia `auto_approve`, o default da ativação): a PR
  # existe, o gate pode julgar.
  defp abrir_gate(state) do
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

  # Alguma das três ações git ficou pendente de aprovação (autonomia do dev em
  # `require_approval`). O gate NÃO abre: sem PR não há o que julgar, e abrir
  # aqui era o defeito — o QA varria o worktree, aprovava, e a task fechava
  # sem uma linha commitada (Fase 12e).
  #
  # O agente fica retendo o worktree, exatamente como em `awaiting_gate`. Quem
  # o solta é `task.pr_settled`, emitido pela api quando o `pr_open` tem
  # desfecho — aprovado e executado, negado, ou falho.
  defp aguardar_aprovacao(state, desfechos) do
    state = %{state | status: :awaiting_approval}
    AgentIo.persist(state)

    AgentIo.emit(state, "dev.awaiting_approval", %{
      agentId: state.agent_id,
      taskId: state.task_id,
      pendentes: Enum.count(desfechos, &(&1 == :pending))
    })

    state
  end

  # Distingue falha de provider (timeout, 5xx) de "o modelo simplesmente parou".
  defp stop_diagnosis(ctx) do
    case Map.get(ctx, :last_error) do
      nil -> "o modelo encerrou o turno sem chamar report_done nem report_blocked"
      error -> "falha na chamada ao modelo: #{error}"
    end
  end

  # A origem da MESMA parada que `stop_diagnosis/1` narra — as duas leem
  # `last_error`, e é isso que impede o par diagnóstico/origem de se
  # contradizer, que foi o achado T.
  #
  # Sem `last_error` a parada é do modelo: ele encerrou o turno sem chamar
  # `report_done` nem `report_blocked`, o que é decisão dele e não falha de
  # ninguém mais.
  defp origem_da_parada(ctx) do
    case Map.get(ctx, :last_error) do
      nil -> "modelo"
      error -> FalhaDeTurno.origem(error)
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
