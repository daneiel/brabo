defmodule Engine.Agents.StaffServer do
  @moduledoc """
  Agente Staff conversacional (papel `staff`/Staff-Principal Engineer,
  `docs/fluxo.yml` `camada_decisao_tecnica`, ADR 0088).

  Espelha `Engine.Agents.ArquitetoServer`: GenServer por sessão, estado +
  rehydration + streaming + laço bounded de tool use (`propose_rfc`, único).
  Produz um RFC — problema, opções com trade-offs, recomendação e o escopo
  de uma PoC descartável — e devolve o handoff ao Arquiteto (dentro do
  próprio tool call, ver `Engine.Agents.StaffTools`).

  ## Por que este servidor NÃO define `kickoff/1`

  Todos os outros leads conversacionais (Criativo, PO, Arquiteto, Dev Lead,
  Infra) sintetizam uma instrução de abertura a partir do event log da
  sessão (`kickoff_instruction/1` em cada um deles) — há sempre um artefato
  anterior (product_brief, module_map, backlog) para resumir. O Staff não
  tem essa fonte: o gatilho que o traria à tona — a Anamnese notando um
  problema sistêmico RECORRENTE (`docs/fluxo.yml`: "ativacao") — está
  pendente enquanto `ANAMNESE_ENABLED=false` (decisão de produto de
  2026-08-10). Sem kickoff automático, o processo sobe (rehidrata o
  histórico) e fica ocioso até uma `user_message` chegar — que é como quem
  cria o handoff manualmente (outro agente ou o usuário, ver ADR 0088)
  explica o problema pela primeira vez.

  ## Ativação: o caminho GENÉRICO, sem `USER_STARTED_AGENTS`

  `staff` não entra em `USER_STARTED_AGENTS`
  (`apps/api/src/domain/sessions/agent-activation.ts`) — essa lista é a
  exceção do Criativo (inicia SEM handoff, por comando direto do usuário).
  O Staff segue a regra PADRÃO de `canActivateAgent`: ativa com qualquer
  handoff `accepted` endereçado a ele, o mesmo caminho que já vale para
  `dev-lead`/`arquiteto`/`infra`. Nenhuma mudança de domínio foi necessária
  na api para isto — `assertHandoffTargetAllowed`
  (`apps/api/src/domain/agents/agent-areas.ts`) já permite endereçar
  qualquer agente que não seja SUBAGENTE de área, e o Staff não tem área.
  """

  use GenServer, restart: :temporary

  alias Engine.Harness.{ContextBuilder, PromptAssembler, ContextManager, ToolCallRecovery}
  alias Engine.Harness.Tools.EmitArtifact
  alias Engine.Agents.{FalhaDeTurno, StaffTools, TurnoAssincrono}
  alias Engine.Sessions.EngineApiClient

  @agent "staff"

  # Conversacional, sem área: mesmo teto (14) de Arquiteto e Dev Lead — é
  # raciocínio (montar um RFC), não conversa leve.
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
    do: {:via, Registry, {Engine.Sessions.Registry, "staff:" <> session_id}}

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
       # SEGUNDA ferramenta, aditiva — `propose_rfc` continua a primeira.
       tool_specs: [StaffTools.spec(), EmitArtifact.spec()],
       # Guardado enquanto o turno roda numa Task supervisionada, fora do
       # handler que bloqueava o processo inteiro — é o que permite um
       # `:cancel` chegar e ser atendido (RN-122). Ver `TurnoAssincrono`.
       turno_assincrono: nil
     }}
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
  # já aplicada ao PO: um Staff que esgotasse as 14 iterações terminava sem
  # evento nenhum, indistinguível de um turno que simplesmente acabou.
  defp run_turn(state, remaining) when remaining <= 0 do
    emit(state, "toolloop.limit_reached", %{
      iteration: @max_iterations,
      max_iterations: @max_iterations
    })

    state
  end

  defp run_turn(state, remaining) do
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
      # Devolve `state` (mapa), e NÃO `{state, ""}` (tupla) — ver o comentário
      # equivalente em `arquiteto_server.ex`/`dev_lead_server.ex`.
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
            state = Enum.reduce(calls, state, &dispatch_tool/2)
            run_turn(state, remaining - 1)
        end

      {:error, reason} ->
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

  defp run_tool("propose_rfc", args, state), do: StaffTools.run(args, state)
  defp run_tool("emit_artifact", args, state), do: EmitArtifact.run(args, state)
  defp run_tool(name, _args, _state), do: {:error, "ferramenta desconhecida: #{name}"}

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
  # protocolo nativo — mesma recuperação dos demais conversacionais.
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

  defp emit_response(state, content, model_name),
    do: emit(state, "agent.response", %{content: content, modelName: model_name})

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

  defp broadcast(state, event, payload) do
    EngineWeb.Endpoint.broadcast("session:" <> state.session_id, event, payload)
  end
end
