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
  alias Engine.Agents.FalhaDeTurno
  alias Engine.Harness.Tools.{CreateModuleMap, AssignStoryModules, ProposeAdr, EmitInsight}
  alias Engine.Sessions.{EngineApiClient, LiveBroadcast}

  @agent "arquiteto"
  @max_iterations 14

  # --- API pública ---

  def start_link({session_id, project_id}) do
    GenServer.start_link(__MODULE__, {session_id, project_id}, name: via(session_id))
  end

  def via(session_id),
    do: {:via, Registry, {Engine.Sessions.Registry, "arquiteto:" <> session_id}}

  def kickoff(session_id), do: GenServer.cast(via(session_id), :kickoff)

  def user_message(session_id, text),
    do: GenServer.call(via(session_id), {:user_message, text}, 180_000)

  def offer_infra_handoff(session_id),
    do: GenServer.call(via(session_id), :offer_infra_handoff, 180_000)

  @doc """
  Oferece o handoff ao Dev Lead (FASE 14d — ADR 0053).

  SEPARADO do de Infra de propósito, e não porque sejam dois momentos: os dois
  saem da mesma confirmação de arquitetura pronta. É que são duas áreas
  diferentes, com desfechos diferentes — juntá-los numa chamada só faria a
  falha de uma derrubar a outra.
  """
  def offer_dev_handoff(session_id),
    do: GenServer.call(via(session_id), :offer_dev_handoff, 180_000)

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
         CreateModuleMap.spec(),
         AssignStoryModules.spec(),
         ProposeAdr.spec(),
         EmitInsight.spec()
       ]
     }}
  end

  @impl true
  def handle_cast(:kickoff, state) do
    broadcast(state, "agent.status", %{status: "working"})

    state =
      state
      |> append(user_msg(kickoff_instruction(state)))
      |> compact()
      |> run_turn(@max_iterations)

    broadcast(state, "agent.done", %{})
    broadcast(state, "agent.status", %{status: "idle"})
    {:noreply, state}
  end

  @impl true
  def handle_call({:user_message, text}, _from, state) do
    broadcast(state, "agent.status", %{status: "working"})

    state =
      state
      |> append(user_msg(text))
      |> compact()
      |> run_turn(@max_iterations)

    broadcast(state, "agent.done", %{})
    broadcast(state, "agent.status", %{status: "idle"})
    {:reply, :ok, state}
  end

  # O usuário confirmou que a arquitetura está pronta (Fase 4a — fechamento):
  # roda um turno de fechamento (sem ferramenta nova esperada) e OFERECE o
  # handoff ao InfraAgent — mirror de `confirm_readiness` do Criativo (que
  # oferece ao PO), mas server-side/explícito, não inferido pelo modelo.
  @impl true
  def handle_call(:offer_infra_handoff, _from, state) do
    broadcast(state, "agent.status", %{status: "working"})

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

    {:ok, _handoff} =
      EngineApiClient.create_handoff(state.project_id, state.session_id, @agent, "infra", nil)

    broadcast(state, "agent.done", %{})
    broadcast(state, "agent.status", %{status: "idle"})
    {:reply, :ok, state}
  end

  @impl true
  def handle_call(:offer_dev_handoff, _from, state) do
    # Sem turno de LLM: o Arquiteto já falou no `offer_infra_handoff`, que sai
    # da MESMA confirmação. Um segundo turno só para dizer a mesma coisa
    # gastaria tokens para repetir.
    {:ok, _handoff} =
      EngineApiClient.create_handoff(
        state.project_id,
        state.session_id,
        @agent,
        "dev-lead",
        nil
      )

    {:reply, :ok, state}
  end

  # --- Turno com loop bounded de tool use ---

  defp run_turn(state, remaining) when remaining <= 0, do: state

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
      {:ok, %{"error" => erro}} when is_binary(erro) and erro != "" ->
        emit_falha(state, {:final, erro})
        {state, ""}

      {:ok, %{"message" => message}} ->
        content = Map.get(message, "content", "")
        state = append(state, assistant_msg(content))
        if content != "", do: emit_response(state, content)

        case tool_calls(message, state.tool_specs) do
          [] ->
            state

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

  defp dispatch_tool(call, state) do
    name = Map.get(call, "name")
    args = Map.get(call, "arguments", %{})
    id = Map.get(call, "id")

    emit(state, "tool.call", %{tool: name, args: args})

    text =
      case run_tool(name, args, state) do
        {:ok, s} -> s
        {:error, s} -> s
      end

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
  defp run_tool("propose_adr", args, state), do: ProposeAdr.run(args, state)
  defp run_tool("emit_insight", args, state), do: EmitInsight.run(args, state)
  defp run_tool(name, _args, _state), do: {:error, "ferramenta desconhecida: #{name}"}

  # --- Kickoff ---

  defp kickoff_instruction(state) do
    case EngineApiClient.list_events(state.project_id, state.session_id) do
      {:ok, events} -> build_kickoff(events)
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
    3. propose_adr: proponha ao menos 1 ADR (decisão arquitetural relevante) — vira uma PR
       pro usuário aprovar.
    4. emit_insight: registre tensões entre as regras e a arquitetura (ex.: um RNF sem
       módulo que o atenda).

    PRODUCT BRIEF:
    #{summary}

    REGRAS DE NEGÓCIO:
    #{rules}

    HISTÓRIAS DO BACKLOG:
    #{stories}
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
    project_id
    |> ContextBuilder.build_layers(@agent)
    |> PromptAssembler.assemble()
    |> PromptAssembler.Default.render()
  end

  defp user_msg(text), do: %{"role" => "user", "content" => text, :pinned => false}

  defp assistant_msg(content),
    do: %{"role" => "assistant", "content" => content, :pinned => false}

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

  defp emit_response(state, content),
    do: emit(state, "agent.response", %{content: content})

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

  # `agent.status` PRECISA ser persistido, não só broadcastado: o painel do
  # time deriva o roster do event log buscado por HTTP (ver
  # Engine.Sessions.LiveBroadcast.agent_status/4 e o ADR 0021).
  defp broadcast(state, "agent.status", %{status: status}) do
    LiveBroadcast.agent_status(state.project_id, state.session_id, @agent, status)
  end

  defp broadcast(state, event, payload) do
    EngineWeb.Endpoint.broadcast("session:" <> state.session_id, event, payload)
  end
end
