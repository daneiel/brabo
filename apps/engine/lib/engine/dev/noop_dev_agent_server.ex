defmodule Engine.Dev.NoopDevAgentServer do
  @moduledoc """
  Dev agent BURRO (Fase 4a) — valida a infraestrutura de execução sem LLM:
  reivindica uma task, monta um worktree isolado, escreve um arquivo trivial,
  e propõe commit → push → pr_open pelo pipeline de `proposed_actions`
  (autonomia `auto_approve` executa). Nenhuma chamada de modelo, nenhum gasto
  de token, resultado determinístico.

  Convive com o `Engine.Dev.DevAgentServer` real: mesmo Registry, mesmo
  `agent_id` (`dev-<modulo>`), mesmo estado durável. O modo é escolhido na
  ativação da execução e gravado em `dev_agent_states.impl`, pra que a
  reidratação suba o server certo depois de um restart do nó.

  Tudo que ele exercita — worktree, identidade `dev-<modulo>[bot]`, propostas
  git, e desde a Fase 12d a máquina de estados do reagendamento — vem de
  `Engine.Dev.AgentIo`, o MESMO código do agente real: um Noop que
  reimplementasse essas partes validaria uma cópia, não a infraestrutura.

  **Não JULGA, mas participa do ciclo do gate.** Ele não tem LLM: não corrige
  uma devolução e não emite parecer. Mas abre a PR, fica em `:awaiting_gate`
  retendo o worktree, e reage ao desfecho como o agente real — aprovado,
  reivindica a próxima; bloqueado, conta para o circuit breaker.

  Até a Fase 12d isto não era verdade: o Noop fixava `status: :working`, não
  assinava o `Engine.Dev.Wake` e processava UMA task antes de parar. Ou seja,
  o achado #10 do dogfooding — que a Fase 12b existiu para matar — seguia vivo
  dentro do único veículo capaz de validar a fase sem gastar token. Uma
  validação de ponta a ponta com este agente reprovaria o critério "zero
  restarts" por defeito do próprio instrumento.
  """

  use GenServer, restart: :temporary

  alias Engine.Dev.{AgentIo, Wake}
  alias Engine.Sessions.EngineApiClient

  @impl_tag "noop"

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
      # Não gasta token, mas os tetos viajam no estado durável: o subagente
      # extra da paralelização HERDA a linha do agente base, e trocar o modo
      # não pode zerar o que o usuário configurou.
      task_budget_micros: task_budget_micros,
      max_gate_corrections: max_gate_corrections,
      max_consecutive_blocked: max_consecutive_blocked
    }

    state = AgentIo.resume_state(base, resume)
    AgentIo.persist(state)
    :ok = Wake.subscribe(project_id, agent_id)

    # Mesma razão do agente real (D2): a recuperação de um `working`
    # interrompido bloqueia, e feita no `init/1` seguraria o boot inteiro pelo
    # `DevRehydrator`.
    if resume && resume.status == "working" do
      {:ok, state, {:continue, :restart_recovery}}
    else
      {:ok, state}
    end
  end

  @impl true
  def handle_continue(:restart_recovery, state) do
    state =
      AgentIo.block_task(
        state,
        "engine reiniciou durante a task",
        "o trabalho do NoopDevAgent não pôde ser retomado após o restart"
      )

    # SEM passar por `finish_task/3`: reiniciar o engine não é o agente
    # queimando o teto, e não pode contar pro circuit breaker.
    {:noreply,
     state
     |> Map.merge(%{task_id: nil, worktree: nil, branch: nil})
     |> try_claim()}
  end

  @impl true
  def handle_cast(:work, state) do
    AgentIo.emit(state, "dev.started", %{agentId: state.agent_id, module: state.module})
    {:noreply, try_claim(state)}
  end

  @impl true
  def handle_cast({:correct, findings}, %{status: :awaiting_gate} = state) do
    # O Noop não tem LLM: não sabe corrigir. Devolve a task com diagnóstico em
    # vez de derrubar o processo — e o `block_task` conta pro breaker pelo
    # `handle_info` do gate, como no agente real.
    {:noreply,
     AgentIo.block_task(
       state,
       "NoopDevAgent não corrige devolução de gate",
       "gate: #{inspect(Map.get(findings, :gate))}"
     )}
  end

  # Mesmo guard do agente real (D4): uma devolução que chega tarde, quando o
  # agente já seguiu para outra task, rodaria contra o `task_id` ERRADO.
  def handle_cast({:correct, _findings}, state), do: {:noreply, state}

  # --- Wakes (Fase 12b, entregues ao Noop desde a 12d) ---

  @impl true
  def handle_info(
        {:gate_resolved, %{task_id: task_id, next_action: next_action}},
        %{task_id: task_id, status: :awaiting_gate} = state
      ) do
    {:noreply, finish_task(state, desfecho(next_action))}
  end

  def handle_info({:gate_resolved, _}, state), do: {:noreply, state}

  def handle_info({:wake, :became_claimable}, %{status: :idle} = state) do
    {:noreply, try_claim(state)}
  end

  def handle_info({:wake, :became_claimable}, state), do: {:noreply, state}

  def handle_info(:rearm, %{status: :idle_tripped} = state) do
    state = %{state | consecutive_blocked: 0}
    AgentIo.persist(state)
    {:noreply, try_claim(state)}
  end

  def handle_info(:rearm, state), do: {:noreply, state}

  defp desfecho("done"), do: :approved
  defp desfecho(:done), do: :approved
  defp desfecho(_), do: :blocked

  # A máquina é a MESMA do agente real (`AgentIo`); só o `run_task/2` difere.
  defp try_claim(state), do: AgentIo.try_claim(state, &run_task/2)

  defp finish_task(state, desfecho), do: AgentIo.finish_task(state, desfecho, &run_task/2)

  # --- Ciclo do NoopDevAgent ---

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
        # Conteúdo trivial (sem LLM) só pra ter um diff.
        File.write!(Path.join(path, "NOOP-#{slug}.md"), noop_file_content(state, task))

        state = %{state | worktree: path, branch: branch}
        AgentIo.persist(state)

        AgentIo.emit(state, "dev.working", %{
          agentId: state.agent_id,
          taskId: task_id,
          branch: branch
        })

        AgentIo.propose_commit(state, "#{state.agent_id}: #{task_title(task)}")
        AgentIo.propose_push(state)
        AgentIo.propose_pr(state, "#{state.agent_id}: #{task_title(task)}", pr_body(state, task))

        _ =
          EngineApiClient.mark_task(
            state.project_id,
            state.session_id,
            task_id,
            "in_review",
            state.agent_id
          )

        # PR aberta NÃO libera o agente (Fase 12b): o worktree é por AGENTE,
        # não por task, e reivindicar a próxima agora apagaria fisicamente o
        # que o gate ainda precisa ler. Fica retido até o desfecho terminal.
        state = %{state | status: :awaiting_gate}
        AgentIo.persist(state)

        AgentIo.emit(state, "dev.awaiting_gate", %{
          agentId: state.agent_id,
          taskId: task_id
        })

        state

      {:error, reason} ->
        AgentIo.emit(state, "dev.error", %{agentId: state.agent_id, reason: inspect(reason)})
        AgentIo.block_task(state, "falha ao preparar o worktree", inspect(reason))
    end
  end

  defp task_title(task), do: Map.get(task, "title") || Map.get(task, "id")

  defp noop_file_content(state, task) do
    """
    # #{task_title(task)}

    Trabalho do #{state.agent_id} (módulo #{state.module}).

    Arquivo gerado pelo NoopDevAgent — validação da infraestrutura de execução
    (worktree isolado, identidade de commit, pipeline de proposed_actions).
    Sem LLM: o conteúdo é fixo de propósito.
    """
  end

  defp pr_body(state, task) do
    """
    PR aberta pelo **NoopDevAgent** (`#{state.agent_id}`), sem LLM.

    Task: #{task_title(task)} (`#{state.task_id}`)
    Branch: `#{state.branch}`

    Valida worktree isolado, identidade `#{state.agent_id}[bot]` e o pipeline
    de proposed_actions de ponta a ponta. Não passa pelos gates de QA/SecOps.
    """
  end
end
