defmodule Engine.Harness.IdiomaDaResposta do
  @moduledoc """
  A orientação de idioma que acompanha CADA chamada de LLM de um turno de
  agente (RN-622, AT-164). É uma mensagem `role: "system"` EFÊMERA, acrescentada
  ao FIM da lista no momento do envio — nunca entra em `state.messages`, então
  não vai para o histórico, não se acumula de turno em turno e não é resumida
  pela compactação (`Engine.Harness.ContextManager`).

  ## Um lugar só

  Quem acrescenta é a fachada `Engine.Sessions.EngineApiClient` (`llm_turn/5` e
  `llm_turn_stream/6`), pela qual passam TODAS as chamadas de LLM do engine —
  os sete conversacionais, o `ToolLoop` (dev agents e gates) e o Infra Lead —,
  do mesmo jeito que ela já avisa o canal depois de toda escrita (RN-579).
  Nenhum servidor monta a orientação por conta própria.

  ## De onde vem o idioma

  - **Turno COM autor humano** (a mensagem que alguém digitou para o agente):
    a api resolve o idioma DAQUELA pessoa (`ResolverIdiomaDaRespostaUseCase`,
    RN-618 — override da sessão > conta > detectado confirmado > interface) e o
    manda no comando `agent/message` como `idiomaDaResposta`. O servidor do
    agente o põe no estado do TURNO com `com_idioma_do_autor/2`, e ele chega à
    Task do turno pela herança do dicionário de processo de
    `Engine.Agents.TurnoAssincrono`. Campo AUSENTE (api antiga, ou a
    resolução falhou lá) = turno com autor SEM orientação — nunca o idioma do
    projeto no lugar do da pessoa.
  - **Turno SEM autor humano** (kickoff, dev agents, gates, commit, corpo de
    PR, a retomada do Dev Lead depois da aprovação): o idioma do PROJETO
    (`projects.language`, RN-619; AT-169 resposta 1), lido a cada chamada.

  O sumarizador da compactação (`context-manager`) fica FORA: pedir a ele
  "responda em X" traduziria o resumo, e preservar o idioma de cada turno no
  resumo é a AT-166, no prompt dele.

  ## Falha

  Resolver o idioma NUNCA derruba o turno: consulta que falha vira log
  (`warning`) e a chamada segue sem orientação — o comportamento de antes da
  RN-622.

  ## Custo

  Teto decidido: 50 tokens de entrada por chamada (AT-169 resposta 8).
  Medido com `gpt-tokenizer` (cl100k_base / o200k_base), só o conteúdo:
  `pt-BR` 29 / 23, `en` 18 / 18, genérico `es-MX` 26 / 26, e o PIOR caso — o
  genérico com o código mais longo que a forma aceita — 42 / 42. A moldura de
  mensagem do formato de chat soma ~4 tokens, então o pior caso fica em ~46.
  NÃO medido: o tokenizador do DeepSeek e o da Anthropic (onde a mensagem é
  içada para o `system` do topo, sem moldura própria). O
  `idioma_da_resposta_test.exs` trava o tamanho em caracteres (160) como
  vigia do teto — o pior caso medido tem 156.
  """

  require Logger

  alias Engine.Projects.Project

  @chave :brabo_idioma_do_autor

  # O sumarizador da compactação: ver o moduledoc.
  @sem_orientacao ["context-manager"]

  # Constantes de CÓDIGO, nunca instrução versionada: mudar isto não é
  # `instruction_patch` (AT-081), e o texto não depende do modelo — trocar de
  # modelo no meio da sessão não muda nada.
  @textos %{
    "pt-BR" =>
      "Responda em português brasileiro (pt-BR), salvo pedido explícito do usuário por outro idioma nesta mensagem.",
    "en" =>
      "Respond in English (en), unless the user explicitly asks for another language in this message."
  }

  # A MESMA forma que a api aceita para um código BCP-47 (lista aberta,
  # AT-168 resposta 2), só para nunca interpolar no prompt um valor que não
  # seja um código de idioma — a api já validou, isto é a segunda barreira.
  @forma_bcp47 ~r/\A[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8}){0,4}\z/

  @doc "O teto de tamanho, em caracteres, que o teste usa como vigia dos 50 tokens."
  def teto_de_caracteres, do: 160

  @doc """
  O texto da orientação para um código de idioma, ou `nil` quando o valor não
  tem forma de código BCP-47 (e então não há orientação).
  """
  @spec orientacao(term()) :: String.t() | nil
  def orientacao(idioma) when is_binary(idioma) do
    cond do
      texto = Map.get(@textos, idioma) ->
        texto

      Regex.match?(@forma_bcp47, idioma) ->
        "Respond in the language with BCP-47 code #{idioma}, unless the user explicitly asks for another language in this message."

      true ->
        nil
    end
  end

  def orientacao(_), do: nil

  @doc """
  Roda `fun` (o `handle_call` que sobe o turno) com o idioma do AUTOR daquele
  turno no dicionário do processo — é por ele que o idioma chega à Task do
  turno (`TurnoAssincrono` herda o dicionário). A chave é RESTAURADA ao sair:
  o GenServer do agente sobrevive ao turno, e o próximo turno (um kickoff, a
  retomada) não pode herdar o idioma de quem falou antes.

  `idioma` `nil` é turno com autor cuja resolução não chegou: sem orientação.
  """
  def com_idioma_do_autor(idioma, fun) when is_function(fun, 0) do
    anterior = Process.get(@chave)
    Process.put(@chave, {:autor, idioma})

    try do
      fun.()
    after
      if anterior, do: Process.put(@chave, anterior), else: Process.delete(@chave)
    end
  end

  @doc """
  A lista de mensagens com a orientação no FIM, ou a lista intacta quando não
  há orientação. Nunca levanta: qualquer falha vira log e a lista volta como
  veio.
  """
  @spec anexar([map()], String.t() | nil, String.t()) :: [map()]
  def anexar(messages, _project_id, agent) when agent in @sem_orientacao, do: messages

  def anexar(messages, project_id, agent) when is_list(messages) do
    case idioma_do_turno(project_id, agent) |> orientacao() do
      nil -> messages
      texto -> messages ++ [%{"role" => "system", "content" => texto}]
    end
  rescue
    e ->
      Logger.warning(
        "idioma da resposta: orientação omitida para #{agent} no projeto #{project_id} — #{Exception.message(e)}"
      )

      messages
  end

  def anexar(messages, _project_id, _agent), do: messages

  defp idioma_do_turno(project_id, agent) do
    case Process.get(@chave) do
      {:autor, idioma} ->
        idioma

      _ ->
        case Project.idioma(project_id) do
          {:ok, idioma} ->
            idioma

          {:error, motivo} ->
            Logger.warning(
              "idioma da resposta: não consegui ler o idioma do projeto #{project_id} para #{agent} — o turno segue sem orientação (#{motivo})"
            )

            nil
        end
    end
  end
end
