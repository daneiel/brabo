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

  ## O artefato segue o PROJETO (RN-623, AT-245)

  Num turno COM autor, a resposta de chat é da pessoa, mas o que o agente
  GRAVA como artefato compartilhado do projeto sai no idioma do PROJETO
  (decisão do mantenedor, AT-168 resposta 8 e AT-245). Quando a chamada leva
  ao menos uma ferramenta de `ferramentas_de_artefato/0` e o idioma do projeto
  DIFERE do do autor, a orientação ganha uma segunda cláusula — "Artefatos do
  projeto: em X." / "Write project artifacts in X." — na MESMA mensagem, sem
  mensagem a mais. Idiomas iguais, chamada sem ferramenta de artefato, ou
  turno sem autor: a orientação de antes, sem acréscimo.

  O mecanismo é a orientação, e não a descrição de cada ferramenta, por custo e
  por lugar: a descrição viaja em TODA chamada do agente, em cada uma das
  ferramentas, com idiomas iguais ou não; a cláusula só existe quando os dois
  idiomas diferem, e mora no mesmo lugar que já decide o idioma. Ler o idioma
  do projeto que FALHA não derruba nada: fica só a orientação do autor, e o
  motivo vai para o log.

  A cláusula só entra com os DOIS códigos na forma canônica curta
  (`idioma[-Escrita][-Região]`, ex.: `pt-BR`, `zh-Hant-TW`, `es-419`) — é essa
  forma que cabe no teto; código fora dela fica só com a do autor, e o log diz.

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

  Com a cláusula do artefato (RN-623), medido do mesmo jeito sobre todos os
  pares de `pt-BR`, `en`, `es`, `es-MX` e `zh-Hant-TW`: pior caso `pt-BR` →
  `zh-Hant-TW`, 42 / 36 (o texto em português custa mais token que o em
  inglês); `en` → `pt-BR` 26 / 26; genérico `es-MX` → `zh-Hant-TW` 36 / 36. O
  pior caso da forma curta aceita (`pt-BR` → um código de 12 caracteres, como
  `tlh-Piqd-419`) mede 44 / 37 — ~48 com a moldura; o genérico com dois
  códigos de 12 caracteres, 42 / 40. Em português, 160 caracteres com código
  esquisito passariam de 50 tokens: por isso quem segura o teto da forma
  combinada é a FORMA dos códigos, e o vigia em caracteres dela é 165.
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

  # A cláusula do artefato (RN-623), no idioma do texto a que ela se soma: a
  # do `pt-BR` em português, a de todos os outros em inglês (como o genérico).
  @clausulas_do_artefato %{"pt-BR" => "Artefatos do projeto: em "}
  @clausula_do_artefato_generica "Write project artifacts in "

  # A MESMA forma que a api aceita para um código BCP-47 (lista aberta,
  # AT-168 resposta 2), só para nunca interpolar no prompt um valor que não
  # seja um código de idioma — a api já validou, isto é a segunda barreira.
  @forma_bcp47 ~r/\A[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8}){0,4}\z/

  # A forma canônica CURTA que a cláusula do artefato exige nos dois códigos
  # (RN-623): é ela que segura o teto de 50 tokens, não o comprimento.
  @forma_curta ~r/\A[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?\z/

  # As ferramentas que GRAVAM artefato compartilhado do projeto (RN-623): o
  # que elas persistem é lido por outras pessoas e pelos próximos agentes, e
  # por isso sai no idioma do projeto. Fora, de propósito:
  # `ask_structured_questions` (é pergunta à PESSOA do turno), `offer_handoff`
  # (não leva texto), as de leitura (`listar_*`, `rag_*`, `read_file`,
  # `search_workspace`), `validate_infra_file` (só valida) e as propostas de
  # subir container (pedem decisão à pessoa, não gravam artefato).
  @ferramentas_de_artefato ~w(
    emit_artifact
    create_epic create_story create_task
    create_module_map assign_story_modules choose_project_image create_c4_diagram
    route_modules_to_infra declare_module_contracts propose_adr emit_insight
    propose_execution_plan assess_implementability
    propose_prototype
    propose_rfc
    propose_infra_pr
  )

  @doc "O teto de tamanho, em caracteres, que o teste usa como vigia dos 50 tokens."
  def teto_de_caracteres, do: 160

  @doc "O vigia em caracteres da orientação COM a cláusula do artefato (RN-623)."
  def teto_de_caracteres_combinado, do: 165

  @doc "Os nomes das ferramentas que gravam artefato compartilhado do projeto (RN-623)."
  def ferramentas_de_artefato, do: @ferramentas_de_artefato

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
  A orientação de um turno COM autor numa chamada que pode gravar artefato
  compartilhado (RN-623): a do autor e, quando o idioma do projeto DIFERE e os
  dois códigos têm a forma curta, a cláusula "artefatos no idioma do projeto".
  Idiomas iguais, ou projeto sem idioma, = `orientacao(autor)`, sem acréscimo.
  """
  @spec orientacao(term(), term()) :: String.t() | nil
  def orientacao(autor, projeto) do
    base = orientacao(autor)

    cond do
      is_nil(base) or not is_binary(projeto) or mesmo_idioma?(autor, projeto) ->
        base

      Regex.match?(@forma_curta, autor) and Regex.match?(@forma_curta, projeto) ->
        clausula = Map.get(@clausulas_do_artefato, autor, @clausula_do_artefato_generica)
        "#{base} #{clausula}#{projeto}."

      true ->
        Logger.warning(
          "idioma da resposta: a cláusula do artefato ficou de fora — #{inspect(autor)}/#{inspect(projeto)} fora da forma curta que cabe no teto; segue só o idioma do autor"
        )

        base
    end
  end

  defp mesmo_idioma?(a, b), do: String.downcase(a) == String.downcase(b)

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
  há orientação. `tools` são as ferramentas que a MESMA chamada leva ao modelo:
  é por elas que se sabe se o agente pode gravar artefato do projeto (RN-623).
  Nunca levanta: qualquer falha vira log e a lista volta como veio.
  """
  @spec anexar([map()], String.t() | nil, String.t(), list()) :: [map()]
  def anexar(messages, project_id, agent, tools \\ [])

  def anexar(messages, _project_id, agent, _tools) when agent in @sem_orientacao,
    do: messages

  def anexar(messages, project_id, agent, tools) when is_list(messages) do
    case texto_do_turno(project_id, agent, tools) do
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

  def anexar(messages, _project_id, _agent, _tools), do: messages

  defp texto_do_turno(project_id, agent, tools) do
    case Process.get(@chave) do
      {:autor, idioma} ->
        if orientacao(idioma) != nil and grava_artefato?(tools) do
          orientacao(idioma, idioma_do_projeto_para_o_artefato(project_id, agent))
        else
          orientacao(idioma)
        end

      _ ->
        project_id |> idioma_do_projeto(agent) |> orientacao()
    end
  end

  defp grava_artefato?(tools) when is_list(tools),
    do: Enum.any?(tools, &(nome_da_ferramenta(&1) in @ferramentas_de_artefato))

  defp grava_artefato?(_), do: false

  defp nome_da_ferramenta(%{name: nome}), do: nome
  defp nome_da_ferramenta(%{"name" => nome}), do: nome
  defp nome_da_ferramenta(%{"function" => %{"name" => nome}}), do: nome
  defp nome_da_ferramenta(_), do: nil

  # Num turno COM autor, ler o idioma do projeto que falha não tira o idioma do
  # autor: a cláusula do artefato fica de fora e o log diz por quê.
  defp idioma_do_projeto_para_o_artefato(project_id, agent) do
    case Project.idioma(project_id) do
      {:ok, idioma} ->
        idioma

      {:error, motivo} ->
        Logger.warning(
          "idioma da resposta: não consegui ler o idioma do projeto #{project_id} para o artefato de #{agent} — segue só o idioma do autor (#{motivo})"
        )

        nil
    end
  end

  defp idioma_do_projeto(project_id, agent) do
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
