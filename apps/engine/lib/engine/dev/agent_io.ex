defmodule Engine.Dev.AgentIo do
  @moduledoc """
  Efeitos colaterais compartilhados pelos dev agents (Fase 4a): registro no
  Registry, event log, estado durável, e as propostas git (commit/push/pr) com
  a identidade `dev-<modulo>[bot]`.

  Existe porque há DUAS implementações de dev agent — o `DevAgentServer` real
  (ToolLoop + LLM) e o `NoopDevAgentServer` (sem LLM, validação da
  infraestrutura). O Noop só serve de smoke test se exercitar ESTE código, e
  não uma cópia dele: worktree, identidade de commit e pipeline de
  `proposed_actions` são exatamente o que ele existe pra validar.

  Todas as funções recebem o `state` do GenServer, que precisa ter as chaves
  `:project_id`, `:agent_id`, `:module`, `:session_id`, `:task_id`,
  `:worktree`, `:branch`, `:impl`, `:task_budget_micros`,
  `:max_gate_corrections`, `:status` e `:consecutive_blocked`/
  `:max_consecutive_blocked` (Fase 12b — circuit breaker por agente).
  """

  alias Engine.Dev.DevAgentState
  alias Engine.Harness.ArtifactEmitter
  alias Engine.Sessions.EngineApiClient

  @doc "Nome registrado do agente — a chave do Registry é {project_id, agent_id}."
  def via(project_id, agent_id),
    do: {:via, Registry, {Engine.Dev.Registry, {project_id, agent_id}}}

  # WorktreeManager trocável em teste (sem git/banco de repo real).
  def worktree_manager,
    do: Application.get_env(:engine, :worktree_manager, Engine.Dev.WorktreeManager)

  @doc "Reivindica a próxima task pegável do módulo (claim atômico na api)."
  def claim_task(state) do
    EngineApiClient.claim_task(
      state.project_id,
      state.session_id,
      state.module,
      state.agent_id
    )
  end

  # --- Propostas git (pipeline de proposed_actions) ---

  @doc """
  Propõe o commit do trabalho no worktree. A identidade é a regra do CLAUDE.md:
  author `dev-<modulo>[bot]`, usuário como co-author (`Co-authored-by` montado
  pelo `Engine.Actions.GitExecutor`).
  """
  def propose_commit(state, message) do
    message = if message == "", do: "#{state.agent_id}: #{state.task_id}", else: message

    propose(state, "git_commit", %{
      worktree: state.worktree,
      branch: state.branch,
      message: message,
      author: "#{state.agent_id}[bot]",
      authorEmail: "#{state.agent_id}-bot@brabo.dev",
      coAuthor: "Brabo User <user@brabo.dev>"
    })
  end

  def propose_push(state) do
    propose(state, "git_push", %{worktree: state.worktree, branch: state.branch})
  end

  def propose_pr(state, title, body) do
    propose(state, "pr_open", %{
      sourceBranch: state.branch,
      title: title,
      body: body,
      storyTaskId: state.task_id
    })
  end

  def propose(state, type, payload) do
    actor = %{kind: "agent", id: state.agent_id}

    case EngineApiClient.propose_action(state.project_id, state.session_id, type, actor, payload) do
      {:ok, _action} -> :ok
      {:error, reason} -> emit(state, "dev.error", %{action: type, reason: inspect(reason)})
    end
  end

  # --- Devolução da task ---

  @doc """
  Devolve a task com diagnóstico (`blocked`) — nunca deixa uma task
  reivindicada órfã, sem dono vivo e invisível pro claim (que só pega `todo`).
  Devolve o `state` pra encadear no fluxo do GenServer.
  """
  def block_task(state, reason, diagnosis) do
    emit(state, "dev.blocked", %{
      agentId: state.agent_id,
      taskId: state.task_id,
      reason: reason,
      diagnosis: diagnosis
    })

    # Artefato do desfecho, além do evento de narrativa acima: é o registro
    # durável e validado (`Engine.Harness.ArtifactSchemas`) que o usuário lê pra
    # decidir se desbloqueia a task. Emitido pelo servidor — o modelo não
    # escolhe declarar que desistiu.
    emit_artifact(state, "task_blocked", %{
      taskId: state.task_id,
      agentId: state.agent_id,
      reason: reason,
      diagnosis: diagnosis
    })

    _ =
      EngineApiClient.mark_task_blocked(
        state.project_id,
        state.session_id,
        state.task_id,
        reason,
        diagnosis,
        state.agent_id
      )

    state
  end

  # --- Estado durável / event log ---

  def persist(state) do
    DevAgentState.upsert!(%{
      project_id: state.project_id,
      agent_id: state.agent_id,
      module: state.module,
      session_id: state.session_id,
      task_id: state.task_id,
      worktree_path: state.worktree,
      # Fase 12b: o estado real do agente (idle | working | awaiting_gate |
      # idle_tripped), não mais hardcoded — é o que a reidratação e o
      # painel passam a ler.
      status: to_string(state.status),
      # OBRIGATÓRIO mesmo quando nil: a coluna está na lista de :replace do
      # on_conflict, então omitir aqui APAGA o teto gravado no init — e os
      # gates leem esse campo do banco (qa/secops_agent_server), caindo no
      # DEFAULT_MAX_GATE_CORRECTIONS da api sem o usuário pedir.
      task_budget_micros: state.task_budget_micros,
      max_gate_corrections: state.max_gate_corrections,
      consecutive_blocked: state.consecutive_blocked,
      max_consecutive_blocked: state.max_consecutive_blocked,
      # Mesma armadilha do :replace acima — e omitir aqui faria a reidratação
      # subir um agente REAL onde havia um Noop (e vice-versa).
      impl: state.impl
    })
  end

  @doc """
  Emite um artefato (`session_event` `artifact.<tipo>`) validado contra
  `Engine.Harness.ArtifactSchemas`. Payload inválido NÃO derruba o agente: o
  bloqueio da task (o efeito que importa) já aconteceu, e perder o artefato não
  pode virar um crash que deixa a task sem dono.
  """
  def emit_artifact(state, type, payload) do
    ArtifactEmitter.emit(state.project_id, state.session_id, state.agent_id, type, payload)
  end

  def emit(state, type, payload) do
    ArtifactEmitter.append(state.project_id, state.session_id, state.agent_id, type, payload)
  end
end
