defmodule Engine.Agents.ArquitetoServer do
  @moduledoc """
  Agente Arquiteto conversacional no harness (Fase 3b — fecha a Fase 3).
  Ativado pelo handoff aceito do PO, consome o product_brief + business_rules +
  o backlog e produz: um `module_map` (validado contra ciclos na api), ADRs
  (via `propose_adr` → proposed_action `open_adr_pr`, aprovada pelo usuário e
  aberta como PR real), e `insight`s de tensão regra↔arquitetura. Também vincula
  módulos às stories (validação cruzada).

  Espelha o `PoServer`: GenServer por sessão, estado + rehydration + streaming +
  loop bounded de tool use (injeta o resultado da ferramenta de volta pro modelo
  encadear). Kickoff no start fresco.
  """

  use GenServer, restart: :temporary

  alias Engine.Harness.{ContextBuilder, PromptAssembler, ContextManager, ToolCallRecovery}

  alias Engine.Agents.{
    FalhaDeTurno,
    Reidratacao,
    ResultadoDeFerramenta,
    TextoDoTurno,
    TurnoAssincrono,
    TurnoOrfao
  }

  alias Engine.Harness.Tools.{
    CreateModuleMap,
    AssignStoryModules,
    ChooseProjectImage,
    CreateC4Diagram,
    RouteModulesToInfra,
    DeclareModuleContracts,
    ProposeAdr,
    EmitInsight,
    EmitArtifact
  }

  alias Engine.Sessions.EngineApiClient

  @agent "arquiteto"
  @max_iterations 14

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
    do: {:via, Registry, {Engine.Sessions.Registry, "arquiteto:" <> session_id}}

  def kickoff(session_id), do: GenServer.cast(via(session_id), :kickoff)

  # `idioma` é o idioma da resposta do AUTOR desta mensagem, resolvido pela api
  # (RN-622); `nil` = sem orientação neste turno.
  def user_message(session_id, text, idioma \\ nil, mensagem_id \\ nil),
    do: GenServer.call(via(session_id), {:user_message, text, idioma, mensagem_id}, 180_000)

  @doc "Cancela uma mensagem que espera na fila deste agente (RN-673)."
  def cancelar_mensagem(session_id, mensagem_id, user_id),
    do: GenServer.call(via(session_id), {:cancelar_mensagem, mensagem_id, user_id}, 15_000)

  # A confirmação de arquitetura pronta oferece SÓ à Infra desde a RN-672
  # (AT-262, ADR 0190): o handoff ao Dev Lead deixou de sair daqui e passou a
  # sair da Infra, quando o container do projeto está `running`
  # (`Engine.Infra.InfraLeadServer`). Antes eram dois handoffs da mesma
  # confirmação (FASE 14d), e o Dev Lead podia ser aceito sem container.
  def offer_infra_handoff(session_id),
    do: GenServer.call(via(session_id), :offer_infra_handoff, 180_000)

  # --- Callbacks ---

  @impl true
  def init({session_id, project_id}) do
    system_msg = %{
      "role" => "system",
      "content" => system_prompt(project_id),
      :pinned => true
    }

    # A conversa que já existe na sessão — a CAUDA, com as perguntas e as
    # ferramentas deste agente, e o começo resumido quando não cabe (RN-580).
    # RN-586: o turno que o reinício do engine deixou pela metade fecha com
    # desfecho durável (nunca reexecuta).
    _ = TurnoOrfao.fechar_ao_subir(project_id, session_id, @agent)

    history = Reidratacao.historico(project_id, session_id, @agent)

    {:ok,
     %{
       session_id: session_id,
       project_id: project_id,
       agent: @agent,
       messages: [system_msg | history],
       tool_specs: [
         CreateModuleMap.spec(),
         AssignStoryModules.spec(),
         ChooseProjectImage.spec(),
         CreateC4Diagram.spec(),
         RouteModulesToInfra.spec(),
         DeclareModuleContracts.spec(),
         ProposeAdr.spec(),
         EmitInsight.spec(),
         # Frente 3 do plano de decision_record — mesma ferramenta do
         # Criativo, tipo novo (`decision_record`).
         EmitArtifact.spec()
       ],
       # Guardado enquanto o turno roda numa Task supervisionada, fora do
       # handler que bloqueava o processo inteiro — é o que permite um
       # `:cancel` chegar e ser atendido (RN-122). Ver `TurnoAssincrono`.
       # RN-673: a fila de mensagens que chegaram com turno em curso,
       # reconstruída do log (sobrevive a restart), e como montar o turno
       # que a lê. Ver `TurnoAssincrono.receber_mensagem/4`.
       fila_de_mensagens: TurnoAssincrono.fila_ao_subir(project_id, session_id, @agent),
       montar_turno_de_mensagem: &turno_de_mensagem/2,
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

  # RN-581: a sessão fechou e `Engine.Agents.Conversacionais` está parando
  # este agente — o turno em curso morre junto, sem gravar nada.
  @impl true
  def terminate(_reason, state) do
    TurnoAssincrono.abandonar(state)
    :ok
  end

  # RN-622: o idioma do AUTOR vale para o turno que esta mensagem sobe, e só
  # para ele — `IdiomaDaResposta.com_idioma_do_autor/2` o põe no dicionário
  # durante o `handle_call` (a Task do turno o herda) e o tira ao sair.
  #
  # RN-673 (ADR 0191): a mensagem passa por `TurnoAssincrono.receber_mensagem/4`
  # — com turno em curso ela ENTRA NA FILA em vez de ser recusada, e a fila
  # vira um turno só no fim dele. `mensagem_id` é o do `chat.message` que a api
  # gravou; é por ele que a mensagem pendente pode ser cancelada.
  @impl true
  def handle_call({:user_message, text, idioma, mensagem_id}, from, state) do
    TurnoAssincrono.receber_mensagem(
      state,
      from,
      %{texto: text, idioma: idioma, id: mensagem_id},
      &turno_de_mensagem/2
    )
  end

  def handle_call({:user_message, text, idioma}, from, state),
    do: handle_call({:user_message, text, idioma, nil}, from, state)

  def handle_call({:user_message, text}, from, state),
    do: handle_call({:user_message, text, nil, nil}, from, state)

  @impl true
  def handle_call({:cancelar_mensagem, mensagem_id, user_id}, _from, state),
    do: TurnoAssincrono.cancelar_mensagem(state, mensagem_id, user_id)

  # O usuário confirmou que a arquitetura está pronta (Fase 4a — fechamento):
  # roda um turno de fechamento (sem ferramenta nova esperada) e OFERECE o
  # handoff ao InfraAgent — mirror de `confirm_readiness` do Criativo (que
  # oferece ao PO), mas server-side/explícito, não inferido pelo modelo.
  @impl true
  def handle_call(:offer_infra_handoff, from, state) do
    TurnoAssincrono.iniciar(state, from, fn -> executar_offer_infra_handoff(state) end)
  end

  # RN-673: como UMA fala do usuário vira turno — a mesma montagem que o
  # `handle_call` fazia inline. `TurnoAssincrono` a guarda no state e a usa
  # também para o turno que lê a FILA (várias falas num texto só).
  defp turno_de_mensagem(state, text) do
    work = state |> append(user_msg(text)) |> compact()
    fn -> run_turn(work, @max_iterations) end
  end

  @impl true
  def handle_info(msg, state) do
    case TurnoAssincrono.tratar_resultado(msg, state) do
      {:ok, novo_state} -> {:noreply, novo_state}
      :ignorado -> {:noreply, state}
    end
  end

  # O usuário confirmou que a arquitetura está pronta: turno de fechamento +
  # oferta do handoff ao InfraAgent, tudo dentro da Task de `TurnoAssincrono`
  # — cancelar no meio impede o handoff de nascer, igual ao
  # `executar_confirm_readiness/1` do Criativo.
  defp executar_offer_infra_handoff(state) do
    instruction =
      user_msg(
        "O usuário confirmou que a arquitetura está pronta. Finalize " <>
          "quaisquer considerações pendentes — o handoff para o InfraAgent " <>
          "será oferecido em seguida."
      )

    state =
      state
      |> append(instruction)
      |> compact()
      |> run_turn(@max_iterations)

    # Era `{:ok, _handoff} = ...`: um `MatchError` no `{:error, _}` derrubava
    # o GenServer inteiro (`restart: :temporary`, sem reinício automático),
    # DEPOIS do turno de fechamento já ter rodado — sem `agent.error`, sem
    # resposta no fio, só o processo sumindo (RN-116, mesmo achado do
    # Criativo → PO em `criativo_server.ex`).
    case EngineApiClient.create_handoff(
           state.project_id,
           state.session_id,
           @agent,
           "infra",
           nil
         ) do
      {:ok, _handoff} -> state
      {:error, reason} -> emit_falha_handoff(state, "infra", reason)
    end
  end

  # --- Turno com loop bounded de tool use ---

  # O teto de iterações deixou de ser SILENCIOSO — mesma correção da RN-166
  # já aplicada ao PO: um Arquiteto que esgotasse as 14 iterações terminava
  # sem evento nenhum, indistinguível de um turno que simplesmente acabou.
  defp run_turn(state, remaining) when remaining <= 0 do
    gravar_texto_do_turno(state, "", nil)

    emit(state, "toolloop.limit_reached", %{
      iteration: @max_iterations,
      max_iterations: @max_iterations
    })

    state
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
        gravar_texto_do_turno(state, "", nil)
        emit_falha(state, {:final, erro})
        state

      {:ok, %{"message" => message} = frame} ->
        content = Map.get(message, "content", "")
        model_name = Map.get(frame, "modelName")
        state = append(state, Engine.Agents.MensagemDoAssistente.de(content, message))

        case tool_calls(message, state.tool_specs) do
          [] ->
            gravar_texto_do_turno(state, content, model_name)
            state

          calls ->
            # RN-698: o texto desta volta continua na próxima.
            TextoDoTurno.acumular(content)
            state = Enum.reduce(calls, state, &dispatch_tool/2)
            run_turn(state, remaining - 1)
        end

      {:error, reason} ->
        # NUNCA mais `agent.response` vazio aqui: no event log ele é
        # indistinguível de sucesso, e o motivo real ia só por broadcast, que
        # é efêmero. A falha vira evento durável COM origem, e o agente diz o
        # que houve no próprio fio.
        gravar_texto_do_turno(state, "", nil)
        emit_falha(state, reason)
        state
    end
  end

  defp dispatch_tool(call, state) do
    name = Map.get(call, "name")
    args = Map.get(call, "arguments", %{})
    id = Map.get(call, "id")

    emit(state, "tool.call", %{tool: name, args: args})
    broadcast(state, "tool.call", %{tool: name, agent: @agent})

    resultado = run_tool(name, args, state)
    emit(state, "tool.result", ResultadoDeFerramenta.payload(name, resultado))
    {_, text} = resultado

    append(state, %{
      "role" => "tool",
      "content" => text,
      "toolCallId" => id,
      "name" => name,
      :pinned => false
    })
  end

  defp run_tool("create_module_map", args, state), do: CreateModuleMap.run(args, state)
  defp run_tool("assign_story_modules", args, state), do: AssignStoryModules.run(args, state)
  defp run_tool("choose_project_image", args, state), do: ChooseProjectImage.run(args, state)
  defp run_tool("create_c4_diagram", args, state), do: CreateC4Diagram.run(args, state)
  defp run_tool("route_modules_to_infra", args, state), do: RouteModulesToInfra.run(args, state)

  defp run_tool("declare_module_contracts", args, state),
    do: DeclareModuleContracts.run(args, state)

  defp run_tool("propose_adr", args, state), do: ProposeAdr.run(args, state)
  defp run_tool("emit_insight", args, state), do: EmitInsight.run(args, state)
  defp run_tool("emit_artifact", args, state), do: EmitArtifact.run(args, state)
  defp run_tool(name, _args, _state), do: {:error, "ferramenta desconhecida: #{name}"}

  # --- Kickoff ---

  defp kickoff_instruction(state) do
    # Leitura POR TIPO, pela cauda (RN-580) — não os PRIMEIROS 200 eventos de
    # todos os tipos, que numa sessão longa deixavam de fora o que nasceu depois.
    case Reidratacao.eventos_do_tipo(state.project_id, state.session_id, [
           "artifact.product_brief",
           "artifact.business_rule",
           "backlog.story_created"
         ]) do
      {:ok, events, truncado?} -> build_kickoff(events) <> Reidratacao.aviso_de_recorte(truncado?)
      _ -> "Defina a arquitetura do produto (module_map, ADRs, insights)."
    end
  end

  defp build_kickoff(events) do
    brief =
      events
      |> Enum.filter(&(Map.get(&1, "type") == "artifact.product_brief"))
      |> List.last()

    summary =
      case brief do
        %{"payload" => %{"summary" => s}} when is_binary(s) -> s
        _ -> "(sem product brief)"
      end

    rules =
      events
      |> Enum.filter(&(Map.get(&1, "type") == "artifact.business_rule"))
      |> Enum.map_join("\n", fn r ->
        p = Map.get(r, "payload", %{})
        "- #{Map.get(p, "title", "")}: #{Map.get(p, "description", "")}"
      end)

    stories =
      events
      |> Enum.filter(&(Map.get(&1, "type") == "backlog.story_created"))
      |> Enum.map_join("\n", fn s ->
        p = Map.get(s, "payload", %{})
        "- story_id=#{Map.get(p, "storyId")} | #{Map.get(p, "title", "")}"
      end)

    """
    Você recebeu o produto do PO. Defina a ARQUITETURA:
    1. create_module_map: proponha os módulos (name, stack, responsibility, depends_on) SEM
       ciclos de dependência.
    2. assign_story_modules: vincule a cada história os módulos que a realizam (use os
       story_id abaixo) — assim ela referencia módulos válidos.
    3. choose_project_image: escolha a IMAGEM de container em que este projeto vai rodar,
       coerente com a stack que você acabou de definir. Enquanto você não escolher, o
       container do projeto não sobe e a aba Code fica fechada — é decisão sua, e ninguém
       a toma no seu lugar.
    4. route_modules_to_infra: depois do module_map, roteie CADA módulo para uma imagem de
       container CANDIDATA, com o porquê — um item por módulo. Você candidata; a Infra
       elege entre as candidatas depois.
    5. declare_module_contracts: para cada módulo que OUTRO usa, declare o que ele expõe
       (função, rota, evento ou forma de dado, com a assinatura exata). É o que os dev
       agents leem para integrar sem abrir o código um do outro; mudar a interface depois
       é declarar de novo, com a lista inteira.
    6. propose_adr: proponha ao menos 1 ADR (decisão arquitetural relevante) — vira uma PR
       pro usuário aprovar.
    7. create_c4_diagram: gere o diagrama C4 (Context + Container) desta arquitetura —
       depois do module_map, porque o Container level é derivado dele. Descreva só o nome
       do sistema e os atores externos (ex.: o usuário, um provedor de Git); os módulos e
       as dependências entram sozinhos.
    8. emit_insight: registre tensões entre as regras e a arquitetura (ex.: um RNF sem
       módulo que o atenda).

    PRODUCT BRIEF:
    #{summary}

    REGRAS DE NEGÓCIO:
    #{rules}

    HISTÓRIAS DO BACKLOG:
    #{stories}
    """
  end

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
  # default: o único call site aqui sempre passa os 3 argumentos.
  defp emit_response(state, content, model_name),
    do: emit(state, "agent.response", %{content: content, modelName: model_name})

  # RN-698: o texto do turno inteiro, numa `agent.response` só.
  defp gravar_texto_do_turno(state, ultimo, model_name) do
    case TextoDoTurno.descarregar(ultimo) do
      "" -> :ok
      texto -> emit_response(state, texto, model_name)
    end
  end

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

  # Diferente de `emit_falha/2`: aqui o TURNO (quando há um) já rodou — o que
  # falhou é só a CRIAÇÃO do handoff, num passo seguinte. Reusar
  # `FalhaDeTurno.mensagem/1` diria "nada foi gasto nesta tentativa", o que
  # seria falso quando `offer_infra_handoff` chegou a rodar turno (RN-116).
  # Mesmo padrão de `criativo_server.ex`.
  defp emit_falha_handoff(state, to_agent, reason) do
    origem = FalhaDeTurno.origem(reason)

    mensagem =
      "Não consegui oferecer o handoff ao #{to_agent}: #{inspect(reason)}. " <>
        "Tente confirmar de novo."

    emit(state, "agent.error", %{
      origem: origem,
      mensagem: mensagem,
      reason: inspect(reason)
    })

    broadcast(state, "agent.error", %{origem: origem, mensagem: mensagem})
    state
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
