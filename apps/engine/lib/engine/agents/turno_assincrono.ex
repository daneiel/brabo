defmodule Engine.Agents.TurnoAssincrono do
  @moduledoc """
  Turno pesado (loop de ferramentas + chamadas SSE ao LLM) rodando numa Task
  supervisionada, para o GenServer do agente conversacional (Criativo, PO,
  Arquiteto, Dev Lead) parar de ficar bloqueado dentro do próprio
  `handle_call` — era isso que impedia um comando `:cancel` de sequer ser
  atendido enquanto o turno rodava (RN-122).

  Os quatro `*Server` compartilhavam a MESMA estrutura de `handle_call`
  síncrono (broadcast "working" -> roda o turno inline -> broadcast "done" /
  "idle" -> `{:reply, ...}`), e esta extração evita repetir a lógica de
  Task/GenServer.reply/cancelamento quatro vezes.

  ## O mecanismo

  1. `iniciar/3` sobe uma `Task.Supervisor.async_nolink/2` rodando `fun`
     (a MESMA função que já rodava dentro do `handle_call` — `run_turn/1,2`
     ou uma variação que também cria handoff — só que agora fora dele) e
     devolve `{:noreply, state}`: a resposta ao `GenServer.call` original
     fica ADIADA, e o `from` viaja junto da referência da task em
     `state.turno_assincrono`. Chamado de um `handle_cast` (kickoff, que não
     tem `from` nenhum para responder), `from` é `nil`.
  2. Quando a task termina, a mensagem `{ref, resultado}` chega no
     `handle_info` do agente, que repassa para `tratar_resultado/2`: ele
     responde ao `from` (quando existe) com `GenServer.reply/2`, incorpora o
     `resultado` (o `state` final que a task devolveu) e emite os
     broadcasts efêmeros de fim de turno.
  3. `cancelar/1` mata a task em curso com `Task.shutdown/2` no modo
     `:brutal_kill` — o que derruba a CONEXÃO HTTP (SSE) que a task segura
     com a api, e é o que faz o cancelamento economizar token de verdade,
     não só parar de renderizar no cliente — responde ao `from` original
     com `{:error, :cancelado}` e grava o evento TERMINAL `agent.error`
     (sem ele a sessão fica pendurada pro terceiro sinal de pendência do
     `GetSessionPendingWorkUseCase`: `agent.activated` sem desfecho).

  Sem turno em curso, `cancelar/1` é NO-OP idempotente — não existe task
  para matar nem `from` pendente para responder.
  """

  require Logger

  alias Engine.Agents.FalhaDeTurno
  alias Engine.Sessions.{EngineApiClient, LiveBroadcast}

  @typedoc "O que fica guardado no state do agente enquanto o turno roda."
  @type turno :: %{task: Task.t(), from: GenServer.from() | nil}

  @doc """
  Inicia o turno em background. `fun` é uma função de aridade zero que roda
  o turno (e o que mais precisar, como emitir o product_brief ou criar um
  handoff) e devolve o `state` final — a MESMA função que corria inline
  dentro do `handle_call`/`handle_cast` antes desta mudança.

  `from` é o `GenServer.from()` de quem espera a resposta (`handle_call`),
  ou `nil` quando quem chamou foi um `handle_cast` (kickoff) sem ninguém
  esperando síncrono.

  Se já existe um turno em curso para este agente, NÃO sobe uma segunda
  task — duas tasks mexendo no mesmo histórico de mensagens correriam uma
  condição de corrida. Com `from` presente (era um `handle_call`), responde
  na hora com `{:error, :turno_em_andamento}`; sem `from` (era o `:kickoff`,
  que só deveria disparar uma vez por sessão), ignora e loga — é defensivo,
  não um caminho esperado.
  """
  @spec iniciar(map(), GenServer.from() | nil, (-> map())) ::
          {:noreply, map()} | {:reply, {:error, :turno_em_andamento}, map()}
  def iniciar(state, from, fun) do
    case Map.get(state, :turno_assincrono) do
      nil ->
        broadcast(state, "agent.status", %{status: "working"})
        # O dicionário de processo do chamador (menos as chaves `$...` que o
        # PRÓPRIO `Task` usa pra registrar a cadeia de ancestralidade — ver
        # `Ecto.Adapters.SQL.Sandbox`, que a lê para permitir a conexão do
        # dono do teste dentro da task) viaja pra dentro da task. Em
        # produção não muda nada (não há nada scriptado no dicionário); nos
        # testes dos quatro agentes é o que faz os fakes por
        # `Process.put(:fake_llm_turns, ...)` continuarem visíveis agora que
        # o turno roda num processo diferente do que chamou `handle_call`.
        heranca = copiar_dicionario()

        task =
          Task.Supervisor.async_nolink(Engine.TaskSupervisor, fn -> com_heranca(heranca, fun) end)

        {:noreply, Map.put(state, :turno_assincrono, %{task: task, from: from})}

      %{} when is_nil(from) ->
        Logger.warning(
          "kickoff ignorado: turno já em curso para #{inspect(state[:agent])}/#{state.session_id}"
        )

        {:noreply, state}

      %{} ->
        {:reply, {:error, :turno_em_andamento}, state}
    end
  end

  @doc """
  Trata as mensagens que a Task manda pro GenServer (`{ref, resultado}` de
  sucesso, `{:DOWN, ...}` de crash) dentro do `handle_info` de cada agente.
  Devolve `{:ok, state}` quando tratou, ou `:ignorado` quando a mensagem não
  era desta task — o chamador cai no seu próprio `handle_info`.
  """
  @spec tratar_resultado(term(), map()) :: {:ok, map()} | :ignorado
  def tratar_resultado(
        {ref, resultado},
        %{turno_assincrono: %{task: %Task{ref: ref}, from: from}} = _state
      )
      when is_reference(ref) do
    Process.demonitor(ref, [:flush])
    if from, do: GenServer.reply(from, :ok)

    novo_state = Map.put(resultado, :turno_assincrono, nil)
    {:ok, finalizar(novo_state)}
  end

  def tratar_resultado(
        {:DOWN, ref, :process, _pid, reason},
        %{turno_assincrono: %{task: %Task{ref: ref}, from: from}} = state
      ) do
    if from, do: GenServer.reply(from, {:error, {:crash, reason}})

    novo_state =
      state
      |> Map.put(:turno_assincrono, nil)
      |> emitir_falha_crash(reason)

    {:ok, finalizar(novo_state)}
  end

  def tratar_resultado(_msg, _state), do: :ignorado

  @doc """
  Cancela o turno em curso: mata a task (`Task.shutdown/2`, `:brutal_kill`
  — derruba a conexão HTTP no meio, não só o consumo do lado do engine),
  responde ao `from` original com `{:error, :cancelado}` e grava o evento
  TERMINAL. Sem turno em curso, é NO-OP idempotente.
  """
  @spec cancelar(map()) :: map()
  def cancelar(%{turno_assincrono: nil} = state), do: state

  def cancelar(%{turno_assincrono: %{task: task, from: from}} = state) do
    # `Task.shutdown/2` mata o processo E consome a mensagem de resposta ou
    # de :DOWN que ele mandaria — nada disso sobra na mailbox pro
    # `handle_info` genérico processar de novo (sem isto, `tratar_resultado/2`
    # rodaria uma segunda vez com `turno_assincrono` já `nil` e cairia no
    # `:ignorado`, mas só por sorte de guard — melhor não depender disso).
    Task.shutdown(task, :brutal_kill)
    if from, do: GenServer.reply(from, {:error, :cancelado})

    state
    |> Map.put(:turno_assincrono, nil)
    |> emitir_cancelamento()
    |> finalizar()
  end

  def cancelar(state), do: Map.put(state, :turno_assincrono, nil)

  # --- Herança de dicionário de processo para a task ---

  defp copiar_dicionario do
    for {chave, valor} <- Process.get(),
        not (is_atom(chave) and chave |> Atom.to_string() |> String.starts_with?("$")),
        do: {chave, valor}
  end

  defp com_heranca(heranca, fun) do
    Enum.each(heranca, fn {chave, valor} -> Process.put(chave, valor) end)
    fun.()
  end

  # --- Helpers ---

  defp finalizar(state) do
    broadcast(state, "agent.done", %{})
    broadcast(state, "agent.status", %{status: "idle"})
    state
  end

  # A origem "política" é a que mais se aproxima: cancelar é uma decisão do
  # USUÁRIO para não gastar mais token — o mesmo motivo que já classifica
  # orçamento/credencial/binding como política em `FalhaDeTurno`. Não é um
  # quinto valor: o vocabulário do ADR 0020 continua fechado em quatro
  # (`falha_de_turno_test.exs`), e cancelamento não é uma FALHA de turno —
  # por isso não passa por `FalhaDeTurno.mensagem/1` (que diria "nada foi
  # gasto", falso aqui: o turno pode ter rodado parte do caminho antes do
  # cancelamento chegar).
  defp emitir_cancelamento(state) do
    origem = "politica"

    mensagem =
      "Turno cancelado pelo usuário. A chamada ao modelo foi interrompida no " <>
        "meio para não gastar mais token — o que já tinha sido gerado até aqui " <>
        "não foi reaproveitado. Você pode mandar uma nova mensagem quando quiser."

    emit(state, "agent.error", %{
      origem: origem,
      mensagem: mensagem,
      reason: "cancelado_pelo_usuario"
    })

    broadcast(state, "agent.error", %{origem: origem, mensagem: mensagem})
    state
  end

  defp emitir_falha_crash(state, reason) do
    origem = FalhaDeTurno.origem(reason)

    mensagem =
      "O turno caiu de forma inesperada: #{inspect(reason)}. Nada além do já " <>
        "registrado foi gasto. Você pode tentar de novo."

    emit(state, "agent.error", %{origem: origem, mensagem: mensagem, reason: inspect(reason)})
    broadcast(state, "agent.error", %{origem: origem, mensagem: mensagem})
    state
  end

  defp emit(state, type, payload) do
    EngineApiClient.append_event(state.project_id, state.session_id, %{
      type: type,
      actorKind: "agent",
      actorId: Map.fetch!(state, :agent),
      payload: payload
    })
  end

  # `agent.status` PRECISA ser persistido, não só broadcastado — mesma regra
  # dos quatro `*Server` (ver `Engine.Sessions.LiveBroadcast.agent_status/4`
  # e o ADR 0021).
  defp broadcast(state, "agent.status", %{status: status}) do
    LiveBroadcast.agent_status(state.project_id, state.session_id, state.agent, status)
  end

  defp broadcast(state, event, payload) do
    EngineWeb.Endpoint.broadcast("session:" <> state.session_id, event, payload)
  end
end
