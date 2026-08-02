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
  git — vem de `Engine.Dev.AgentIo`, o MESMO código do agente real: um Noop
  que reimplementasse essas partes validaria uma cópia, não a infraestrutura.

  **Não abre gate.** O QA é um agente de LLM; o Noop para na PR aberta, e o
  fluxo dev↔gate é o caminho do agente real.
  """

  use GenServer, restart: :temporary

  alias Engine.Dev.AgentIo
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
         max_consecutive_blocked, _resume}
      ) do
    state = %{
      project_id: project_id,
      agent_id: agent_id,
      module: module,
      session_id: session_id,
      task_id: nil,
      worktree: nil,
      branch: nil,
      impl: @impl_tag,
      # Não gasta token nem passa por gate, mas os tetos viajam no estado
      # durável: o subagente extra da paralelização HERDA a linha do agente
      # base, e trocar o modo não pode zerar o que o usuário configurou.
      task_budget_micros: task_budget_micros,
      max_gate_corrections: max_gate_corrections,
      # O Noop nunca abre gate nem é acordado por evento (Fase 12b) — fica
      # sempre "working" pro persist/1 compartilhado, igual ao hardcode que
      # existia antes disso virar `state.status` de verdade.
      status: :working,
      consecutive_blocked: 0,
      max_consecutive_blocked: max_consecutive_blocked
    }

    AgentIo.persist(state)

    {:ok, state}
  end

  @impl true
  def handle_cast(:work, state) do
    AgentIo.emit(state, "dev.started", %{agentId: state.agent_id, module: state.module})

    case AgentIo.claim_task(state) do
      {:ok, nil} ->
        AgentIo.emit(state, "dev.idle", %{agentId: state.agent_id, reason: "sem task pegável"})
        {:noreply, state}

      {:ok, task} ->
        {:noreply, run_task(state, task)}

      {:error, reason} ->
        AgentIo.emit(state, "dev.error", %{agentId: state.agent_id, reason: inspect(reason)})
        {:noreply, state}
    end
  end

  @impl true
  def handle_cast({:correct, findings}, state) do
    # Defensiva: `DevAgentServer.correct/3` é um cast no `via/2`, então o
    # Registry entregaria a devolução de um gate AQUI se algum fosse aberto
    # pro Noop. Ele não sabe corrigir nada (não tem LLM) — devolve a task com
    # diagnóstico em vez de derrubar o processo.
    {:noreply,
     AgentIo.block_task(
       state,
       "NoopDevAgent não corrige devolução de gate",
       "gate: #{inspect(Map.get(findings, :gate))}"
     )}
  end

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
