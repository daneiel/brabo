defmodule Engine.Sessions.SessionServer do
  @moduledoc """
  Runtime de UMA sessão ativa, supervisionado. O event log de domínio
  vive em Postgres do lado da api (session_events), não neste processo —
  este módulo só supervisiona + detecta término (crash/kill/normal/
  heartbeat_timeout/conversation_idle_timeout) e persiste o próprio estado em session_states pra
  sobreviver a restart do nó (ver Engine.Sessions.Rehydrator).
  """

  use GenServer, restart: :temporary

  require Logger

  alias Engine.Sessions.{EngineApiClient, SessionState}

  def start_link({session_id, project_id}) do
    start_link({session_id, project_id, nil})
  end

  def start_link({session_id, project_id, trace_parent}) do
    GenServer.start_link(__MODULE__, {session_id, project_id, trace_parent},
      name: via(session_id)
    )
  end

  @doc """
  Nome do processo, registrado em `:global` — não num `Registry` local (Fase 5).

  Enquanto o engine era uma réplica só, `Registry` e "único no cluster" eram a
  mesma coisa. Com o HPA da Fase 5 deixaram de ser, e o efeito era destrutivo:
  o `Rehydrator` recria no boot um SessionServer para TODA linha de
  `session_states`, que é uma tabela global. Com N réplicas, cada sessão passava
  a existir N vezes; o websocket do browser chega em UMA (o Service balanceia),
  e as outras N-1 cópias nunca recebiam `ping` — estouravam o heartbeat e
  mandavam a api fechar uma sessão que estava viva em outro pod.

  `:global` resolve os dois lados de uma vez: `start_session/2` passa a
  deduplicar entre nós, e `heartbeat/1` alcança o dono onde quer que ele
  esteja, então o websocket pode cair em qualquer réplica.
  """
  def via(session_id), do: {:global, {:brabo_session, session_id}}

  @doc "pid do dono da sessão em qualquer nó do cluster, ou nil."
  def whereis(session_id) do
    case :global.whereis_name({:brabo_session, session_id}) do
      :undefined -> nil
      pid -> pid
    end
  end

  def stop(pid), do: GenServer.stop(pid, :normal)

  @doc "Hook de teste/ops: provoca um crash real (raise) dentro do processo."
  def crash(pid), do: GenServer.cast(pid, :crash)

  @doc "Chamado pelo SessionChannel a cada ping — reseta o timer de heartbeat."
  def heartbeat(session_id) do
    GenServer.call(via(session_id), :heartbeat)
  end

  @doc """
  `project_id` da sessão — chamado por `SessionChannel.join/3` (RN-108) pra
  conferir que o ticket do socket é do MESMO projeto da sessão pedida no
  tópico, sem o que um ticket do projeto A abriria canal de sessão do
  projeto B. Assume que o chamador já confirmou o pid via `whereis/1`
  (mesma suposição de `heartbeat/1`).
  """
  def project_id(session_id) do
    GenServer.call(via(session_id), :project_id)
  end

  @impl true
  def init({session_id, project_id}), do: init({session_id, project_id, nil})

  def init({session_id, project_id, trace_parent}) do
    SessionState.upsert_active!(session_id, project_id, trace_parent)
    heartbeat_ref = schedule_heartbeat_timeout()

    {:ok,
     %{
       session_id: session_id,
       project_id: project_id,
       heartbeat_ref: heartbeat_ref,
       idle_check_ref: schedule_idle_check()
     }}
  end

  @impl true
  def handle_call(:heartbeat, _from, state) do
    Process.cancel_timer(state.heartbeat_ref)
    {:reply, :ok, %{state | heartbeat_ref: schedule_heartbeat_timeout()}}
  end

  @impl true
  def handle_call(:project_id, _from, state) do
    {:reply, state.project_id, state}
  end

  @impl true
  def handle_cast(:crash, state) do
    raise "crash simulado da sessão #{state.session_id} (hook de teste/ops)"
  end

  @impl true
  def handle_info(:heartbeat_timeout, state) do
    # Antes de morrer, pergunta se sobrou TRABALHO. O timeout mede inatividade
    # da ABA (30s), não do trabalho: sair da sessão para o Backlog já bastava
    # para matá-la. Numa execução real isso prendeu um handoff `offered` para o
    # Arquiteto numa sessão fechada — épico e quatro histórias prontos, e a
    # cadeia sem como seguir, porque não há onde aceitar handoff de sessão
    # morta.
    case EngineApiClient.session_pending_work(state.session_id) do
      {:ok, %{pending: true, motivo: motivo} = pendencia} ->
        case Map.get(pendencia, :aguardando_usuario_desde) do
          %DateTime{} = desde -> conversa_ociosa(state, motivo, desde)
          _sem_teto -> reagendar(state, motivo)
        end

      outro ->
        # `{:error, _}` cai aqui de propósito: api fora do ar não pode impedir
        # o encerramento para sempre — seria trocar sessão órfã por sessão
        # imortal. O log diz qual dos dois casos foi.
        if match?({:error, _}, outro) do
          Logger.warning(
            "sessão #{state.session_id}: não consegui checar trabalho pendente " <>
              "(#{inspect(outro)}) — encerrando por heartbeat"
          )
        end

        encerrar(state, :heartbeat_timeout)
    end
  end

  # AT-152: o teto da conversa ociosa também vale com a aba ABERTA. O ramo
  # acima só roda quando o heartbeat expira, e aba aberta pinga a cada ~10s —
  # ele nunca expirava, e a sessão com conversa parada seria imortal (o que o
  # teto existe para evitar). Este relógio é INDEPENDENTE do heartbeat: não o
  # reseta, não o consulta, e o ping não o adia. Só fecha por teto; api fora do
  # ar, sem pendência ou pendência sem instante apenas reagendam — quem encerra
  # por api fora do ar continua sendo o heartbeat.
  def handle_info(:conversation_idle_check, state) do
    case EngineApiClient.session_pending_work(state.session_id) do
      {:ok, %{pending: true, motivo: motivo} = pendencia} ->
        case Map.get(pendencia, :aguardando_usuario_desde) do
          %DateTime{} = desde ->
            case conversa_ociosa(state, motivo, desde, :sem_reagendar) do
              {:stop, _, _} = parada -> parada
              :segue -> {:noreply, %{state | idle_check_ref: schedule_idle_check()}}
            end

          _sem_teto ->
            {:noreply, %{state | idle_check_ref: schedule_idle_check()}}
        end

      _ ->
        {:noreply, %{state | idle_check_ref: schedule_idle_check()}}
    end
  end

  # RN-581: a ÚNICA pendência com teto. Um agente conversacional esperando o
  # usuário segura a sessão — no `exp001` o heartbeat a fechou 30s depois de a
  # aba parar, com o Criativo tendo acabado de perguntar —, mas não para
  # sempre: passado o teto (8h por padrão, contado do FIM do turno do agente, o
  # instante que a api devolve), a sessão fecha com causa PRÓPRIA. Causa
  # própria porque o motivo é outro: não é a aba que sumiu, é a conversa que
  # ninguém retomou — e quem lê `termination_reason` (o Psicólogo, uma métrica
  # por sessão) precisa conseguir separar os dois.
  defp conversa_ociosa(state, motivo, desde, modo \\ :reagendar) do
    ociosa_ms = DateTime.diff(DateTime.utc_now(), desde, :millisecond)
    teto_ms = conversation_idle_timeout_ms()

    if ociosa_ms >= teto_ms do
      Logger.info(
        "sessão #{state.session_id}: conversa ociosa há #{ociosa_ms}ms, acima do teto " <>
          "de #{teto_ms}ms (#{motivo}) — encerrando por conversation_idle_timeout"
      )

      encerrar(state, :conversation_idle_timeout)
    else
      if modo == :reagendar, do: reagendar(state, motivo), else: :segue
    end
  end

  defp reagendar(state, motivo) do
    Logger.info(
      "sessão #{state.session_id}: heartbeat expirou mas há trabalho pendente " <>
        "(#{motivo}) — reagendando em vez de encerrar"
    )

    {:noreply, %{state | heartbeat_ref: schedule_heartbeat_timeout()}}
  end

  defp encerrar(state, causa) do
    SessionState.mark_closing!(state.session_id, Atom.to_string(causa))
    # {:shutdown, reason} em vez do átomo cru — é um encerramento
    # sancionado (ninguém do outro lado), não um crash; evita o log de
    # erro padrão do OTP que um :stop com razão arbitrária geraria.
    {:stop, {:shutdown, causa}, state}
  end

  defp schedule_heartbeat_timeout do
    Process.send_after(self(), :heartbeat_timeout, heartbeat_timeout_ms())
  end

  defp schedule_idle_check do
    Process.send_after(self(), :conversation_idle_check, idle_check_ms())
  end

  # Cadência da checagem do teto com a aba aberta: 5min contra um teto de 8h —
  # a sessão passa do teto por no máximo 5min, ao custo de uma leitura de
  # pendência por sessão a cada 5min.
  defp idle_check_ms do
    Application.get_env(:engine, :session_conversation_idle_check_ms, 300_000)
  end

  defp heartbeat_timeout_ms do
    Application.get_env(:engine, :session_heartbeat_timeout_ms, 30_000)
  end

  # 8h — decisão do mantenedor (18/09). O `runtime.exs` lê
  # `SESSION_CONVERSATION_IDLE_TIMEOUT_MS` com o MESMO default.
  defp conversation_idle_timeout_ms do
    Application.get_env(:engine, :session_conversation_idle_timeout_ms, 28_800_000)
  end
end
