defmodule EngineWeb.AgentCommandController do
  @moduledoc """
  Comandos síncronos da api pros agentes conversacionais (Fase 3b): iniciar o
  Criativo, rotear uma mensagem do usuário, e sinalizar a confirmação de
  prontidão. Guardado pelo plug VerifyServiceToken (segredo compartilhado), igual ao
  SessionCommandController.

  Desde o ADR 0163 (RN-578) a resposta das rotas que disparam turno é o
  ACEITE: 202 assim que o turno sobe, sem esperar ele terminar; 409/422
  nomeados quando o agente recusa antes de subir (`responder_ao_aceite/2`).

  Desde a RN-584, `message/2` não tem destinatário padrão: cada agente que
  conversa tem cláusula PRÓPRIA, e todo o resto — `infra` inclusive — é 422
  nomeado. Até lá a última cláusula não olhava o agente e entregava ao
  Criativo o que fosse escrito para qualquer outro.
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
    UxDesignerSupervisor,
    UxDesignerServer,
    StaffSupervisor,
    StaffServer
  }

  alias Engine.Infra.{InfraLeadSupervisor, InfraLeadServer}
  alias Engine.Sessions.EngineApiClient

  # Quem tem cláusula de `message/2` que chega a um `*Server.user_message/2`
  # (RN-584). Não decide o roteamento — quem decide são as cláusulas, uma por
  # nome —, só separa, na recusa, "mandou sem texto" de "não conversa".
  # `scripts/ci/destinos-do-composer.spec.ts` reprova esta lista divergindo das
  # cláusulas, e as cláusulas divergindo do que a tela oferece.
  @agentes_de_conversa ~w(criativo po arquiteto dev-lead ux-designer staff)

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

  def start(conn, %{
        "sessionId" => session_id,
        "projectId" => project_id,
        "agent" => "ux-designer"
      }) do
    # Ativado pelo handoff aceito (ADR 0087) — kickoff só num start FRESCO:
    # restart não regera o protótipo.
    {:ok, _pid, origin} = UxDesignerSupervisor.start_agent(session_id, project_id)
    if origin == :started, do: UxDesignerServer.kickoff(session_id)
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
    # A resposta é o ACEITE e chega antes do turno terminar (ADR 0163,
    # RN-578): `:ok` é 202, e a recusa ANTES de subir o turno (turno já em
    # curso) é 409 — ver `responder_ao_aceite/2`. O desfecho do turno segue
    # pelo canal e, quando é falha, pelo `agent.error` durável.
    responder_ao_aceite(conn, PoServer.user_message(session_id, text))
  end

  def message(conn, %{
        "sessionId" => session_id,
        "projectId" => project_id,
        "agent" => "dev-lead",
        "text" => text
      }) do
    {:ok, _pid, _origin} = DevLeadSupervisor.start_agent(session_id, project_id)
    responder_ao_aceite(conn, DevLeadServer.user_message(session_id, text))
  end

  def message(conn, %{
        "sessionId" => session_id,
        "projectId" => project_id,
        "agent" => "arquiteto",
        "text" => text
      }) do
    {:ok, _pid, _origin} = ArquitetoSupervisor.start_agent(session_id, project_id)
    responder_ao_aceite(conn, ArquitetoServer.user_message(session_id, text))
  end

  def message(conn, %{
        "sessionId" => session_id,
        "projectId" => project_id,
        "agent" => "ux-designer",
        "text" => text
      }) do
    {:ok, _pid, _origin} = UxDesignerSupervisor.start_agent(session_id, project_id)
    responder_ao_aceite(conn, UxDesignerServer.user_message(session_id, text))
  end

  def message(conn, %{
        "sessionId" => session_id,
        "projectId" => project_id,
        "agent" => "staff",
        "text" => text
      }) do
    {:ok, _pid, _origin} = StaffSupervisor.start_agent(session_id, project_id)
    responder_ao_aceite(conn, StaffServer.user_message(session_id, text))
  end

  # O Criativo tem cláusula PRÓPRIA desde a RN-584. Até lá ele era a cláusula
  # final, sem guarda de agente — e por isso o destinatário de QUALQUER nome
  # que não casasse acima: uma mensagem ao `infra` era lida pelo Criativo, e a
  # pessoa que escreveu para um agente via outro responder.
  def message(conn, %{
        "sessionId" => session_id,
        "projectId" => project_id,
        "agent" => "criativo",
        "text" => text
      }) do
    {:ok, _pid} = CriativoSupervisor.start_agent(session_id, project_id)
    responder_ao_aceite(conn, CriativoServer.user_message(session_id, text))
  end

  # O Infra Lead NÃO recebe mensagem de chat (RN-584), e a recusa é NOMEADA.
  # Não é falta de código: `InfraLeadServer` é PROPOSITIVO (RN-499) — o
  # trabalho dele chega como proposta (PR de infra, subida de container) —
  # e o `user_message/2` que ele ainda exporta roda o turno INTEIRO dentro do
  # `handle_call` (até 180 s), sem o aceite do ADR 0163 e sem "Parar"
  # (`via_for/2` não o conhece). Dar a ele uma cláusula aqui devolveria ao
  # clique a espera que a RN-578 tirou; decidir se ele passa a conversar é
  # decisão de produto, não correção.
  def message(conn, %{"agent" => "infra"} = params) do
    recusar_mensagem(
      conn,
      params,
      422,
      "agente_sem_conversa",
      "O Infra Lead não conversa pelo chat: ele trabalha por proposta — a PR " <>
        "de infra e a subida do container —, e o que pede decisão aparece em " <>
        "Aprovações. A mensagem ficou registrada, mas nenhum agente a leu."
    )
  end

  def message(conn, %{"agent" => agent} = params) when agent in @agentes_de_conversa do
    recusar_mensagem(
      conn,
      params,
      422,
      "mensagem_sem_texto",
      "A mensagem chegou sem texto — nenhum agente a leu."
    )
  end

  # Qualquer outro nome: recusa NOMEADA, nunca um destinatário padrão. É esta
  # cláusula — e não uma lista — que fecha a classe: nome novo nasce recusado
  # até alguém escrever a cláusula dele acima
  # (`scripts/ci/destinos-do-composer.spec.ts` reprova a tela que oferecer um
  # destino sem cláusula).
  def message(conn, %{"agent" => agent} = params) when is_binary(agent) do
    recusar_mensagem(
      conn,
      params,
      422,
      "agente_sem_conversa",
      "O agente \"#{agent}\" não recebe mensagem de chat nesta sessão. A " <>
        "mensagem ficou registrada, mas nenhum agente a leu."
    )
  end

  # Sem `"agent"` no corpo: também é recusa. A api sempre o manda (é segmento
  # da rota pública), então chegar aqui é chamador quebrado — e adivinhar o
  # Criativo foi exatamente o defeito da RN-584.
  def message(conn, params) do
    recusar_mensagem(
      conn,
      params,
      422,
      "agente_ausente",
      "A mensagem chegou sem dizer para qual agente é — nenhum agente a leu."
    )
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
      responder_ao_aceite(
        conn,
        PoServer.revise(session_id, %{"id" => story_id, "title" => title, "reason" => reason})
      )
    else
      conn
      |> put_status(404)
      |> json(%{error: "PO da sessão #{session_id} não está de pé"})
    end
  end

  def readiness(conn, %{"sessionId" => session_id}) do
    responder_ao_aceite(conn, CriativoServer.confirm_readiness(session_id))
  end

  def offer_infra_handoff(conn, %{"sessionId" => session_id}) do
    responder_ao_aceite(conn, ArquitetoServer.offer_infra_handoff(session_id))
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

  # Sem "agent" no corpo: recusa, como em `message/2` (RN-584). O default era
  # o Criativo — parar o turno de quem a pessoa não escolheu.
  def cancel(conn, _params) do
    recusar(
      conn,
      422,
      "agente_ausente",
      "O pedido de parar chegou sem dizer de qual agente — nenhum turno foi parado."
    )
  end

  # O `handle_call` de todo conversacional responde AO ACEITAR desde o ADR
  # 0163 (RN-578) — o turno segue numa Task e o desfecho vai pelo canal. Esta
  # resposta é, portanto, o único sinal síncrono que o clique recebe, e ela
  # deixou de poder ser descartada: até lá o controller ignorava o retorno e
  # dizia 202 também para a mensagem RECUSADA (medido: um "Continue" digitado
  # durante o kickoff do Arquiteto foi aceito e nunca lido). A frase de cada
  # recusa é a mesma do `agent.error` que o agente já gravou.
  defp responder_ao_aceite(conn, :ok), do: send_resp(conn, 202, "")

  defp responder_ao_aceite(conn, {:error, :turno_em_andamento}) do
    recusar(
      conn,
      409,
      "turno_em_andamento",
      "O agente ainda está no meio de um turno — a mensagem ficou registrada, " <>
        "mas não foi lida. Mande de novo quando ele terminar, ou pare o turno atual."
    )
  end

  defp responder_ao_aceite(conn, {:error, :aguardando_aprovacao}) do
    recusar(
      conn,
      409,
      "aguardando_aprovacao",
      "Há uma decisão de plano de execução pendente em Aprovações — a " <>
        "conversa não segue até ela ser decidida."
    )
  end

  defp responder_ao_aceite(conn, {:error, :sem_regra_de_negocio}) do
    recusar(
      conn,
      422,
      "sem_regra_de_negocio",
      "Nenhuma regra de negócio foi capturada nesta conversa — não há o que " <>
        "consolidar num resumo do produto ainda."
    )
  end

  # Recusa de MENSAGEM de chat que não chega a agente nenhum (AT-132, RN-587).
  # A api grava o `chat.message` ANTES de falar com o engine (o engine lê o
  # log), então o 422 sozinho deixava no fio uma mensagem do usuário com cara
  # de entregue e a explicação só no toast. As duas recusas 409 já gravavam
  # `agent.error` (o `*Server` tem o state); estas não passam por `*Server`, e
  # por isso quem grava é o controller — o engine é a fonte da recusa E do
  # registro, a api nunca decide destinatário. Origem `politica`: é regra de
  # roteamento, não falha. Sem `projectId`/`sessionId` no corpo não há onde
  # gravar, e a recusa segue só como resposta.
  defp recusar_mensagem(conn, params, status, motivo, mensagem) do
    registrar_recusa_de_mensagem(params, motivo, mensagem)
    recusar(conn, status, motivo, mensagem)
  end

  defp registrar_recusa_de_mensagem(
         %{"projectId" => project_id, "sessionId" => session_id} = params,
         motivo,
         mensagem
       )
       when is_binary(project_id) and is_binary(session_id) do
    agent = Map.get(params, "agent")

    # O nome vem da rota pública: só vira ator quando é um agente que o
    # roster conhece; qualquer outra coisa é o próprio engine falando.
    {kind, id} =
      if agent in ["infra" | @agentes_de_conversa],
        do: {"agent", agent},
        else: {"system", "engine"}

    EngineApiClient.append_event(project_id, session_id, %{
      type: "agent.error",
      actorKind: kind,
      actorId: id,
      payload: %{origem: "politica", mensagem: mensagem, reason: motivo}
    })

    # Durável E efêmero, o mesmo par dos `*Server`: só o log deixaria a aba
    # aberta sem sinal até o próximo poll.
    EngineWeb.Endpoint.broadcast("session:" <> session_id, "agent.error", %{
      origem: "politica",
      mensagem: mensagem
    })

    :ok
  end

  defp registrar_recusa_de_mensagem(_params, _motivo, _mensagem), do: :ok

  defp recusar(conn, status, motivo, mensagem) do
    conn
    |> put_status(status)
    |> json(%{error: mensagem, motivo: motivo})
  end

  defp via_for("criativo", session_id), do: {:ok, CriativoServer.via(session_id)}
  defp via_for("po", session_id), do: {:ok, PoServer.via(session_id)}
  defp via_for("arquiteto", session_id), do: {:ok, ArquitetoServer.via(session_id)}
  defp via_for("dev-lead", session_id), do: {:ok, DevLeadServer.via(session_id)}
  defp via_for("ux-designer", session_id), do: {:ok, UxDesignerServer.via(session_id)}
  defp via_for("staff", session_id), do: {:ok, StaffServer.via(session_id)}
  defp via_for(_agent, _session_id), do: :error
end
