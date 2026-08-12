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
  (CLAUDE.md 3b.2/3b.3). `confirm_readiness` RECUSA a confirmação — sem
  subir a Task, sem product_brief, sem handoff — quando zero regras de
  negócio foram capturadas na sessão: a garantia vive aqui, não só na UI
  (`SessionPage.tsx` desabilita o botão, mas isso é só a UX complementar).
  """

  use GenServer, restart: :temporary

  alias Engine.Harness.{
    ContextBuilder,
    PromptAssembler,
    ContextManager,
    ArtifactSchemas,
    ToolCallRecovery
  }

  alias Engine.Agents.{FalhaDeTurno, TurnoAssincrono}
  alias Engine.Harness.Tools.EmitArtifact
  alias Engine.Sessions.EngineApiClient

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
       tool_specs: [EmitArtifact.spec()],
       # Guardado enquanto o turno roda numa Task supervisionada, fora do
       # `handle_call` que bloqueava o processo inteiro — é o que permite um
       # `:cancel` chegar e ser atendido (RN-122). Ver `TurnoAssincrono`.
       turno_assincrono: nil
     }}
  end

  # O turno passou a rodar numa Task (`TurnoAssincrono`), fora deste
  # `handle_call`: antes o processo inteiro ficava bloqueado até o turno
  # terminar, e um `:cancel` nunca era atendido nesse meio tempo (RN-122).
  @impl true
  def handle_call({:user_message, text}, from, state) do
    work = state |> append(user_msg(text)) |> compact()
    TurnoAssincrono.iniciar(state, from, fn -> run_turn(work) end)
  end

  # Guardrail: zero regras de negócio capturadas → recusa ANTES de subir a
  # Task — nem o turno de consolidação roda, nem o product_brief, nem o
  # handoff. Não passa por `TurnoAssincrono` porque não é um turno de LLM: é
  # uma decisão do SERVIDOR, resolvida sem chamar o modelo. E como
  # `agent_command_controller.ex#readiness/2` IGNORA o retorno deste
  # `GenServer.call` e sempre responde 202 (mesmo padrão do `message/2` desde
  # RN-122 — "esta resposta é só o aceite"), a ÚNICA forma do usuário saber
  # por quê é o `agent.error` DURÁVEL no fio (RN-059), não o HTTP.
  @impl true
  def handle_call(:confirm_readiness, from, state) do
    case business_rule_refs(state) do
      [] ->
        emit_falha_sem_regra(state)
        {:reply, {:error, :sem_regra_de_negocio}, state}

      _refs ->
        TurnoAssincrono.iniciar(state, from, fn -> executar_confirm_readiness(state) end)
    end
  end

  @impl true
  def handle_cast(:cancel, state) do
    {:noreply, TurnoAssincrono.cancelar(state)}
  end

  @impl true
  def handle_info(msg, state) do
    case TurnoAssincrono.tratar_resultado(msg, state) do
      {:ok, novo_state} -> {:noreply, novo_state}
      :ignorado -> {:noreply, state}
    end
  end

  # Turno dedicado: o modelo consolida as regras num resumo executivo. O
  # servidor então emite o product_brief (server-emitted, fora da whitelist
  # de tool) e oferece o handoff ao PO. Roda inteiro dentro da Task de
  # `TurnoAssincrono` — inclusive a criação do handoff, então cancelar no
  # meio também impede o handoff de nascer (o que já rodou do turno até ali
  # fica registrado; o resto, não).
  defp executar_confirm_readiness(state) do
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

    # Era `{:ok, _handoff} = ...`: um `MatchError` no `{:error, _}` derrubava
    # o GenServer inteiro (`restart: :temporary`, sem reinício automático) —
    # DEPOIS do turno já ter rodado e do product_brief já ter sido gravado.
    # A informação "passava" (estava no event log), mas o handoff nunca
    # existia e ninguém saberia por quê: nem `agent.error`, nem resposta no
    # fio, só o processo sumindo (RN-116).
    case EngineApiClient.create_handoff(
           state.project_id,
           state.session_id,
           @agent,
           "po",
           brief_id
         ) do
      {:ok, _handoff} -> state
      {:error, reason} -> emit_falha_handoff(state, "po", reason)
    end
  end

  # --- Turno ---

  defp run_turn(state) do
    {state, _content} = run_turn_capturing(state)
    state
  end

  defp run_turn_capturing(state) do
    # O `agent` viaja junto do texto (achado C): a tela rotulava a bolha ao vivo
    # com o nome do MODELO porque o delta não dizia quem estava falando, e o
    # agente só aparecia quando o evento persistido chegava.
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

      {:ok, %{"message" => message} = frame} ->
        content = Map.get(message, "content", "")
        model_name = Map.get(frame, "modelName")
        state = append(state, assistant_msg(content))
        if content != "", do: emit_response(state, content, model_name)
        state = Enum.reduce(tool_calls(message, state.tool_specs), state, &dispatch_tool/2)
        {state, content}

      {:error, reason} ->
        # NUNCA mais `agent.response` vazio aqui: no event log ele é
        # indistinguível de sucesso, e o motivo real ia só por broadcast, que
        # é efêmero. A falha vira evento durável COM origem, e o agente diz o
        # que houve no próprio fio.
        emit_falha(state, reason)
        {state, ""}
    end
  end

  # emit_artifact é a única ferramenta do Criativo; o guardrail (product_brief
  # bloqueado) vive dentro de EmitArtifact.run. Rodamos direto (tool :direct),
  # sem pipeline/hooks — o Criativo não toca terminal/arquivos.
  defp dispatch_tool(%{"name" => "emit_artifact", "arguments" => args} = call, state) do
    emit(state, "tool.call", %{tool: "emit_artifact", args: args})

    # O resultado era DESCARTADO (`_ =`). Um payload recusado pelo schema — o
    # modelo emitiu `titulo`/`descricao` contra `title`/`description` — sumia
    # sem evento, sem aviso e sem chegar ao modelo: o Criativo dizia "registrei
    # as regras", quatro regras iam para o lixo e o painel ficava vazio.
    case EmitArtifact.run(args, state) do
      {:ok, texto} ->
        emit(state, "tool.result", %{tool: "emit_artifact", ok: true})
        realimentar(state, call, texto)

      {:error, motivo} ->
        emit(state, "tool.result", %{
          tool: "emit_artifact",
          ok: false,
          erro: to_string(motivo)
        })

        # O agente FALA (RN-059) e o erro VOLTA para o modelo: no próximo turno
        # ele lê o motivo e reemite corrigido, que é como um tool loop deve
        # funcionar — erro é entrada, não fim de linha.
        emit_response(
          state,
          "Não consegui registrar isso: #{motivo}. Vou corrigir e tentar de novo."
        )

        realimentar(state, call, "ERRO: #{motivo}")
    end
  end

  defp dispatch_tool(_other, state), do: state

  # Devolve o resultado da ferramenta ao histórico, no papel `tool` — é o que
  # o PO e o Arquiteto já faziam, e o que faltava aqui.
  defp realimentar(state, call, texto) do
    append(state, %{
      "role" => "tool",
      "content" => to_string(texto),
      "toolCallId" => Map.get(call, "id"),
      "name" => "emit_artifact",
      :pinned => false
    })
  end

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

  # `model_name` viaja do frame `final` da api (achado do problema 2) — nulo
  # nas respostas server-emitted que não vêm de um turno de LLM real (ex.: a
  # mensagem de erro sintética quando `emit_artifact` recusa o payload).
  defp emit_response(state, content, model_name \\ nil),
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

  # Diferente de `emit_falha/2`: aqui o TURNO já rodou e o product_brief já
  # foi gravado — o que falhou é só a CRIAÇÃO do handoff, num passo seguinte.
  # Reusar `FalhaDeTurno.mensagem/1` diria "nada foi gasto nesta tentativa",
  # o que seria falso (RN-116). Reusa só `origem/1`, que classifica pelo
  # FORMATO do motivo, não por ser turno de LLM.
  defp emit_falha_handoff(state, to_agent, reason) do
    origem = FalhaDeTurno.origem(reason)

    mensagem =
      "Consolidei o product brief, mas não consegui oferecer o handoff ao " <>
        "#{to_agent}: #{inspect(reason)}. As regras de negócio já registradas " <>
        "continuam salvas — confirme a prontidão de novo para tentar oferecer " <>
        "o handoff outra vez."

    emit(state, "agent.error", %{
      origem: origem,
      mensagem: mensagem,
      reason: inspect(reason)
    })

    broadcast(state, "agent.error", %{origem: origem, mensagem: mensagem})
    state
  end

  # A recusa do guardrail de prontidão (zero regra de negócio). "politica" —
  # não `FalhaDeTurno.origem/1` — porque não há `reason` de turno nenhum pra
  # classificar: é decisão de produto, resolvida antes de qualquer chamada ao
  # modelo (mesmo raciocínio de `TurnoAssincrono.emitir_cancelamento/1`, que
  # também hardcoda "politica" direto).
  defp emit_falha_sem_regra(state) do
    origem = "politica"
    mensagem = no_business_rules_message()

    emit(state, "agent.error", %{
      origem: origem,
      mensagem: mensagem,
      reason: "sem_regra_de_negocio"
    })

    broadcast(state, "agent.error", %{origem: origem, mensagem: mensagem})
    state
  end

  defp no_business_rules_message do
    "ainda não há nenhuma regra de negócio registrada nesta conversa — continue " <>
      "conversando com o Criativo até capturar pelo menos uma regra antes de " <>
      "confirmar prontidão"
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
