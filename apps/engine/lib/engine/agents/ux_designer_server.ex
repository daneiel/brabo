defmodule Engine.Agents.UxDesignerServer do
  @moduledoc """
  UX/Product Designer conversacional (ADR 0087) — o quinto agente
  conversacional (ao lado de Criativo, PO, Arquiteto e Dev Lead), SOLO: sem
  área, sem subagentes.

  Decisão consciente do dono do produto de ANTECIPAR este papel: o gatilho de
  separação que `docs/fluxo.yml` sempre declarou ("quando o projeto
  GERENCIADO tiver interface própria a desenhar") não disparou — o design
  system continua sendo insumo ESTÁTICO, não um projeto vivo com UI. O papel
  entra ativo mesmo assim, por decisão explícita.

  Ativado por handoff aceito endereçado a "ux-designer" (mesmo mecanismo
  genérico de `ActivateAgentUseCase`/`canActivateAgent` na api — nenhuma
  mudança lá: qualquer agente com handoff `accepted` já é ativável). Consome
  a necessidade de negócio mais recente (`artifact.product_brief`, o mesmo
  artefato que o Criativo produz) e o sistema de design — DESCRITO na
  identidade (`Engine.Harness.Agents`), porque os agentes conversacionais não
  têm ferramenta de leitura de arquivo do repositório; não há tool de leitura
  a reusar aqui.

  Espelha `Engine.Agents.DevLeadServer`: GenServer por sessão, estado +
  rehydration + streaming + laço bounded de tool use — SEM a suspensão do
  ADR 0086, porque `propose_prototype` não tem efeito externo que caiba em
  `proposed_action` (é conteúdo, não ação; não há paralelo do "gasto que o
  teto da RN-083 cobra"). O que SOBREVIVE do desenho do Dev Lead é a outra
  metade: um `propose_prototype` BEM-SUCEDIDO encerra o turno, pela mesma
  lição que o motivou lá — sem isso o laço volta ao modelo, que pode propor
  de novo e produzir dois protótipos com o mesmo total. Só ele existe como
  ferramenta aqui (não há um segundo tool call a encadear como no Arquiteto),
  então "para no primeiro sucesso" não perde nada.
  """

  use GenServer, restart: :temporary

  alias Engine.Harness.{ContextBuilder, PromptAssembler, ContextManager, ToolCallRecovery}
  alias Engine.Harness.Tools.EmitArtifact
  alias Engine.Agents.{FalhaDeTurno, TurnoAssincrono, UxDesignerTools}
  alias Engine.Sessions.EngineApiClient

  @agent "ux-designer"

  # Conversacional de raciocínio (mesmo calibre de Arquiteto/DevLead — não é
  # conversação leve como Criativo/PO). Laço PRÓPRIO, não o teto do
  # `ToolLoop` (`Engine.Harness.Iteracoes`, que é dos agentes de execução e
  # de gate).
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
    do: {:via, Registry, {Engine.Sessions.Registry, "ux-designer:" <> session_id}}

  def kickoff(session_id), do: GenServer.cast(via(session_id), :kickoff)

  def user_message(session_id, text),
    do: GenServer.call(via(session_id), {:user_message, text}, 180_000)

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
       # Frente 3 do plano de decision_record: `emit_artifact` entra como
       # SEGUNDA ferramenta, aditiva — `propose_prototype` continua a
       # primeira e intocada.
       tool_specs: [UxDesignerTools.spec(), EmitArtifact.spec()],
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
  def handle_info(msg, state) do
    case TurnoAssincrono.tratar_resultado(msg, state) do
      {:ok, novo_state} -> {:noreply, novo_state}
      :ignorado -> {:noreply, state}
    end
  end

  # --- Turno com loop bounded de tool use ---

  # O teto de iterações deixou de ser SILENCIOSO — mesma correção da RN-166
  # já aplicada ao PO: um UX Designer que esgotasse as 14 iterações terminava
  # sem evento nenhum, indistinguível de um turno que simplesmente acabou.
  defp run_turn(state, remaining) when remaining <= 0 do
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
      # `Map.put(resultado, :turno_assincrono, nil)`.
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
            state

          calls ->
            {state, sucesso?} =
              Enum.reduce(calls, {state, false}, fn call, {st, sucesso_acumulado} ->
                {st2, desfecho} = dispatch_tool(call, st)
                {st2, sucesso_acumulado or desfecho == :ok}
              end)

            # BEM-SUCEDIDO, e não "chamou a ferramenta": um protótipo
            # RECUSADO (personas/jornadas/telas vazias, ou falha ao gravar)
            # precisa deixar o laço seguir, senão a recusa vira fim de turno
            # e o modelo nunca chega a corrigir — mesma guarda do Dev Lead.
            if sucesso? do
              state
            else
              run_turn(state, remaining - 1)
            end
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

  # Devolve `{state, :ok | :error}` — o segundo elemento é o que `run_turn/2`
  # usa para decidir entre continuar (nenhuma chamada bem-sucedida ainda) e
  # parar (o protótipo foi registrado).
  defp dispatch_tool(call, state) do
    name = Map.get(call, "name")
    args = Map.get(call, "arguments", %{})
    id = Map.get(call, "id")

    emit(state, "tool.call", %{tool: name, args: args})
    broadcast(state, "tool.call", %{tool: name, agent: @agent})

    {text, desfecho} =
      case run_tool(name, args, state) do
        {:ok, s} -> {s, :ok}
        {:error, s} -> {s, :error}
      end

    state =
      append(state, %{
        "role" => "tool",
        "content" => text,
        "toolCallId" => id,
        "name" => name,
        :pinned => false
      })

    {state, desfecho}
  end

  defp run_tool("propose_prototype", args, state), do: UxDesignerTools.run(args, state)
  defp run_tool("emit_artifact", args, state), do: EmitArtifact.run(args, state)
  defp run_tool(name, _args, _state), do: {:error, "ferramenta desconhecida: #{name}"}

  # --- Kickoff ---

  defp kickoff_instruction(state) do
    case EngineApiClient.list_events(state.project_id, state.session_id) do
      {:ok, events} -> build_kickoff(events)
      _ -> "Proponha o protótipo navegável (propose_prototype) a partir da conversa."
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

    """
    Você recebeu a necessidade de negócio do Criativo (product brief).
    Proponha o protótipo navegável com `propose_prototype`: personas,
    jornadas, as telas do protótipo (com o sistema de design da sua
    identidade) e um resumo. A chamada já oferece o protótipo como handoff
    ao PO e ao Dev Lead — não peça handoff separado.

    NECESSIDADE DE NEGÓCIO (product brief):
    #{summary}
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

  defp append(state, message), do: %{state | messages: state.messages ++ [message]}

  defp to_wire(message), do: Map.delete(message, :pinned)

  # Modelo local costuma descrever a chamada em TEXTO em vez de usar o
  # protocolo nativo. O ToolLoop já recuperava isso (ADR 0020), mas os agentes
  # conversacionais têm loop PRÓPRIO e ficaram de fora — o InfraAgent morria
  # com resposta vazia tendo escrito a ferramenta certa em texto.
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
