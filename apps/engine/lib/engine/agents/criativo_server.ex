defmodule Engine.Agents.CriativoServer do
  @moduledoc """
  Agente Criativo conversacional (Fase 3b) rodando DENTRO do harness — um
  GenServer por sessão, supervisionado, que guarda o histórico da conversa em
  memória e o REHIDRATA dos `session_events` no restart (o event log é a fonte
  durável da verdade). Cada mensagem do usuário roda UM turno streamado via a
  api (metered; o engine nunca fala com provider direto): os deltas são
  rebroadcastados ao web pelo canal Phoenix `session:<id>`, e a resposta final
  vira `agent.response` no event log.

  Ao longo da conversa o modelo emite artefatos `business_rule` pela ferramenta
  emit_artifact (com origem rastreável). O `product_brief` NUNCA sai por tool
  call — só quando o USUÁRIO confirma prontidão (`confirm_readiness`), o
  servidor consolida as regras num product_brief e oferece o handoff ao PO
  (CLAUDE.md 3b.2/3b.3).
  """

  use GenServer, restart: :temporary

  alias Engine.Harness.{ContextBuilder, PromptAssembler, ContextManager, ArtifactSchemas, ToolCallRecovery}
  alias Engine.Harness.Tools.EmitArtifact
  alias Engine.Sessions.{EngineApiClient, LiveBroadcast}

  @agent "criativo"

  # --- API pública ---

  def start_link({session_id, project_id}) do
    GenServer.start_link(__MODULE__, {session_id, project_id}, name: via(session_id))
  end

  def via(session_id),
    do: {:via, Registry, {Engine.Sessions.Registry, "criativo:" <> session_id}}

  @doc "Roteia uma mensagem do usuário pro Criativo (turno streamado)."
  def user_message(session_id, text),
    do: GenServer.call(via(session_id), {:user_message, text}, 120_000)

  @doc "Confirmação de prontidão do usuário — dispara product_brief + handoff."
  def confirm_readiness(session_id),
    do: GenServer.call(via(session_id), :confirm_readiness, 120_000)

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
       tool_specs: [EmitArtifact.spec()]
     }}
  end

  @impl true
  def handle_call({:user_message, text}, _from, state) do
    broadcast(state, "agent.status", %{status: "working"})

    state =
      state
      |> append(user_msg(text))
      |> compact()
      |> run_turn()

    broadcast(state, "agent.done", %{})
    broadcast(state, "agent.status", %{status: "idle"})
    {:reply, :ok, state}
  end

  @impl true
  def handle_call(:confirm_readiness, _from, state) do
    broadcast(state, "agent.status", %{status: "working"})
    # Turno dedicado: o modelo consolida as regras num resumo executivo. O
    # servidor então emite o product_brief (server-emitted, fora da whitelist
    # de tool) e oferece o handoff ao PO.
    instruction =
      user_msg(
        "O usuário confirmou que está pronto para produzir. Consolide as regras " <>
          "de negócio levantadas nesta conversa num resumo executivo do produto."
      )

    {state, summary} =
      state
      |> append(instruction)
      |> compact()
      |> run_turn_capturing()

    brief_id = emit_product_brief(state, summary)

    {:ok, _handoff} =
      EngineApiClient.create_handoff(state.project_id, state.session_id, @agent, "po", brief_id)

    broadcast(state, "agent.done", %{})
    broadcast(state, "agent.status", %{status: "idle"})
    {:reply, :ok, state}
  end

  # --- Turno ---

  defp run_turn(state) do
    {state, _content} = run_turn_capturing(state)
    state
  end

  defp run_turn_capturing(state) do
    on_delta = fn text -> broadcast(state, "agent.delta", %{text: text}) end
    wire = Enum.map(state.messages, &to_wire/1)

    case EngineApiClient.llm_turn_stream(
           state.project_id,
           state.session_id,
           @agent,
           wire,
           state.tool_specs,
           on_delta
         ) do
      {:ok, %{"message" => message}} ->
        content = Map.get(message, "content", "")
        state = append(state, assistant_msg(content))
        if content != "", do: emit_response(state, content)
        state = Enum.reduce(tool_calls(message, state.tool_specs), state, &dispatch_tool/2)
        {state, content}

      {:error, reason} ->
        emit_response(state, "")
        broadcast(state, "agent.error", %{reason: inspect(reason)})
        {state, ""}
    end
  end

  # emit_artifact é a única ferramenta do Criativo; o guardrail (product_brief
  # bloqueado) vive dentro de EmitArtifact.run. Rodamos direto (tool :direct),
  # sem pipeline/hooks — o Criativo não toca terminal/arquivos.
  defp dispatch_tool(%{"name" => "emit_artifact", "arguments" => args}, state) do
    emit(state, "tool.call", %{tool: "emit_artifact", args: args})
    _ = EmitArtifact.run(args, state)
    state
  end

  defp dispatch_tool(_other, state), do: state

  # --- product_brief (server-emitted) ---

  defp emit_product_brief(state, summary) do
    payload = %{
      "title" => "Product Brief",
      "summary" => summary,
      "rules" => business_rule_refs(state)
    }

    case ArtifactSchemas.validate("product_brief", payload) do
      :ok ->
        event = %{
          type: "artifact.product_brief",
          actorKind: "agent",
          actorId: @agent,
          payload: payload
        }

        case EngineApiClient.append_event_returning(state.project_id, state.session_id, event) do
          {:ok, %{"id" => id}} -> id
          _ -> nil
        end

      {:error, _} ->
        nil
    end
  end

  # Refs das regras de negócio já emitidas nesta sessão — lidas do event log
  # (fonte da verdade), não de estado em memória que poderia divergir.
  defp business_rule_refs(state) do
    case EngineApiClient.list_events(state.project_id, state.session_id) do
      {:ok, events} ->
        events
        |> Enum.filter(&(Map.get(&1, "type") == "artifact.business_rule"))
        |> Enum.map(&Map.get(&1, "id"))

      _ ->
        []
    end
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
