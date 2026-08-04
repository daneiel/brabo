defmodule Engine.Agents.PoServer do
  @moduledoc """
  Agente PO (Product Owner) conversacional no harness (Fase 3b). Ativado pelo
  handoff aceito do Criativo, consome o product_brief + as business_rules do
  event log e **produz o backlog** (épicos → histórias → tarefas) via as
  ferramentas create_epic/create_story/create_task (nunca SQL direto).

  Igual ao CriativoServer: GenServer por sessão, estado + rehydration +
  streaming pelo canal Phoenix. **Diferença:** cada turno roda um LOOP bounded
  de tool use — injeta o resultado da ferramenta (ex.: o id do épico) de volta
  na conversa pro modelo encadear as chamadas. Na ativação faz um `:kickoff`
  (gera o backlog); depois conversa pra refinar.
  """

  use GenServer, restart: :temporary

  alias Engine.Harness.{ContextBuilder, PromptAssembler, ContextManager, ToolCallRecovery}
  alias Engine.Agents.FalhaDeTurno
  alias Engine.Harness.Tools.{CreateEpic, CreateStory, CreateTask, OfferHandoff}
  alias Engine.Sessions.{EngineApiClient, LiveBroadcast}

  @agent "po"
  @max_iterations 12

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
         CreateEpic.spec(),
         CreateStory.spec(),
         CreateTask.spec(),
         OfferHandoff.spec()
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

  @impl true
  def handle_call({:revise, story}, _from, state) do
    broadcast(state, "agent.status", %{status: "working"})

    state =
      state
      |> append(revision_message(story))
      |> compact()
      |> run_turn(@max_iterations)

    broadcast(state, "agent.done", %{})
    broadcast(state, "agent.status", %{status: "idle"})
    {:reply, :ok, state}
  end

  # --- Turno com loop bounded de tool use ---

  defp run_turn(state, remaining) when remaining <= 0, do: state

  defp run_turn(state, remaining) do
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

  # Despacha a ferramenta e INJETA o resultado (id/erro) como mensagem `tool`
  # pro modelo encadear (epic id -> create_story -> create_task).
  defp dispatch_tool(call, state) do
    name = Map.get(call, "name")
    args = Map.get(call, "arguments", %{})
    id = Map.get(call, "id")

    emit(state, "tool.call", %{tool: name, args: args})
    result = run_tool(name, args, state)

    text =
      case result do
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

  defp run_tool("create_epic", args, state), do: CreateEpic.run(args, state)
  defp run_tool("create_story", args, state), do: CreateStory.run(args, state)
  defp run_tool("create_task", args, state), do: CreateTask.run(args, state)
  defp run_tool("offer_handoff", args, state), do: OfferHandoff.run(args, state)
  defp run_tool(name, _args, _state), do: {:error, "ferramenta desconhecida: #{name}"}

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
        "Gere o backlog do produto (épicos, histórias e tarefas) usando as ferramentas."
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

    PRODUCT BRIEF:
    #{summary}

    REGRAS DE NEGÓCIO (use estes ids em business_rule_ids):
    #{rules_text}
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
