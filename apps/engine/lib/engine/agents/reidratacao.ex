defmodule Engine.Agents.Reidratacao do
  @moduledoc """
  O caminho ÚNICO pelo qual os seis agentes conversacionais (Criativo, PO,
  Arquiteto, Dev Lead, UX Designer e Staff) reconstroem a conversa a partir do
  event log quando o processo deles sobe sobre uma sessão que já tem conversa
  (RN-580). Antes cada um tinha a SUA cópia de `rehydrate/2` + `to_message/1`,
  as seis idênticas, e as seis com os mesmos três defeitos:

    1. **Liam o COMEÇO, não o fim.** `list_events/2` pede `limit=200` sem
       `latest`, e a api devolve os PRIMEIROS 200 em ordem crescente. Numa
       conversa de 201 eventos o agente acordava sem a última mensagem — a que
       ele estava respondendo. A tela já tinha resolvido isso com `latest: true`
       e aviso de recorte (RN-180); o engine não tinha herdado.
    2. **Reconstruíam só `chat.message` e `agent.response`.** As perguntas que o
       agente fez por formulário (`chat.structured_question`) e as ferramentas
       que ele chamou (`tool.call`/`tool.result`) sumiam — ele acordava sem
       saber que tinha perguntado nem o que já tinha registrado.
    3. **Cortavam calados.** Nada dizia ao agente que havia uma parte da
       conversa que ele não estava vendo.

  O que este módulo faz:

    * lê a CAUDA — os `teto/0` eventos MAIS RECENTES (`latest: true`);
    * quando a cauda não cobre a sessão (o `seq` do primeiro evento dela passa
      de 1 — `seq` é gapless por sessão e começa em 1, então o número de
      omitidos sai de SUBTRAÇÃO, sem requisição a mais: o mesmo mecanismo da
      RN-180), abre o histórico com UM resumo do começo que ESCREVE esse
      número, e o preenche com o que é barato e limitado saber: o resumo da
      última compactação de contexto, quando ele foi gravado (desde a RN-580 o
      `context.compacted` grava o texto), e a ABERTURA da conversa (as
      primeiras mensagens, cortadas). Conversa compactada ANTES do resumo
      passar a ser gravado é DECLARADA como tal, nunca preenchida com palpite;
    * reconstrói, além das mensagens, as perguntas estruturadas e as chamadas
      de ferramenta do PRÓPRIO agente, como TEXTO — ver `mensagens/2`.

  Custo: uma leitura quando a conversa cabe no teto; três (cauda, compactações,
  abertura) quando não cabe — todas com teto, nenhuma com parâmetro que o
  modelo escreva (ADR 0060).
  """

  alias Engine.Sessions.EngineApiClient

  # O teto é o `MAX_LIMIT` da rota de eventos da api (`session-event.repository.ts`)
  # — o do ADR 0060. Pedir mais seria cortado lá do mesmo jeito, e pedir menos
  # deixaria de fora conversa que a api entregaria de graça.
  @teto 200

  # A abertura é uma amostra, não uma segunda cauda: basta para o agente saber
  # como a conversa começou (a ideia original do usuário, a primeira resposta).
  @eventos_da_abertura 40
  @mensagens_da_abertura 6
  @corte_da_abertura 500

  # Quantas compactações recentes olhar atrás de um resumo gravado.
  @compactacoes_consultadas 20

  # Argumentos de ferramenta viram texto no histórico; sem corte, um
  # `propose_prototype` inteiro seria reinjetado a cada reidratação.
  @corte_dos_argumentos 1_500

  @doc "O teto de eventos de toda leitura deste módulo (ADR 0060)."
  def teto, do: @teto

  @doc """
  O histórico reconstruído para `agent`, pronto para entrar depois do system
  prompt. Nunca lança: se a leitura falhar, devolve UMA mensagem de sistema
  dizendo que o histórico não pôde ser lido — o agente não pode acordar achando
  que a conversa começou agora quando só não conseguiu lê-la.
  """
  @spec historico(String.t(), String.t(), String.t()) :: [map()]
  def historico(project_id, session_id, agent) do
    case EngineApiClient.list_events(project_id, session_id, latest: true, limit: @teto) do
      {:ok, cauda} ->
        mensagens = mensagens(cauda, agent)

        case omitidos(cauda) do
          0 -> mensagens
          n -> [resumo_do_comeco(project_id, session_id, agent, n, cauda) | mensagens]
        end

      {:error, motivo} ->
        [
          sistema(
            "Não consegui ler o histórico desta sessão ao subir (#{inspect(motivo)}). " <>
              "Se o usuário se referir a algo dito antes, diga que você não tem esse " <>
              "contexto agora em vez de supor."
          )
        ]
    end
  end

  @doc """
  Os eventos de `tipos` da sessão, os MAIS RECENTES primeiro cortados pelo teto
  e devolvidos em ordem crescente — é a leitura dos kickoffs (brief, regras,
  module_map, histórias) e das refs do product_brief. `truncado?` é `true`
  quando a leitura bateu no teto: pode haver mais antigos que não vieram.

  Antes estas leituras filtravam em memória os PRIMEIROS 200 eventos de TODOS
  os tipos: numa conversa longa com o Criativo, o product_brief nascia depois
  do evento 200 e o PO recebia "(sem product brief disponível)".
  """
  @spec eventos_do_tipo(String.t(), String.t(), [String.t()]) ::
          {:ok, [map()], boolean()} | {:error, term()}
  def eventos_do_tipo(project_id, session_id, tipos) when is_list(tipos) and tipos != [] do
    case EngineApiClient.list_events(project_id, session_id,
           types: tipos,
           latest: true,
           limit: @teto
         ) do
      {:ok, eventos} -> {:ok, eventos, length(eventos) >= @teto}
      {:error, motivo} -> {:error, motivo}
    end
  end

  @doc """
  A frase que um kickoff acrescenta quando a leitura por tipo bateu no teto
  (RN-180 aplicada ao agente: recorte é DITO). Vazia quando não bateu.
  """
  @spec aviso_de_recorte(boolean()) :: String.t()
  def aviso_de_recorte(false), do: ""

  def aviso_de_recorte(true) do
    "\nATENÇÃO: a leitura acima bateu no teto de #{@teto} eventos e trouxe só os " <>
      "mais recentes — pode haver itens mais antigos que não aparecem aqui. Use as " <>
      "ferramentas de leitura para conferir antes de concluir que algo não existe.\n"
  end

  @doc """
  Converte eventos em mensagens do histórico de `agent`. Público para teste.

  O que entra, e por quê:

    * `chat.message` → `user`; `agent.response` → `assistant` — como sempre foi,
      de QUALQUER agente da sessão (a conversa do Criativo é o que o PO herda
      no handoff; mudar isso é outra decisão).
    * `chat.structured_question` → `assistant`, com as perguntas e opções. Sem
      isso o agente acordava sem saber que tinha perguntado.
    * `chat.structured_question_answered` → NADA, de propósito: a api grava
      esse evento E, logo depois, um `chat.message` com as respostas já
      formatadas (`AnswerStructuredQuestionUseCase` reusa
      `SendAgentMessageUseCase`) — é esse `chat.message` que o agente leu ao
      vivo, e reidratar os dois poria a mesma resposta duas vezes.
    * `tool.call` / `tool.result` do PRÓPRIO agente → `assistant`, como uma
      nota de registro com a ferramenta, os argumentos (cortados) e, quando o
      log tem, o desfecho. Nunca como mensagem `role: "tool"`: o evento não
      grava o id da chamada, e um `tool_result` sem o `tool_use` que o
      originou é recusado pelo protocolo do provider. As ferramentas de OUTRO
      agente ficam de fora — não são desta conversa, e o registro delas já
      aparece para este agente pelos artefatos que produziram.
  """
  @spec mensagens([map()], String.t()) :: [map()]
  def mensagens(eventos, agent) do
    eventos
    |> Enum.reduce([], &acumular(&1, &2, agent))
    |> Enum.reverse()
    |> Enum.map(&renderizar/1)
  end

  # --- Conversão ---

  defp acumular(%{"type" => "chat.message", "payload" => payload}, acc, _agent),
    do: [usuario(texto(payload, "text")) | acc]

  defp acumular(%{"type" => "agent.response", "payload" => payload}, acc, _agent),
    do: [assistente(texto(payload, "content") || texto(payload, "text") || "") | acc]

  defp acumular(%{"type" => "chat.structured_question"} = evento, acc, agent),
    do: [assistente(perguntas(evento, agent)) | acc]

  defp acumular(%{"type" => "tool.call", "payload" => payload} = evento, acc, agent) do
    if do_agente?(evento, agent) and is_binary(payload["tool"]) do
      [{:ferramenta, payload["tool"], argumentos(payload["args"]), nil} | acc]
    else
      acc
    end
  end

  defp acumular(%{"type" => "tool.result", "payload" => payload} = evento, acc, agent) do
    if do_agente?(evento, agent) and is_binary(payload["tool"]) do
      resolver(acc, payload["tool"], desfecho(payload))
    else
      acc
    end
  end

  defp acumular(_evento, acc, _agent), do: acc

  # O `tool.result` fecha a chamada MAIS RECENTE da mesma ferramenta ainda sem
  # desfecho — entre as duas pode haver outros eventos (o artefato que a
  # ferramenta gravou, a pergunta que ela emitiu), então não basta olhar o
  # topo. Resultado sem chamada vira nota própria em vez de sumir.
  defp resolver(acc, tool, desfecho) do
    case Enum.find_index(acc, &match?({:ferramenta, ^tool, _, nil}, &1)) do
      nil ->
        [{:ferramenta, tool, nil, desfecho} | acc]

      i ->
        List.update_at(acc, i, fn {:ferramenta, t, args, nil} ->
          {:ferramenta, t, args, desfecho}
        end)
    end
  end

  defp renderizar({:ferramenta, tool, args, desfecho}) do
    chamada =
      case args do
        nil -> "[registro da sessão] A ferramenta `#{tool}` terminou"
        a -> "[registro da sessão] Chamei a ferramenta `#{tool}` com: #{a}"
      end

    fim =
      case desfecho do
        nil -> " — o log não registra o desfecho desta chamada."
        d -> " — desfecho: #{d}."
      end

    assistente(chamada <> fim)
  end

  defp renderizar(mensagem), do: mensagem

  defp desfecho(%{"ok" => true, "resultado" => r} = p) when is_binary(r) do
    aviso =
      case p["resultadoTotal"] do
        n when is_integer(n) -> " [cortado; o total real tinha #{n} caracteres]"
        _ -> ""
      end

    "ok, devolveu: #{r}#{aviso}"
  end

  defp desfecho(%{"ok" => true}), do: "ok"
  defp desfecho(%{"ok" => false} = p), do: "ERRO: #{p["erro"] || "sem motivo registrado"}"
  defp desfecho(_), do: "desconhecido"

  defp argumentos(nil), do: "(sem argumentos)"

  defp argumentos(args) do
    texto =
      case Jason.encode(args) do
        {:ok, json} -> json
        {:error, _} -> inspect(args)
      end

    cortar(texto, @corte_dos_argumentos)
  end

  defp perguntas(%{"payload" => payload} = evento, agent) do
    quem =
      if do_agente?(evento, agent),
        do: "Enviei ao usuário, por formulário, estas perguntas",
        else:
          "O agente #{ator(evento) || "de outro papel"} enviou ao usuário, por formulário, estas perguntas"

    itens =
      (payload["questions"] || [])
      |> Enum.with_index(1)
      |> Enum.map_join("\n", fn {q, i} ->
        opcoes =
          case q["options"] do
            [_ | _] = os -> " (opções: #{Enum.join(os, " | ")})"
            _ -> ""
          end

        "#{i}. #{q["label"]}#{opcoes}"
      end)

    "[registro da sessão] #{quem}:\n#{itens}\nAs respostas chegam como mensagem do usuário."
  end

  defp perguntas(_evento, _agent), do: "[registro da sessão] Enviei perguntas por formulário."

  # O envelope da api traz o ator em `actor: %{kind, id}`; o evento cru do
  # engine, em `actorId`. Aceita os dois.
  defp ator(evento), do: get_in(evento, ["actor", "id"]) || evento["actorId"]

  defp do_agente?(evento, agent), do: ator(evento) == agent

  # --- O começo que não coube ---

  defp omitidos([%{"seq" => seq} | _]) when is_integer(seq) and seq > 1, do: seq - 1
  defp omitidos(_), do: 0

  defp resumo_do_comeco(project_id, session_id, agent, omitidos, cauda) do
    primeiro_seq = omitidos + 1

    partes = [
      "Resumo do começo desta conversa: a sessão tem #{omitidos} evento(s) ANTERIORES " <>
        "aos #{length(cauda)} mais recentes que aparecem abaixo. A leitura tem teto de " <>
        "#{@teto} eventos, então esses #{omitidos} não estão no histórico — o que se " <>
        "sabe deles está aqui.",
      compactacao(project_id, session_id, agent),
      abertura(project_id, session_id, agent, primeiro_seq),
      "Se o usuário se referir a algo desse trecho que não esteja aqui, diga que você " <>
        "não tem esse detalhe em vez de supor."
    ]

    partes |> Enum.reject(&(&1 == "")) |> Enum.join("\n\n") |> sistema()
  end

  # O resumo da compactação mais recente DESTE agente que tenha texto. As
  # compactações gravadas antes da RN-580 só têm a contagem de tokens: elas são
  # CONTADAS e ditas, nunca reconstruídas.
  defp compactacao(project_id, session_id, agent) do
    case EngineApiClient.list_events(project_id, session_id,
           types: ["context.compacted"],
           latest: true,
           limit: @compactacoes_consultadas
         ) do
      {:ok, eventos} ->
        {com_resumo, sem_resumo} =
          eventos
          |> Enum.filter(&(get_in(&1, ["payload", "agent"]) in [nil, agent]))
          |> Enum.split_with(&resumo_gravado?/1)

        case List.last(com_resumo) do
          %{"payload" => %{"summary" => resumo}} = e ->
            "Resumo gravado na compactação de contexto mais recente (evento seq " <>
              "#{e["seq"] || "?"}):\n#{resumo}"

          nil when sem_resumo != [] ->
            "Esta conversa foi compactada #{length(sem_resumo)} vez(es) antes de o resumo " <>
              "da compactação passar a ser gravado no log; aquele resumo se perdeu e não " <>
              "pode ser reconstruído."

          nil ->
            ""
        end

      {:error, motivo} ->
        "Não consegui ler as compactações anteriores (#{inspect(motivo)})."
    end
  end

  defp resumo_gravado?(%{"payload" => %{"summary" => s}}) when is_binary(s) and s != "", do: true
  defp resumo_gravado?(_), do: false

  defp abertura(project_id, session_id, agent, primeiro_seq_da_cauda) do
    case EngineApiClient.list_events(project_id, session_id,
           after_seq: 0,
           limit: @eventos_da_abertura
         ) do
      {:ok, eventos} ->
        linhas =
          eventos
          |> Enum.filter(&(not is_integer(&1["seq"]) or &1["seq"] < primeiro_seq_da_cauda))
          |> mensagens(agent)
          |> Enum.take(@mensagens_da_abertura)
          |> Enum.map_join("\n", fn m ->
            "- #{papel(m["role"])}: #{cortar(m["content"], @corte_da_abertura)}"
          end)

        if linhas == "",
          do: "",
          else: "Abertura da conversa (as primeiras mensagens, cortadas):\n#{linhas}"

      {:error, motivo} ->
        "Não consegui ler a abertura da conversa (#{inspect(motivo)})."
    end
  end

  defp papel("user"), do: "usuário"
  defp papel(_), do: "agente"

  # --- Formas ---

  defp texto(payload, chave) when is_map(payload) do
    case Map.get(payload, chave) do
      s when is_binary(s) -> s
      _ -> nil
    end
  end

  defp texto(_payload, _chave), do: nil

  defp cortar(nil, _), do: ""

  defp cortar(texto, max) do
    if String.length(texto) > max, do: String.slice(texto, 0, max) <> "…", else: texto
  end

  defp usuario(texto), do: %{"role" => "user", "content" => texto || "", :pinned => false}
  defp assistente(texto), do: %{"role" => "assistant", "content" => texto, :pinned => false}
  defp sistema(texto), do: %{"role" => "system", "content" => texto, :pinned => false}
end
