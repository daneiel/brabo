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
     ou uma variação que também cria handoff — só que agora fora dele). Com
     `from` (um `handle_call`), responde `:ok` NA HORA — é o aceite, e desde
     o ADR 0163 (RN-578) ele não espera o turno. Sem `from` (`handle_cast`
     do kickoff, `handle_info` da retomada), `{:noreply, state}`.
  2. Quando a task termina, a mensagem `{ref, resultado}` chega no
     `handle_info` do agente, que repassa para `tratar_resultado/2`: ele
     incorpora o `resultado` (o `state` final que a task devolveu) e emite os
     broadcasts efêmeros de fim de turno. Não há mais ninguém esperando
     síncrono: o desfecho vai pelo canal e, quando é falha, pelo
     `agent.error` durável.
  3. `cancelar/1` mata a task em curso com `Task.shutdown/2` no modo
     `:brutal_kill` — o que derruba a CONEXÃO HTTP (SSE) que a task segura
     com a api, e é o que faz o cancelamento economizar token de verdade,
     não só parar de renderizar no cliente — e grava o evento TERMINAL
     `agent.error` (sem ele a sessão fica pendurada pro terceiro sinal de
     pendência do `GetSessionPendingWorkUseCase`: `agent.activated` sem
     desfecho).

  Sem turno em curso, `cancelar/1` é NO-OP idempotente — não existe task
  para matar.

  ## Suspensão em aprovação (ADR 0086, RN-284)

  A função de turno (`fun`, passada a `iniciar/3`) continua tendo o MESMO
  contrato — devolve o `state` (mapa) — mas o `state` pode agora carregar,
  com valor não-nulo, a chave `:aguardando_aprovacao` quando o turno parou
  no meio de um tool call que virou `proposed_action` `pending` (hoje só o
  Dev Lead faz isso, para `propose_execution_plan`). A checagem é pelo
  VALOR (`Map.get/2`, truthy), não pela presença da chave: o Dev Lead
  carrega `aguardando_aprovacao: nil` desde o `init/1`, então a chave em si
  está sempre presente. Quem fecha esse turno é `suspender/1` em vez de
  `finalizar/1` (que emite `agent.done` e `agent.status: idle`, dizendo que o
  agente terminou e está livre): só `agent.status: awaiting_approval`, sem
  `agent.done`. O turno NÃO terminou — está esperando
  `{:action_settled, ...}` (a mesma entrega da `Engine.Dev.Wake`/outbox que
  o dev agent já consome desde o ADR 0052) para retomar de onde parou.

  ## A fila de mensagens (RN-673, ADR 0191)

  Mensagem do usuário que chega com turno em curso NÃO é mais recusada: entra
  na fila do agente (`receber_mensagem/4`), é gravada como
  `chat.message_queued` e respondida `{:ok, :enfileirada, posicao}` (202). No
  fim do turno — `finalizar/1`, nunca `suspender/1` — a fila inteira vira UM
  turno (`Engine.Agents.FilaDeMensagens.texto_do_turno/1`) e é marcada
  `chat.message_delivered`. Quem monta o turno de uma mensagem é o SERVIDOR
  (`:montar_turno_de_mensagem` no state, a mesma função do `handle_call` de
  sempre); este módulo só decide QUANDO. A recusa `turno_em_andamento` de
  `iniciar/3` continua valendo para o que NÃO é mensagem (revisão do PO,
  prontidão do Criativo, handoff do Arquiteto).
  """

  require Logger

  alias Engine.Agents.{FalhaDeTurno, FilaDeMensagens}
  alias Engine.Harness.IdiomaDaResposta
  alias Engine.Sessions.{EngineApiClient, LiveBroadcast}

  @typedoc "O que fica guardado no state do agente enquanto o turno roda."
  @type turno :: %{task: Task.t()}

  @doc """
  Inicia o turno em background. `fun` é uma função de aridade zero que roda
  o turno (e o que mais precisar, como emitir o product_brief ou criar um
  handoff) e devolve o `state` final — a MESMA função que corria inline
  dentro do `handle_call`/`handle_cast` antes da RN-122.

  `from` é o `GenServer.from()` de quem chamou (`handle_call`), ou `nil`
  quando quem chamou foi um `handle_cast` (kickoff) ou um `handle_info`
  (retomada do Dev Lead suspenso) sem ninguém esperando síncrono.

  ## A resposta sai AO ACEITAR (ADR 0163, RN-578)

  Com `from`, a resposta é `{:reply, :ok, state}` na hora — com a Task de pé e
  o `agent.status: working` JÁ persistido (é `LiveBroadcast.agent_status/4`,
  síncrono no append). Até o ADR 0163 o `from` viajava junto da Task e só era
  respondido no FIM do turno: quem clicava esperava o turno inteiro (97 s
  medidos numa instalação real), e turno acima do teto do `GenServer.call`
  virava 500 num comando que tinha funcionado. O ADR 0086 já rompia essa
  espera para o Dev Lead suspenso; agora ela não existe para ninguém. A ORDEM
  (persistir `working` → responder) é contrato: é ela que deixa a tela saber,
  lendo o log depois do aceite, que o `agent.status` mais recente daquele
  agente é do turno NOVO.

  ## A recusa continua síncrona

  Se já existe um turno em curso para este agente, NÃO sobe uma segunda
  task — duas tasks mexendo no mesmo histórico de mensagens correriam uma
  condição de corrida. Com `from` presente (era um `handle_call`), responde
  na hora com `{:error, :turno_em_andamento}` E grava `agent.error` durável:
  até o ADR 0163 esse retorno era descartado pelo controller, que respondia
  202 — a mensagem era aceita e nunca lida, sem rastro nenhum (medido: um
  "Continue" digitado durante o kickoff do Arquiteto). Sem `from` (era o
  `:kickoff`, que só deveria disparar uma vez por sessão), ignora e loga — é
  defensivo, não um caminho esperado.

  Desde a RN-673 (ADR 0191) a MENSAGEM do usuário não passa mais por esta
  recusa: ela entra em `receber_mensagem/4`, que enfileira. O que segue
  recusado aqui são os comandos que não são fala — a revisão de história do
  PO, a prontidão do Criativo, a oferta de handoff do Arquiteto.
  """
  @spec iniciar(map(), GenServer.from() | nil, (-> map())) ::
          {:noreply, map()} | {:reply, :ok | {:error, :turno_em_andamento}, map()}
  def iniciar(state, from, fun) do
    case Map.get(state, :turno_assincrono) do
      nil ->
        broadcast(state, "agent.status", %{status: "working"})
        # O dicionário de processo do chamador (menos as chaves `$...` que o
        # PRÓPRIO `Task` usa pra registrar a cadeia de ancestralidade — ver
        # `Ecto.Adapters.SQL.Sandbox`, que a lê para permitir a conexão do
        # dono do teste dentro da task) viaja pra dentro da task. Em
        # produção é por aqui, e só por aqui, que o idioma do AUTOR da
        # mensagem chega ao turno (RN-622: `IdiomaDaResposta.com_idioma_do_autor/2`
        # o põe no dicionário durante o `handle_call` e o tira ao sair); nos
        # testes dos agentes é também o que faz os fakes por
        # `Process.put(:fake_llm_turns, ...)` continuarem visíveis agora que
        # o turno roda num processo diferente do que chamou `handle_call`.
        heranca = copiar_dicionario()

        task =
          Task.Supervisor.async_nolink(Engine.TaskSupervisor, fn -> com_heranca(heranca, fun) end)

        novo_state = Map.put(state, :turno_assincrono, %{task: task})

        if from, do: {:reply, :ok, novo_state}, else: {:noreply, novo_state}

      %{} when is_nil(from) ->
        Logger.warning(
          "kickoff ignorado: turno já em curso para #{inspect(state[:agent])}/#{state.session_id}"
        )

        {:noreply, state}

      %{} ->
        emitir_recusa_por_turno_em_andamento(state)
        {:reply, {:error, :turno_em_andamento}, state}
    end
  end

  @doc """
  Trata as mensagens que a Task manda pro GenServer (`{ref, resultado}` de
  sucesso, `{:DOWN, ...}` de crash) dentro do `handle_info` de cada agente.
  Devolve `{:ok, state}` quando tratou, ou `:ignorado` quando a mensagem não
  era desta task — o chamador cai no seu próprio `handle_info`.

  O CONTRATO da função de turno é devolver o `state` (um mapa). Resultado de
  outra forma vira falha narrada, nunca queda — ver a segunda cláusula.

  Desde o ADR 0086 (RN-284), o `state` devolvido pode carregar a chave
  OPCIONAL `:aguardando_aprovacao` — usada pelo Dev Lead quando um tool call
  virou `proposed_action` e ficou `pending`: o turno NÃO terminou. Presente
  a chave, quem fecha é `suspender/1` (sem `agent.done`, `agent.status` vira
  `"awaiting_approval"`); ausente, o caminho de sempre (`finalizar/1`).
  """
  @spec tratar_resultado(term(), map()) :: {:ok, map()} | :ignorado
  def tratar_resultado(
        {ref, resultado},
        %{turno_assincrono: %{task: %Task{ref: ref}}} = state
      )
      when is_reference(ref) and is_map(resultado) do
    Process.demonitor(ref, [:flush])

    # A fila vem do state ATUAL, nunca do `resultado`: a Task capturou o state
    # do INÍCIO do turno, antes de as mensagens que chegaram no meio dele
    # entrarem na fila (RN-673) — o mesmo raciocínio das `correcoes_pendentes`
    # do Infra Lead.
    novo_state =
      resultado
      |> Map.put(:turno_assincrono, nil)
      |> Map.put(:fila_de_mensagens, Map.get(state, :fila_de_mensagens, []))

    # `Map.get/2` (valor), não `Map.has_key?/2` (chave): o Dev Lead carrega
    # `aguardando_aprovacao: nil` no state DESDE O INÍCIO (é o default do
    # `init/1`), então a CHAVE está sempre presente — inclusive num turno que
    # nunca suspendeu. Checar só a chave suspenderia TODO turno do Dev Lead,
    # sempre.
    if Map.get(novo_state, :aguardando_aprovacao) do
      {:ok, suspender(novo_state)}
    else
      {:ok, novo_state |> finalizar() |> agendar_entrega()}
    end
  end

  # Segunda barreira, e ela existe por uma queda REAL: o ramo do erro narrado
  # no frame final devolvia `{state, ""}` (tupla) onde todos os outros ramos de
  # `run_turn` devolvem `state` (mapa), e o `Map.put/3` da cláusula acima
  # levantava `BadMapError` DENTRO do `handle_info` do agente. Como os quatro
  # conversacionais são `restart: :temporary`, o agente morria e não voltava —
  # e os gatilhos eram os mais corriqueiros que existem (orçamento estourado,
  # credencial ausente, binding inexistente).
  #
  # Os três ramos foram corrigidos, mas a sobrevivência do agente não pode
  # depender de todo ramo futuro lembrar do formato: um erro de código nosso
  # vira desfecho NARRADO com origem `codigo` (é lacuna nossa, ADR 0020) e o
  # state ANTERIOR ao turno é preservado — perder o histórico do turno é caro,
  # perder o agente é pior.
  def tratar_resultado(
        {ref, resultado},
        %{turno_assincrono: %{task: %Task{ref: ref}}} = state
      )
      when is_reference(ref) do
    Process.demonitor(ref, [:flush])

    novo_state =
      state
      |> Map.put(:turno_assincrono, nil)
      |> emitir_falha_de_formato(resultado)

    {:ok, novo_state |> finalizar() |> agendar_entrega()}
  end

  def tratar_resultado(
        {:DOWN, ref, :process, _pid, reason},
        %{turno_assincrono: %{task: %Task{ref: ref}}} = state
      ) do
    novo_state =
      state
      |> Map.put(:turno_assincrono, nil)
      |> emitir_falha_crash(reason)

    {:ok, novo_state |> finalizar() |> agendar_entrega()}
  end

  # A entrega da fila (RN-673) é uma MENSAGEM a si mesmo, nunca uma chamada
  # dentro de `finalizar/1`: o servidor ainda tem o próprio fecho a fazer no
  # mesmo `handle_info` (o Infra Lead drena a correção de gate pendente, o
  # Arquiteto o handoff ao Dev Lead) e não pode encontrar um turno da fila já
  # de pé. Se um deles subiu um turno, a fila espera o fim dele.
  def tratar_resultado(:entregar_fila_de_mensagens, state) do
    {:ok, entregar_fila(state)}
  end

  def tratar_resultado(_msg, _state), do: :ignorado

  @doc """
  Cancela o turno em curso: mata a task (`Task.shutdown/2`, `:brutal_kill`
  — derruba a conexão HTTP no meio, não só o consumo do lado do engine) e
  grava o evento TERMINAL. Sem turno em curso, é NO-OP idempotente.

  Não responde a ninguém: desde o ADR 0163 quem disparou o turno já recebeu o
  aceite no `iniciar/3`, e o desfecho do cancelamento chega pelo `agent.error`
  durável e pelo canal, como todo outro desfecho de turno.
  """
  @spec cancelar(map()) :: map()
  def cancelar(%{turno_assincrono: nil} = state), do: state

  def cancelar(%{turno_assincrono: %{task: task}} = state) do
    # `Task.shutdown/2` mata o processo E consome a mensagem de resposta ou
    # de :DOWN que ele mandaria — nada disso sobra na mailbox pro
    # `handle_info` genérico processar de novo (sem isto, `tratar_resultado/2`
    # rodaria uma segunda vez com `turno_assincrono` já `nil` e cairia no
    # `:ignorado`, mas só por sorte de guard — melhor não depender disso).
    Task.shutdown(task, :brutal_kill)

    state
    |> Map.put(:turno_assincrono, nil)
    |> emitir_cancelamento()
    |> finalizar()
    |> agendar_entrega()
  end

  def cancelar(state), do: Map.put(state, :turno_assincrono, nil)

  @doc """
  A mensagem do usuário (RN-673). `mensagem` é `%{texto, idioma, id}` — `id`
  é o do `chat.message` que a api já gravou (`nil` para chamador antigo, que
  então não pode cancelá-la). `montar` é a função do SERVIDOR que transforma
  `(state, texto)` no turno (a aridade zero de `iniciar/3`); fica guardada no
  state para a fila poder montar o turno depois.

    * sem turno e sem fila — sobe o turno na hora, como sempre (`:ok`);
    * sem turno mas com fila (a janela entre o fim de um turno e a entrega) —
      entra no FIM da fila e a fila inteira é entregue já, para a mais nova
      nunca passar na frente das que esperavam (`:ok`);
    * com turno e fila abaixo do teto — enfileira, grava `chat.message_queued`
      e responde `{:ok, :enfileirada, posicao}`;
    * com a fila no teto — recusa NOMEADA `{:error, :fila_de_mensagens_cheia}`,
      com `agent.error` durável (a mensagem está gravada e não será lida).

  Turno SUSPENSO em aprovação (Dev Lead, RN-284) não chega aqui: o servidor
  recusa antes, com `aguardando_aprovacao`.
  """
  @spec receber_mensagem(map(), GenServer.from(), map(), (map(), String.t() -> (-> map()))) ::
          {:reply, :ok | {:ok, :enfileirada, pos_integer()} | {:error, atom()}, map()}
  def receber_mensagem(state, from, %{texto: _} = mensagem, montar) when is_function(montar, 2) do
    state = Map.put(state, :montar_turno_de_mensagem, montar)
    fila = Map.get(state, :fila_de_mensagens, [])
    mensagem = Map.merge(%{id: nil, idioma: nil}, mensagem)

    cond do
      is_nil(Map.get(state, :turno_assincrono)) and fila == [] ->
        IdiomaDaResposta.com_idioma_do_autor(mensagem.idioma, fn ->
          iniciar(state, from, montar.(state, mensagem.texto))
        end)

      is_nil(Map.get(state, :turno_assincrono)) ->
        novo_state = state |> Map.put(:fila_de_mensagens, fila ++ [mensagem]) |> entregar_fila()
        {:reply, :ok, novo_state}

      length(fila) >= FilaDeMensagens.teto() ->
        emitir_recusa_por_fila_cheia(state)
        {:reply, {:error, :fila_de_mensagens_cheia}, state}

      true ->
        posicao = length(fila) + 1

        emit(state, FilaDeMensagens.tipo_enfileirada(), %{
          mensagemId: mensagem.id,
          texto: mensagem.texto,
          idioma: mensagem.idioma,
          posicao: posicao
        })

        broadcast(state, "chat.message_queued", %{mensagemId: mensagem.id, posicao: posicao})

        {:reply, {:ok, :enfileirada, posicao},
         Map.put(state, :fila_de_mensagens, fila ++ [mensagem])}
    end
  end

  @doc """
  Cancela UMA mensagem pendente (RN-673), em nome de `user_id` — quem a enviou;
  a api confere a autoria antes. Some da fila e grava `chat.message_cancelled`.
  Mensagem que não está na fila (já entregue, já cancelada, nunca enfileirada)
  é `{:error, :mensagem_fora_da_fila}` — o processo do agente serializa a
  corrida com a entrega, então "cancelada" nunca é dito sobre uma já lida.
  """
  @spec cancelar_mensagem(map(), String.t(), String.t()) ::
          {:reply, :ok | {:error, :mensagem_fora_da_fila}, map()}
  def cancelar_mensagem(state, mensagem_id, user_id) do
    fila = Map.get(state, :fila_de_mensagens, [])

    case Enum.split_with(fila, &(&1.id == mensagem_id)) do
      {[], _} ->
        {:reply, {:error, :mensagem_fora_da_fila}, state}

      {_, resto} ->
        registrar_cancelamento(
          state.project_id,
          state.session_id,
          state.agent,
          mensagem_id,
          user_id
        )

        {:reply, :ok, Map.put(state, :fila_de_mensagens, resto)}
    end
  end

  @doc """
  Grava `chat.message_cancelled` (ator `user`) e avisa o canal. Público porque
  o controller o usa quando o agente não está de pé: aí não há fila em memória
  para disputar, e o log é a fila inteira.
  """
  def registrar_cancelamento(project_id, session_id, agent, mensagem_id, user_id) do
    EngineApiClient.append_event(project_id, session_id, %{
      type: FilaDeMensagens.tipo_cancelada(),
      actorKind: "user",
      actorId: user_id,
      payload: %{mensagemId: mensagem_id, agente: agent}
    })

    EngineWeb.Endpoint.broadcast("session:" <> session_id, "chat.message_cancelled", %{
      mensagemId: mensagem_id,
      agente: agent
    })
  end

  @doc """
  A fila reconstruída do log no `init/1` do servidor (RN-673). Com pendentes,
  agenda a entrega para logo depois da subida — a mensagem que esperava por um
  turno que o reinício matou é lida, e só ela (o turno interrompido NUNCA é
  refeito, RN-586).
  """
  @spec fila_ao_subir(String.t(), String.t(), String.t()) :: [FilaDeMensagens.mensagem()]
  def fila_ao_subir(project_id, session_id, agent) do
    fila = FilaDeMensagens.ler_ao_subir(project_id, session_id, agent)
    if fila != [], do: send(self(), :entregar_fila_de_mensagens)
    fila
  end

  @doc """
  Abandona o turno em curso porque a SESSÃO fechou (RN-581): mata a task como
  `cancelar/1`, mas NÃO grava nem transmite nada. Gravar seria pedir à api um
  evento de conversa numa sessão encerrada, que ela recusa; e o canal da
  sessão já foi embora. Chamado do `terminate/2` dos servidores, quando
  `Engine.Agents.Conversacionais` os para. Sem turno, é no-op.

  A task é `async_nolink`: sem isto ela SOBREVIVERIA ao servidor, seguiria
  chamando o modelo (gastando) e tentaria gravar a resposta depois.

  Não responde a ninguém: desde o ADR 0163 (RN-578) quem disparou o turno já
  recebeu `:ok` no ACEITE, e o `from` não fica no state. O casamento é só por
  `task` de propósito — um padrão que exigisse `from` cairia no no-op abaixo e
  deixaria a task viva, que é o defeito que esta função existe para fechar.
  """
  @spec abandonar(map()) :: map()
  def abandonar(%{turno_assincrono: %{task: task}} = state) do
    Task.shutdown(task, :brutal_kill)
    Map.put(state, :turno_assincrono, nil)
  end

  def abandonar(state), do: state

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

  # Os dois sinais que a tela usa para fechar o turno (`agent.done` no canal,
  # `agent.status: idle` no log) saem SÓ daqui, e `finalizar/1` só roda no
  # processo do GenServer, com `turno_assincrono` já `nil` no state que o
  # `handle_info` vai devolver (RN-585). Quem viu um dos dois e manda a próxima
  # mensagem é atendido depois desse `handle_info` — nunca ouve
  # `turno_em_andamento`. Não chame isto de dentro da Task: o que ela grava
  # (`agent.response`, `agent.error`) sai ANTES de o turno fechar, e por isso
  # não é sinal de fim.
  defp finalizar(state) do
    broadcast(state, "agent.done", %{})
    broadcast(state, "agent.status", %{status: "idle"})
    state
  end

  defp agendar_entrega(state) do
    if Map.get(state, :fila_de_mensagens, []) != [],
      do: send(self(), :entregar_fila_de_mensagens)

    state
  end

  # Entrega a fila inteira num turno só (N mensagens = 1 turno). No-op quando
  # há turno de pé (a entrega volta no fim dele), quando o turno está suspenso
  # em aprovação (RN-284: a fila espera a retomada terminar), quando a fila
  # está vazia ou quando o servidor ainda não disse como monta um turno.
  defp entregar_fila(state) do
    fila = Map.get(state, :fila_de_mensagens, [])
    montar = Map.get(state, :montar_turno_de_mensagem)

    cond do
      fila == [] or not is_function(montar, 2) -> state
      not is_nil(Map.get(state, :turno_assincrono)) -> state
      Map.get(state, :aguardando_aprovacao) -> state
      true -> subir_turno_da_fila(state, fila, montar)
    end
  end

  defp subir_turno_da_fila(state, fila, montar) do
    ids = for %{id: id} <- fila, is_binary(id), do: id

    if ids != [] do
      emit(state, FilaDeMensagens.tipo_entregue(), %{mensagemIds: ids})
      broadcast(state, "chat.message_delivered", %{mensagemIds: ids})
    end

    limpo = Map.put(state, :fila_de_mensagens, [])
    # O idioma do turno é o do AUTOR da mensagem MAIS RECENTE (RN-622): é a
    # última fala que pediu resposta.
    idioma = fila |> List.last() |> Map.get(:idioma)

    {:noreply, novo_state} =
      IdiomaDaResposta.com_idioma_do_autor(idioma, fn ->
        iniciar(limpo, nil, montar.(limpo, FilaDeMensagens.texto_do_turno(fila)))
      end)

    novo_state
  end

  # O teto da fila (RN-673). A mensagem está no log como `chat.message` e não
  # será lida — então a recusa é durável no fio, como a de `turno_em_andamento`
  # era, e não só o 409. Origem `politica`: é a regra do teto, não uma falha.
  defp emitir_recusa_por_fila_cheia(state) do
    origem = "politica"

    mensagem =
      "Já há #{FilaDeMensagens.teto()} mensagens esperando o fim do meu turno — " <>
        "esta ficou registrada, mas não entrou na fila e eu não vou lê-la. " <>
        "Cancele uma das pendentes ou espere eu terminar."

    emit(state, "agent.error", %{
      origem: origem,
      mensagem: mensagem,
      reason: "fila_de_mensagens_cheia"
    })

    broadcast(state, "agent.error", %{origem: origem, mensagem: mensagem})
    state
  end

  # O turno NÃO terminou — só está suspenso esperando a decisão de uma
  # `proposed_action` (ADR 0086, RN-284). Sem `agent.done` e sem
  # `agent.status: idle`: os dois diriam ao painel que o agente está livre
  # para uma mensagem nova, e `DevLeadServer` recusa exatamente essa
  # mensagem enquanto `aguardando_aprovacao` estiver setado no state. Só o
  # status muda, para `"awaiting_approval"` — o mesmo vocabulário que o dev
  # agent já usa para o laço suspenso do ADR 0052.
  defp suspender(state) do
    broadcast(state, "agent.status", %{status: "awaiting_approval"})
    state
  end

  # A recusa de um SEGUNDO comando com turno em curso (ADR 0163, RN-578). Desde
  # a RN-673 a mensagem do usuário não chega aqui (ela entra na fila); o que
  # chega é o comando que não é fala — revisão, prontidão, oferta de handoff.
  # Até lá o `{:error, :turno_em_andamento}` era descartado pelo controller e
  # o HTTP dizia 202: a mensagem estava gravada no log como `chat.message`
  # (quem grava é a api, ANTES de falar com o engine) e nunca chegava ao
  # modelo — sem rastro nenhum. Agora a recusa é 409 no clique E durável no
  # fio. Origem `politica` pelo mesmo critério do cancelamento: é a regra "um
  # turno por vez", não uma falha. Só `emit`/`broadcast` de `agent.error` —
  # nunca `finalizar/1`, que diria à tela que o turno EM CURSO acabou.
  defp emitir_recusa_por_turno_em_andamento(state) do
    origem = "politica"

    mensagem =
      "Ainda estou no meio de um turno — este pedido não foi atendido. Tente de " <>
        "novo quando eu terminar, ou pare o turno atual."

    emit(state, "agent.error", %{
      origem: origem,
      mensagem: mensagem,
      reason: "turno_em_andamento"
    })

    broadcast(state, "agent.error", %{origem: origem, mensagem: mensagem})
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

  # Origem `codigo` pelo mesmo critério do `FalhaDeTurno`: quem não soube
  # produzir o formato combinado foi o NOSSO código, e é essa origem que aponta
  # a ação certa (corrigir o ramo que devolveu errado). A FORMA do resultado vai
  # junto porque sem ela quem tria a ocorrência não tem por onde começar — é o
  # mesmo raciocínio do diagnóstico verbatim.
  defp emitir_falha_de_formato(state, resultado) do
    origem = "codigo"
    forma = descrever(resultado)

    Logger.error(
      "turno de #{inspect(state[:agent])}/#{state.session_id} devolveu resultado fora do " <>
        "contrato (esperado o state, um mapa): #{forma}"
    )

    mensagem =
      "O turno terminou num formato que o engine não sabe incorporar — é uma " <>
        "falha do nosso código, não da sua mensagem. Nada além do já registrado " <>
        "foi gasto. Você pode tentar de novo."

    emit(state, "agent.error", %{
      origem: origem,
      mensagem: mensagem,
      reason: "resultado_de_turno_invalido: #{forma}"
    })

    broadcast(state, "agent.error", %{origem: origem, mensagem: mensagem})
    state
  end

  # `inspect/1` cru aqui despejaria o state inteiro (histórico de mensagens e
  # specs de ferramenta) no log E no event log — o caso real, `{state, ""}`,
  # rendia milhares de caracteres. O que se precisa saber é a FORMA, então os
  # limites são apertados de propósito.
  defp descrever(resultado), do: inspect(resultado, limit: 3, printable_limit: 120)

  defp emitir_falha_crash(state, reason) do
    origem = FalhaDeTurno.origem(reason)

    mensagem =
      "O turno caiu de forma inesperada: #{inspect(reason)}. Nada além do já " <>
        "registrado foi gasto. Você pode tentar de novo."

    emit(state, "agent.error", %{
      origem: origem,
      mensagem: mensagem,
      reason: FalhaDeTurno.diagnostico(reason)
    })

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
