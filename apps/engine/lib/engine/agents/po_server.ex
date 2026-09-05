defmodule Engine.Agents.PoServer do
  @moduledoc """
  Agente PO (Product Owner) conversacional no harness (Fase 3b). Ativado pelo
  handoff aceito do Criativo, consome o product_brief + as business_rules do
  event log e **produz o backlog** (épicos → histórias → tarefas) via as
  ferramentas create_epic/create_story/create_task (nunca SQL direto).

  Ele também **relê** o que já existe — `listar_regras_de_negocio` e
  `listar_backlog`, escopadas ao PROJETO (RN-164), mais `listar_metricas_de_produto`
  (o funil/DORA parcial do projeto — RN-407) — e **pergunta** quando falta
  informação, com o mesmo `ask_structured_questions` do Criativo (RN-165). As
  três primeiras nasceram do mesmo defeito de uso real: até então as quatro
  ferramentas do PO eram de ESCRITA, o contexto era lido uma única vez no
  kickoff, e um backlog com épico e nenhuma história travava a execução em
  silêncio.

  Igual ao CriativoServer: GenServer por sessão, estado + rehydration +
  streaming pelo canal Phoenix. **Diferença:** cada turno roda um LOOP bounded
  de tool use — injeta o resultado da ferramenta (ex.: o id do épico) de volta
  na conversa pro modelo encadear as chamadas. Na ativação faz um `:kickoff`
  (gera o backlog); depois conversa pra refinar.
  """

  use GenServer, restart: :temporary

  alias Engine.Harness.{ContextBuilder, PromptAssembler, ContextManager, ToolCallRecovery}
  alias Engine.Agents.{FalhaDeTurno, TurnoAssincrono}
  alias Engine.Harness.Tools.{CreateEpic, CreateStory, CreateTask, OfferHandoff}
  alias Engine.Harness.Tools.{AskStructuredQuestions, ListarBacklog, ListarRegrasDeNegocio}
  alias Engine.Harness.Tools.{EmitArtifact, ListarMetricasDeProduto}
  alias Engine.Sessions.EngineApiClient

  @agent "po"
  @max_iterations 12

  # Frente 3 do plano de decision_record — IDÊNTICA nos 5 conversacionais que
  # ganharam emit_artifact nesta leva (PO, Arquiteto, Dev Lead, UX Designer,
  # Staff; o Criativo já tinha a ferramenta antes). Fica de fora do texto de
  # identidade (`Engine.Harness.Agents`) porque não é sobre QUEM o agente é —
  # é uma instrução operacional sobre UMA ferramenta, igual nos 5.
  @instrucao_decision_record "Use `emit_artifact` com `type: decision_record` para " <>
                               "registrar uma decisão relevante tomada nesta conversa, " <>
                               "com contexto, opções consideradas, a escolha e as " <>
                               "consequências aceitas."

  # --- API pública ---

  def start_link({session_id, project_id}) do
    GenServer.start_link(__MODULE__, {session_id, project_id}, name: via(session_id))
  end

  def via(session_id),
    do: {:via, Registry, {Engine.Sessions.Registry, "po:" <> session_id}}

  @doc "Dispara a geração do backlog a partir do brief (chamado na ativação)."
  def kickoff(session_id), do: GenServer.cast(via(session_id), :kickoff)

  @doc "Roteia uma mensagem do usuário pro PO (refino do backlog)."
  def user_message(session_id, text),
    do: GenServer.call(via(session_id), {:user_message, text}, 180_000)

  @doc """
  Devolução de história recusada (Fase 12c — RN-048): o usuário não promoveu
  e mandou o trabalho de volta. `story` é `%{id:, title:, reason:}`.

  Distinto de `user_message/2`, que é conversa: aqui o PO recebe uma pendência
  ENDEREÇADA, com precedência declarada — o mesmo desenho da devolução de um
  gate ao dev agent (`DevAgentServer.correct/3`).
  """
  def revise(session_id, story),
    do: GenServer.call(via(session_id), {:revise, story}, 180_000)

  @doc """
  O PO daquela sessão está de pé? A rota interna usa isso para responder 404
  em vez de estourar `:noproc` num `GenServer.call` — a devolução já foi
  gravada na api, e o chamador precisa saber que a notificação não chegou.
  """
  def vivo?(session_id),
    do: Registry.lookup(Engine.Sessions.Registry, "po:" <> session_id) != []

  # --- Callbacks ---

  @impl true
  def init({session_id, project_id}) do
    system_msg = %{
      "role" => "system",
      "content" => system_prompt(project_id),
      :pinned => true
    }

    history = rehydrate(project_id, session_id)

    {:ok,
     %{
       session_id: session_id,
       project_id: project_id,
       agent: @agent,
       messages: [system_msg | history],
       tool_specs: [
         # LEITURA primeiro, de propósito: até a RN-164 as quatro ferramentas
         # do PO eram todas de ESCRITA, e ele nunca relia nada depois do
         # kickoff. A ordem da lista é o que o modelo vê primeiro.
         ListarRegrasDeNegocio.spec(),
         ListarBacklog.spec(),
         ListarMetricasDeProduto.spec(),
         CreateEpic.spec(),
         CreateStory.spec(),
         CreateTask.spec(),
         # RN-165: perguntar em vez de parar. A ferramenta é a MESMA do
         # Criativo (RN-162) — o PO só passou a advertisá-la.
         AskStructuredQuestions.spec(),
         OfferHandoff.spec(),
         # Frente 3 do plano de decision_record — mesma ferramenta do
         # Criativo (RN-162 style reuse), tipo novo (`decision_record`).
         EmitArtifact.spec()
       ],
       # Épicos criados NESTE processo que ainda não receberam história
       # (RN-165): `%{epic_id => titulo}`. Não é reidratado de propósito — a
       # cobrança é sobre a obrigação que o PO assumiu no turno, e um estado
       # reconstruído do event log reabriria cobrança de épico antigo que o
       # usuário já resolveu de outro jeito.
       epicos_sem_historia: %{},
       # Guardado enquanto o turno roda numa Task supervisionada, fora do
       # handler que bloqueava o processo inteiro — é o que permite um
       # `:cancel` chegar e ser atendido (RN-122). Ver `TurnoAssincrono`.
       turno_assincrono: nil
     }}
  end

  # O turno passou a rodar numa Task (`TurnoAssincrono`), fora deste
  # handler: antes o processo inteiro ficava bloqueado até o turno terminar,
  # e um `:cancel` nunca era atendido nesse meio tempo (RN-122).
  @impl true
  def handle_cast(:kickoff, state) do
    work = state |> append(user_msg(kickoff_instruction(state))) |> compact()
    TurnoAssincrono.iniciar(state, nil, fn -> run_turn(work, @max_iterations) end)
  end

  @impl true
  def handle_cast(:cancel, state) do
    {:noreply, TurnoAssincrono.cancelar(state)}
  end

  @impl true
  def handle_call({:user_message, text}, from, state) do
    work = state |> append(user_msg(text)) |> compact()
    TurnoAssincrono.iniciar(state, from, fn -> run_turn(work, @max_iterations) end)
  end

  @impl true
  def handle_call({:revise, story}, from, state) do
    work = state |> append(revision_message(story)) |> compact()
    TurnoAssincrono.iniciar(state, from, fn -> run_turn(work, @max_iterations) end)
  end

  @impl true
  def handle_info(msg, state) do
    case TurnoAssincrono.tratar_resultado(msg, state) do
      {:ok, novo_state} -> {:noreply, novo_state}
      :ignorado -> {:noreply, state}
    end
  end

  # --- Turno com loop bounded de tool use ---

  # O teto de iterações deixou de ser SILENCIOSO (RN-166). Antes esta cláusula
  # devolvia o state e pronto: um PO que esgotasse as 12 iterações terminava
  # sem evento nenhum, e do lado de fora isso é indistinguível de um turno que
  # simplesmente acabou. O `ToolLoop` já emitia `toolloop.limit_reached` desde
  # a Fase 3 — os agentes conversacionais, que têm laço PRÓPRIO, ficaram de
  # fora. Mesmo tipo de evento e mesmo payload: quem lê o log não precisa
  # aprender um segundo nome para o mesmo fato.
  defp run_turn(state, remaining) when remaining <= 0 do
    emit(state, "toolloop.limit_reached", %{
      iteration: @max_iterations,
      max_iterations: @max_iterations
    })

    encerrar_turno(state)
  end

  defp run_turn(state, remaining) do
    # Ver o comentário em `criativo_server.ex`: quem fala é o agente (achado C).
    on_delta = fn text -> broadcast(state, "agent.delta", %{text: text, agent: @agent}) end
    wire = Enum.map(state.messages, &to_wire/1)

    case EngineApiClient.llm_turn_stream(
           state.project_id,
           state.session_id,
           @agent,
           wire,
           state.tool_specs,
           on_delta
         ) do
      # A api narra a falha no PRÓPRIO frame final (budget, credencial, binding).
      # Isto não caía no `{:error, _}` abaixo e não emitia evento nenhum: o
      # turno terminava em silêncio absoluto, pior que o balão vazio.
      #
      # Devolve `state` (mapa), e NÃO `{state, ""}` (tupla): quem recebe o
      # retorno de `run_turn/2` é `TurnoAssincrono.tratar_resultado/2`, que faz
      # `Map.put(resultado, :turno_assincrono, nil)`. `Map.put/3` numa tupla
      # levanta `BadMapError` DENTRO do `handle_info` do agente e, como o
      # servidor é `restart: :temporary`, ele morria e não voltava — a correção
      # de uma falha silenciosa tinha virado uma QUEDA, com o gatilho mais
      # corriqueiro que existe (acabar o orçamento).
      {:ok, %{"error" => erro}} when is_binary(erro) and erro != "" ->
        emit_falha(state, {:final, erro})
        state

      {:ok, %{"message" => message} = frame} ->
        content = Map.get(message, "content", "")
        model_name = Map.get(frame, "modelName")
        state = append(state, assistant_msg(content))
        if content != "", do: emit_response(state, content, model_name)

        case tool_calls(message, state.tool_specs) do
          [] ->
            encerrar_turno(state)

          calls ->
            state = Enum.reduce(calls, state, &dispatch_tool/2)
            run_turn(state, remaining - 1)
        end

      {:error, reason} ->
        # NUNCA mais `agent.response` vazio aqui: no event log ele é
        # indistinguível de sucesso, e o motivo real ia só por broadcast, que
        # é efêmero. A falha vira evento durável COM origem, e o agente diz o
        # que houve no próprio fio.
        emit_falha(state, reason)
        state
    end
  end

  # Despacha a ferramenta e INJETA o resultado (id/erro) como mensagem `tool`
  # pro modelo encadear (epic id -> create_story -> create_task).
  defp dispatch_tool(call, state) do
    name = Map.get(call, "name")
    args = Map.get(call, "arguments", %{})
    id = Map.get(call, "id")

    emit(state, "tool.call", %{tool: name, args: args})
    broadcast(state, "tool.call", %{tool: name, agent: @agent})
    result = run_tool(name, args, state)

    text =
      case result do
        {:ok, s} -> s
        {:error, s} -> s
      end

    state
    |> anotar_obrigacao(name, args, result)
    |> append(%{
      "role" => "tool",
      "content" => text,
      "toolCallId" => id,
      "name" => name,
      :pinned => false
    })
  end

  defp run_tool("listar_regras_de_negocio", args, state),
    do: ListarRegrasDeNegocio.run(args, state)

  defp run_tool("listar_backlog", args, state), do: ListarBacklog.run(args, state)

  defp run_tool("listar_metricas_de_produto", args, state),
    do: ListarMetricasDeProduto.run(args, state)

  defp run_tool("create_epic", args, state), do: CreateEpic.run(args, state)
  defp run_tool("create_story", args, state), do: CreateStory.run(args, state)
  defp run_tool("create_task", args, state), do: CreateTask.run(args, state)

  defp run_tool("ask_structured_questions", args, state),
    do: AskStructuredQuestions.run(args, state)

  defp run_tool("offer_handoff", args, state), do: OfferHandoff.run(args, state)
  defp run_tool("emit_artifact", args, state), do: EmitArtifact.run(args, state)
  defp run_tool(name, _args, _state), do: {:error, "ferramenta desconhecida: #{name}"}

  # --- A obrigação da história (RN-165) ---

  # Épico criado entra na lista de pendências; história criada tira dela o
  # épico que ela cita. Só o caminho de SUCESSO conta: um `create_story` que a
  # api recusou (regra inexistente, por exemplo) não cobriu épico nenhum, e
  # tratá-lo como se tivesse coberto é exatamente o silêncio que a RN-165
  # existe para acabar.
  defp anotar_obrigacao(state, "create_epic", args, {:ok, texto}) do
    # Sem id parseável a obrigação ainda existe — ela só passa a ser
    # identificada pelo título. Perder a cobrança porque a frase do tool-result
    # mudou seria trocar um defeito silencioso por outro.
    chave = CreateEpic.id_no_resultado(texto) || "titulo:#{Map.get(args, "title")}"

    %{
      state
      | epicos_sem_historia:
          Map.put(state.epicos_sem_historia, chave, Map.get(args, "title", "(sem título)"))
    }
  end

  defp anotar_obrigacao(state, "create_story", args, {:ok, _texto}) do
    %{
      state
      | epicos_sem_historia: Map.delete(state.epicos_sem_historia, Map.get(args, "epic_id"))
    }
  end

  defp anotar_obrigacao(state, _name, _args, _result), do: state

  # O desfecho de todo turno que TERMINA (o modelo parou de pedir ferramenta,
  # ou o teto de iterações estourou). Épico sem história não pode encerrar
  # calado: sem história não há tarefa, sem tarefa o dev agent não tem o que
  # pegar, e a execução trava sem erro nenhum — foi o que o uso real encontrou.
  #
  # Padrão da RN-059: evento DURÁVEL com origem (o log é o que sobrevive) mais
  # o broadcast, para quem está com a aba aberta ver na hora. A lista é
  # esvaziada depois de reportada — a cobrança é por ocorrência, não um alarme
  # que repete a cada turno até alguém desligar.
  defp encerrar_turno(%{epicos_sem_historia: pendentes} = state) when map_size(pendentes) == 0,
    do: state

  defp encerrar_turno(%{epicos_sem_historia: pendentes} = state) do
    titulos = Map.values(pendentes)

    mensagem =
      "Encerrei o turno com #{map_size(pendentes)} épico(s) sem nenhuma história: " <>
        Enum.map_join(titulos, ", ", &"\"#{&1}\"") <>
        ". Épico sozinho não gera tarefa, e sem tarefa a execução não sai do lugar. " <>
        "Me diga o que falta para eu escrever essas histórias — ou peça que eu tente de novo."

    emit(state, "backlog.epic_without_story", %{
      origem: "modelo",
      mensagem: mensagem,
      epicIds: Map.keys(pendentes),
      epicTitles: titulos
    })

    broadcast(state, "agent.error", %{origem: "modelo", mensagem: mensagem})

    %{state | epicos_sem_historia: %{}}
  end

  # --- Kickoff: monta a instrução a partir do brief + regras do event log ---

  defp kickoff_instruction(state) do
    case EngineApiClient.list_events(state.project_id, state.session_id) do
      {:ok, events} ->
        brief =
          events
          |> Enum.filter(&(Map.get(&1, "type") == "artifact.product_brief"))
          |> List.last()

        rules = Enum.filter(events, &(Map.get(&1, "type") == "artifact.business_rule"))
        build_kickoff(brief, rules)

      _ ->
        # Sem event log não há brief nem regra para citar — mas a obrigação e o
        # que fazer quando falta informação continuam valendo, e é justamente
        # neste caminho degradado que faltar informação é mais provável.
        "Gere o backlog do produto (épicos, histórias e tarefas) usando as ferramentas.\n" <>
          "Comece por `listar_regras_de_negocio` e `listar_backlog` para ver o que já existe.\n" <>
          obrigacoes()
    end
  end

  defp build_kickoff(brief, rules) do
    summary =
      case brief do
        %{"payload" => %{"summary" => s}} when is_binary(s) -> s
        _ -> "(sem product brief disponível)"
      end

    rules_text =
      rules
      |> Enum.map_join("\n", fn r ->
        payload = Map.get(r, "payload", %{})

        "- id=#{Map.get(r, "id")} | #{Map.get(payload, "title", "")}: #{Map.get(payload, "description", "")}"
      end)

    """
    O Criativo entregou o product brief e as regras de negócio abaixo. Gere o backlog:
    crie 1+ épico(s) com create_epic e histórias COMPLETAS com create_story — cada história
    precisa de RF, DoD, DoR e `business_rule_ids` apontando para os ids das regras que a
    originaram (é o que a torna promovível). Dependendo da configuração do projeto, uma
    história completa vira 'ready' na hora ou fica aguardando a promoção do usuário — o
    retorno de create_story diz qual foi o caso, e AGUARDAR APROVAÇÃO NÃO É ERRO: não
    tente recriar nem "consertar" uma história que voltou como completa.
    Adicione tarefas com create_task quando fizer sentido.
    Cubra TODAS as regras com ao menos uma história. Quando o backlog estiver pronto, ofereça
    um handoff ao arquiteto com offer_handoff(to_agent: "arquiteto").

    #{obrigacoes()}

    PRODUCT BRIEF:
    #{summary}

    REGRAS DE NEGÓCIO (use estes ids em business_rule_ids):
    #{rules_text}

    A lista acima é a desta sessão. `listar_regras_de_negocio` traz as do PROJETO
    inteiro, com quais já estão cobertas — use-a se desconfiar que falta alguma.
    """
  end

  # As duas coisas que a instrução de kickoff NÃO dizia, e que o uso real
  # cobrou (RN-165): que a história é obrigatória depois do épico, e o que
  # fazer quando falta informação para escrevê-la.
  #
  # A segunda é a que importa mais. Diante de uma lacuna, um modelo sem
  # instrução escolhe entre inventar e parar — e parar foi o que aconteceu:
  # épico criado, nenhuma história, e a execução travada sem erro nenhum.
  # Perguntar é a terceira saída, e ela só existe se estiver escrita.
  defp obrigacoes do
    """
    DUAS REGRAS QUE NÃO SE NEGOCIAM:

    1. ÉPICO SEM HISTÓRIA NÃO SERVE PARA NADA. Épico não gera tarefa; história
       gera. Se você criar um épico e terminar sem nenhuma história nele, a
       execução do projeto TRAVA sem erro visível — e isso fica registrado
       contra você no log da sessão. Nunca encerre nesse estado.
    2. QUANDO FALTAR INFORMAÇÃO, PERGUNTE — não pare e não invente. Use
       `ask_structured_questions` para pedir ao usuário, de uma vez só e em
       formulário, tudo o que falta para você escrever as histórias (ex.: qual
       o critério de aceite, quem é o usuário do fluxo, o que acontece no caso
       de erro). Uma pergunta é sempre melhor que um backlog vazio ou que uma
       história inventada.
    """
  end

  # --- Rehydration ---

  defp rehydrate(project_id, session_id) do
    case EngineApiClient.list_events(project_id, session_id) do
      {:ok, events} -> events |> Enum.map(&to_message/1) |> Enum.reject(&is_nil/1)
      _ -> []
    end
  end

  defp to_message(%{"type" => "chat.message", "payload" => payload}),
    do: user_msg(Map.get(payload, "text", ""))

  defp to_message(%{"type" => "agent.response", "payload" => payload}),
    do: assistant_msg(Map.get(payload, "content") || Map.get(payload, "text") || "")

  defp to_message(_event), do: nil

  # --- Helpers ---

  defp compact(state) do
    {:ok, state} = ContextManager.maybe_compact(state)
    state
  end

  defp system_prompt(project_id) do
    base =
      project_id
      |> ContextBuilder.build_layers(@agent)
      |> PromptAssembler.assemble()
      |> PromptAssembler.Default.render()

    base <> "\n\n" <> @instrucao_decision_record
  end

  defp user_msg(text), do: %{"role" => "user", "content" => text, :pinned => false}

  defp assistant_msg(content),
    do: %{"role" => "assistant", "content" => content, :pinned => false}

  # A devolução de uma história recusada (Fase 12c — RN-048).
  #
  # `:pinned => true` e não `false` como as mensagens de conversa: é o PRIMEIRO
  # fixado fora do system prompt num agente conversacional, e é deliberado. A
  # recusa é uma pendência endereçada, não uma fala — se o `ContextManager`
  # compactasse o histórico e a engolisse, o PO voltaria a propor a mesma
  # história com o mesmo defeito. `to_wire/1` remove a chave antes do modelo.
  #
  # A frase de precedência é a mesma lição do ADR 0020, aprendida com o dev
  # agent repondo o segredo que o SecOps acabara de reprovar: a história
  # original continua no contexto, então o parecer que a contradiz precisa
  # dizer que vale mais.
  #
  # O que o PO pode fazer está dito EXPLICITAMENTE porque não existe ferramenta
  # de editar história — só `create_story`. Mandar "corrija a história" seria
  # pedir o impossível, e um modelo diante de uma instrução impossível inventa
  # uma ferramenta ou repete a chamada até esgotar o loop.
  defp revision_message(story) do
    %{
      "role" => "user",
      "content" =>
        "O usuário RECUSOU promover a história \"#{Map.get(story, "title")}\" " <>
          "(id=#{Map.get(story, "id")}) e a devolveu para você.\n\n" <>
          "Motivo: #{Map.get(story, "reason")}\n\n" <>
          "Este motivo PREVALECE sobre o seu julgamento anterior de que a história " <>
          "estava completa: onde os dois se contradisserem, siga o motivo. A promoção " <>
          "é decisão do usuário, e repropor a mesma história sem endereçar o que ele " <>
          "apontou só devolve o problema para ele.\n\n" <>
          "Não existe ferramenta de EDITAR história. O que você pode fazer: criar a " <>
          "versão corrigida com `create_story` (a recusada fica registrada como " <>
          "devolvida, com o motivo), ou — se o motivo não estiver claro — responder " <>
          "perguntando ao usuário antes de recriar qualquer coisa.",
      :pinned => true
    }
  end

  defp append(state, message), do: %{state | messages: state.messages ++ [message]}

  defp to_wire(message), do: Map.delete(message, :pinned)

  # Modelo local costuma descrever a chamada em TEXTO em vez de usar o
  # protocolo nativo. O ToolLoop já recuperava isso (ADR 0020), mas os agentes
  # conversacionais têm loop PRÓPRIO e ficaram de fora — o InfraAgent morria
  # com resposta vazia tendo escrito o `propose_infra_pr` certo em texto.
  defp tool_calls(message, tool_specs) do
    case Map.get(message, "toolCalls") || [] do
      [] ->
        ToolCallRecovery.from_content(
          Map.get(message, "content", ""),
          Enum.map(tool_specs, & &1.name)
        )

      nativas ->
        nativas
    end
  end

  # `model_name` viaja do frame `final` da api (achado do problema 2). Sem
  # default: o único call site aqui sempre passa os 3 argumentos — diferente
  # do Criativo, que tem um segundo call site (mensagem sintética de erro de
  # ferramenta) sem modelo nenhum.
  defp emit_response(state, content, model_name),
    do: emit(state, "agent.response", %{content: content, modelName: model_name})

  # A falha, gravada e DITA. O `broadcast` continua, para quem está com a aba
  # aberta ver na hora — mas ele deixou de ser a única fonte.
  defp emit_falha(state, reason) do
    origem = FalhaDeTurno.origem(reason)
    mensagem = FalhaDeTurno.mensagem(reason)

    emit(state, "agent.error", %{
      origem: origem,
      mensagem: mensagem,
      reason: inspect(reason)
    })

    broadcast(state, "agent.error", %{origem: origem, mensagem: mensagem})
  end

  defp emit(state, type, payload) do
    EngineApiClient.append_event(state.project_id, state.session_id, %{
      type: type,
      actorKind: "agent",
      actorId: @agent,
      payload: payload
    })
  end

  # `agent.status` (o único evento que PRECISA ser persistido, não só
  # broadcastado — ver ADR 0021) passou a ser emitido por
  # `Engine.Agents.TurnoAssincrono`, que envolve o `handle_call`/`handle_cast`
  # de cada turno desde RN-122. O que sobra aqui é só o broadcast efêmero.
  defp broadcast(state, event, payload) do
    EngineWeb.Endpoint.broadcast("session:" <> state.session_id, event, payload)
  end
end
