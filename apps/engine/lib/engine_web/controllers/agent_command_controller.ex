defmodule EngineWeb.AgentCommandController do
  @moduledoc """
  Comandos síncronos da api pros agentes conversacionais (Fase 3b): iniciar o
  Criativo, rotear uma mensagem do usuário, e sinalizar a confirmação de
  prontidão. Guardado pelo plug VerifyServiceToken (segredo compartilhado), igual ao
  SessionCommandController.
  """

  use EngineWeb, :controller

  alias Engine.Agents.{
    CriativoSupervisor,
    CriativoServer,
    PoSupervisor,
    PoServer,
    ArquitetoSupervisor,
    ArquitetoServer,
    DevLeadSupervisor,
    DevLeadServer,
    StaffSupervisor,
    StaffServer
  }

  alias Engine.Infra.{InfraLeadSupervisor, InfraLeadServer}

  def start(conn, %{"sessionId" => session_id, "projectId" => project_id, "agent" => "criativo"}) do
    {:ok, _pid} = CriativoSupervisor.start_agent(session_id, project_id)
    send_resp(conn, 201, "")
  end

  def start(conn, %{"sessionId" => session_id, "projectId" => project_id, "agent" => "po"}) do
    # Ativado pelo handoff aceito; num start FRESCO dispara o kickoff (gera o
    # backlog a partir do brief) — restart/reativação não regeram.
    {:ok, _pid, origin} = PoSupervisor.start_agent(session_id, project_id)
    if origin == :started, do: PoServer.kickoff(session_id)
    send_resp(conn, 201, "")
  end

  def start(conn, %{"sessionId" => session_id, "projectId" => project_id, "agent" => "arquiteto"}) do
    {:ok, _pid, origin} = ArquitetoSupervisor.start_agent(session_id, project_id)
    if origin == :started, do: ArquitetoServer.kickoff(session_id)
    send_resp(conn, 201, "")
  end

  def start(conn, %{"sessionId" => session_id, "projectId" => project_id, "agent" => "dev-lead"}) do
    # Ativado pelo handoff aceito do Arquiteto (FASE 14d — ADR 0053). Kickoff
    # só num start FRESCO: restart não regera o plano.
    {:ok, _pid, origin} = DevLeadSupervisor.start_agent(session_id, project_id)
    if origin == :started, do: DevLeadServer.kickoff(session_id)
    send_resp(conn, 201, "")
  end

  def start(conn, %{"sessionId" => session_id, "projectId" => project_id, "agent" => "infra"}) do
    # Ativado pelo handoff aceito do Arquiteto — kickoff só num start FRESCO.
    {:ok, _pid, origin} = InfraLeadSupervisor.start_agent(session_id, project_id)
    if origin == :started, do: InfraLeadServer.kickoff(session_id)
    send_resp(conn, 201, "")
  end

  def start(conn, %{"sessionId" => session_id, "projectId" => project_id, "agent" => "staff"}) do
    # Ativado pelo handoff aceito endereçado a "staff" — mecanismo GENÉRICO
    # (ActivateAgentUseCase/canActivateAgent, sem entrar em
    # USER_STARTED_AGENTS: ver o moduledoc de `Engine.Agents.StaffServer`).
    # SEM kickoff, ao contrário dos demais: o Staff não sintetiza instrução
    # de abertura nenhuma a partir do event log — fica ocioso até a
    # primeira `user_message` (ADR 0088).
    {:ok, _pid, _origin} = StaffSupervisor.start_agent(session_id, project_id)
    send_resp(conn, 201, "")
  end

  def start(conn, %{"agent" => agent}) do
    conn
    |> put_status(422)
    |> json(%{error: "agente não suportado como conversacional: #{agent}"})
  end

  # REIDRATA ANTES DE FALAR. O comentário de `revise/2` abaixo dizia que um
  # agente morto nesta rota "é um bug" — e é, mas acontece o tempo todo: basta
  # o engine reiniciar. A sessão sobrevive, o processo do agente não, e a
  # próxima mensagem morria com `GenServer.call ... exited` sem nada na tela.
  #
  # O `start_agent` é idempotente (devolve o pid se já existe) e o `init` do
  # servidor já reconstrói o histórico do event log — faltava só quem o
  # chamasse. É a mesma garantia que a Fase 12b deu aos dev agents, aplicada
  # aos conversacionais.
  def message(conn, %{
        "sessionId" => session_id,
        "projectId" => project_id,
        "agent" => "po",
        "text" => text
      }) do
    {:ok, _pid, _origin} = PoSupervisor.start_agent(session_id, project_id)
    # O retorno já não é sempre `:ok` (RN-122): um `:cancel` concorrente pode
    # ter interrompido o turno (`{:error, :cancelado}`), ou uma segunda
    # mensagem pode ter chegado com outra já em curso (`{:error,
    # :turno_em_andamento}`). Nos dois casos o desfecho de verdade já está
    # gravado no event log (`agent.error`) — esta resposta é só o aceite.
    _ = PoServer.user_message(session_id, text)
    send_resp(conn, 202, "")
  end

  def message(conn, %{
        "sessionId" => session_id,
        "projectId" => project_id,
        "agent" => "dev-lead",
        "text" => text
      }) do
    {:ok, _pid, _origin} = DevLeadSupervisor.start_agent(session_id, project_id)
    _ = DevLeadServer.user_message(session_id, text)
    send_resp(conn, 202, "")
  end

  def message(conn, %{
        "sessionId" => session_id,
        "projectId" => project_id,
        "agent" => "arquiteto",
        "text" => text
      }) do
    {:ok, _pid, _origin} = ArquitetoSupervisor.start_agent(session_id, project_id)
    _ = ArquitetoServer.user_message(session_id, text)
    send_resp(conn, 202, "")
  end

  def message(conn, %{
        "sessionId" => session_id,
        "projectId" => project_id,
        "agent" => "staff",
        "text" => text
      }) do
    {:ok, _pid, _origin} = StaffSupervisor.start_agent(session_id, project_id)
    _ = StaffServer.user_message(session_id, text)
    send_resp(conn, 202, "")
  end

  def message(conn, %{
        "sessionId" => session_id,
        "projectId" => project_id,
        "text" => text
      }) do
    {:ok, _pid} = CriativoSupervisor.start_agent(session_id, project_id)
    _ = CriativoServer.user_message(session_id, text)
    send_resp(conn, 202, "")
  end

  @doc """
  Devolve ao PO uma história que o usuário recusou promover (Fase 12c —
  RN-048).

  Checa liveness ANTES de chamar, ao contrário de `message/2`: aquela rota
  nasce de um usuário digitando numa sessão que ele está vendo, e um PO morto
  ali é um bug. Esta nasce de uma recusa JÁ GRAVADA na api — o PO pode ter
  morrido num restart do engine no meio do caminho, e a api precisa distinguir
  "não notifiquei" de "explodi". Sem a checagem, `GenServer.call` sairia por
  `:noproc` e viraria 500.
  """
  def revise(conn, %{
        "sessionId" => session_id,
        "storyId" => story_id,
        "title" => title,
        "reason" => reason
      }) do
    if PoServer.vivo?(session_id) do
      _ = PoServer.revise(session_id, %{"id" => story_id, "title" => title, "reason" => reason})
      send_resp(conn, 202, "")
    else
      conn
      |> put_status(404)
      |> json(%{error: "PO da sessão #{session_id} não está de pé"})
    end
  end

  def readiness(conn, %{"sessionId" => session_id}) do
    _ = CriativoServer.confirm_readiness(session_id)
    send_resp(conn, 202, "")
  end

  def offer_infra_handoff(conn, %{"sessionId" => session_id}) do
    _ = ArquitetoServer.offer_infra_handoff(session_id)
    send_resp(conn, 202, "")
  end

  def offer_dev_handoff(conn, %{"sessionId" => session_id}) do
    :ok = ArquitetoServer.offer_dev_handoff(session_id)
    send_resp(conn, 202, "")
  end

  @doc """
  Cancela o turno em curso do agente conversacional ativo na sessão
  (RN-122) — o botão "Parar" do composer. Idempotente por natureza:
  `GenServer.cast` num `{:via, ...}` sem processo registrado (agente já
  encerrado, ou sem turno algum em curso) é NO-OP, então esta rota nunca
  falha por "não havia o quê cancelar".
  """
  def cancel(conn, %{"sessionId" => session_id, "agent" => agent}) do
    case via_for(agent, session_id) do
      {:ok, via} ->
        GenServer.cast(via, :cancel)
        send_resp(conn, 202, "")

      :error ->
        conn
        |> put_status(422)
        |> json(%{error: "agente não suportado como conversacional: #{agent}"})
    end
  end

  # Sem "agent" no corpo: mesmo default do `message/2` de baixo — sem
  # `"agent"`, o alvo é o Criativo (único que nasce sem handoff).
  def cancel(conn, %{"sessionId" => session_id}),
    do: cancel(conn, %{"sessionId" => session_id, "agent" => "criativo"})

  defp via_for("criativo", session_id), do: {:ok, CriativoServer.via(session_id)}
  defp via_for("po", session_id), do: {:ok, PoServer.via(session_id)}
  defp via_for("arquiteto", session_id), do: {:ok, ArquitetoServer.via(session_id)}
  defp via_for("dev-lead", session_id), do: {:ok, DevLeadServer.via(session_id)}
  defp via_for("staff", session_id), do: {:ok, StaffServer.via(session_id)}
  defp via_for(_agent, _session_id), do: :error
end
