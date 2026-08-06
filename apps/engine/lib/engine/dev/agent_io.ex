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

  @doc """
  Monta o state inicial a partir da linha durável (`nil` = start fresco).

  Compartilhado pelos dois agentes desde a Fase 12d: o modo (`impl`) volta da
  linha, então uma reidratação que divergisse entre Noop e real produziria dois
  agentes com semânticas diferentes para a MESMA linha de `dev_agent_states`.
  """
  # Start fresco: sempre idle, sem task — igual a antes da Fase 12b-6.
  def resume_state(base, nil) do
    Map.merge(base, %{
      task_id: nil,
      worktree: nil,
      branch: nil,
      status: :idle,
      consecutive_blocked: 0
    })
  end

  # `awaiting_gate`, `awaiting_approval` e `working` retêm task_id/worktree — o worktree
  # reidratado ainda está no disco (não foi apagado; só seria substituído
  # por um `add_worktree/3` futuro), e um gate tardio ainda o encontra via
  # `find_by_task_id/2`. `branch` não é persistido (nunca foi — só
  # task_id/worktree_path), reconstruído do mesmo jeito que `run_task/2` o
  # monta originalmente.
  def resume_state(base, %{status: status} = row)
      when status in ["awaiting_gate", "awaiting_approval", "working"] do
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
  def resume_state(base, row) do
    Map.merge(base, %{
      task_id: nil,
      worktree: nil,
      branch: nil,
      status: String.to_existing_atom(row.status),
      consecutive_blocked: row.consecutive_blocked
    })
  end

  # --- Máquina de estados do reagendamento (Fase 12b — RN-047) ---
  #
  # Mora aqui pelo MESMO motivo que o resto deste módulo: há duas
  # implementações de dev agent, e a que serve de smoke test sem LLM só prova
  # alguma coisa se exercitar este código e não uma cópia dele. A 12b nasceu
  # só no `DevAgentServer`, e a consequência foi concreta: o `NoopDevAgentServer`
  # continuava processando UMA task e parando — o mesmo achado #10 que a fase
  # existiu para matar, vivo no único veículo de validação sem modelo.
  #
  # O que difere entre os dois agentes é `run_task`, e só ele — por isso entra
  # como função, não como behaviour: um callback obrigaria os dois servers a
  # declarar `@behaviour` e reimplementar o contrato inteiro para uma
  # divergência de uma função.

  @default_max_consecutive_blocked 3

  @doc """
  Ponto ÚNICO de claim. Chamado pelo `:work` inicial e por `finish_task/3`
  sempre que uma task termina e o agente segue livre.

  `run_task` recebe `{state_em_working, task}` e devolve o novo state.
  """
  def try_claim(state, run_task) when is_function(run_task, 2) do
    case claim_task(state) do
      {:ok, nil} ->
        state = %{state | status: :idle}
        persist(state)
        emit(state, "dev.idle", %{agentId: state.agent_id, reason: "sem task pegável"})
        state

      {:ok, task} ->
        run_task.(%{state | status: :working}, task)

      {:error, reason} ->
        # CAI EM `:idle`, e persiste. Devolver o state intocado aqui travava o
        # agente PARA SEMPRE: `finish_task/3` já zerou `task_id` mas não mexe
        # em `status`, então o agente ficava `:awaiting_gate` com `task_id`
        # nil — e aí os guards de `handle_info/2` falham todos
        # (`gate_resolved` exige task_id batendo, `became_claimable` exige
        # `:idle`, `:rearm` exige `:idle_tripped`). Um 5xx transitório da api
        # no claim produzia exatamente o sintoma que esta fase existe para
        # eliminar. `:idle` é o único estado do qual um wake ainda resgata.
        state = %{state | status: :idle}
        persist(state)
        emit(state, "dev.error", %{agentId: state.agent_id, reason: inspect(reason)})
        state
    end
  end

  @doc """
  Único lugar que zera task_id/worktree/branch — deixá-los obsoletos faria um
  gate tardio achar o worktree ERRADO via `DevAgentState.find_by_task_id/2`.

  `:approved` zera o contador do breaker; `:blocked` incrementa e, ao bater o
  teto, para em `:idle_tripped` SEM tentar reivindicar.
  """
  def finish_task(state, :approved, run_task) do
    state
    |> Map.merge(%{task_id: nil, worktree: nil, branch: nil, consecutive_blocked: 0})
    |> try_claim(run_task)
  end

  def finish_task(state, :blocked, run_task) do
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
      persist(state)

      emit(state, "dev.idle_tripped", %{
        agentId: state.agent_id,
        consecutiveBlocked: counter
      })

      state
    else
      try_claim(state, run_task)
    end
  end

  defp tripped?(counter, max) when is_integer(max), do: counter >= max
  defp tripped?(counter, _), do: counter >= @default_max_consecutive_blocked

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

  @doc """
  Propõe uma ação e devolve o STATUS com que ela nasceu.

  Descartava o status até a Fase 12e (`{:ok, _action} -> :ok`), e o preço foi
  concreto: com a autonomia do dev em `require_approval`, commit/push/PR
  nasciam `pending` e o agente abria o gate assim mesmo. O QA varria o
  worktree — os arquivos estavam lá —, aprovava, a task fechava, e a PR nunca
  tinha existido.

  `:executed` cobre `executed` e `auto_approved` porque, para quem propôs, os
  dois significam a mesma coisa: aconteceu. `:pending` é a espera; qualquer
  outro desfecho (`denied`, `failed`) é `:refused`.
  """
  def propose(state, type, payload) do
    actor = %{kind: "agent", id: state.agent_id}

    case EngineApiClient.propose_action(state.project_id, state.session_id, type, actor, payload) do
      {:ok, action} ->
        classify(Map.get(action, "status"))

      {:error, reason} ->
        emit(state, "dev.error", %{action: type, reason: inspect(reason)})
        :refused
    end
  end

  defp classify(status) when status in ["executed", "auto_approved"], do: :executed
  defp classify("pending"), do: :pending
  defp classify(_), do: :refused

  # --- Devolução da task ---

  @doc """
  Devolve a task com diagnóstico (`blocked`) — nunca deixa uma task
  reivindicada órfã, sem dono vivo e invisível pro claim (que só pega `todo`).
  Devolve o `state` pra encadear no fluxo do GenServer.

  A ORIGEM é obrigatória — **sem default**, e é aí que está a correção.

  Ela já era "obrigatória em espírito", com `"indeterminada"` de default. Não
  funcionou: o desfecho mais caro da execução real (o `413` que encerrou a
  rodada) saiu como `"indeterminada"` justamente porque o call site não passou
  nada, enquanto o campo `diagnosis` ao lado nomeava a causa na mesma linha.
  Default é um convite a esquecer, e ninguém percebe o esquecimento — o evento
  fica sintaticamente válido e semanticamente vazio.

  Sem default, esquecer vira erro de compilação. É a única forma de garantia
  que não depende de alguém lembrar (achados P, Q e T).

  O valor precisa ser uma das quatro origens do ADR 0020 —
  `infra | modelo | codigo | politica`. `Engine.Agents.FalhaDeTurno.origem/1`
  deriva a origem de um erro; use-a em vez de decidir no olho.
  """
  def block_task(state, reason, diagnosis, origem) do
    emit(state, "dev.blocked", %{
      agentId: state.agent_id,
      taskId: state.task_id,
      reason: reason,
      diagnosis: diagnosis,
      origem: origem
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
        state.agent_id,
        origem
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
