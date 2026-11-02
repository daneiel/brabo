defmodule Engine.Harness.DecisoesDoProjeto do
  @moduledoc """
  As DECISÕES do usuário e as perguntas ABERTAS do projeto, no turno do PO
  (RN-874, AT-526). Sem isto o PO escrevia "pergunta em aberto 1" numa
  história criada depois de o usuário já ter respondido a pergunta: ele não
  lia `decision_record` nem `open_question.answered`.

  Segue o caminho efêmero do fluxo do time (RN-711): a fachada
  `Engine.Sessions.EngineApiClient` acrescenta o texto como mensagem `system`
  no fim da lista, depois do fluxo — nunca em `state.messages` nem no prompt
  do servidor. Só para o `po`.

  Leitura LOCAL do event log (`Event.list_types_for_project/3`, Postgres
  direto, sem HTTP no laço — a régua da RN-566), do projeto inteiro: aberta é
  `artifact.open_question` sem `open_question.answered` com o mesmo
  `questionId`. Teto: 10 decisões, 10 perguntas, 240 caracteres por item,
  3 000 no texto. Leitura que falha ou nada a dizer = lista intacta, nunca
  queda do turno.
  """

  alias Engine.SessionEvents.Event

  @agentes ~w(po)
  @teto_itens 10
  @teto_item 240
  @teto 3000
  @leitura 200

  @doc "O teto em caracteres do texto acrescentado."
  def teto_de_caracteres, do: @teto

  @doc "A lista com as decisões/perguntas no FIM, ou intacta (outro agente, nada a dizer, falha)."
  @spec anexar([map()], term(), String.t()) :: [map()]
  def anexar(messages, project_id, agent)
      when is_list(messages) and agent in @agentes and is_binary(project_id) do
    case texto(project_id) do
      nil -> messages
      t -> messages ++ [%{"role" => "system", "content" => t}]
    end
  rescue
    _ -> messages
  catch
    :exit, _ -> messages
  end

  def anexar(messages, _project_id, _agent), do: messages

  @doc "O texto para o projeto, ou `nil` sem decisão nem pergunta aberta. Público para teste."
  def texto(project_id) do
    eventos =
      Event.list_types_for_project(
        project_id,
        ["artifact.decision_record", "artifact.open_question", "open_question.answered"],
        @leitura
      )

    respondidas =
      for %{type: "open_question.answered", payload: p} <- eventos,
          into: MapSet.new(),
          do: Map.get(p || %{}, "questionId")

    decisoes =
      for(%{type: "artifact.decision_record", payload: p} <- eventos, do: p || %{})
      |> Enum.take(-@teto_itens)
      |> Enum.map(fn p ->
        "- " <> curto("#{Map.get(p, "choice", "")} (contexto: #{Map.get(p, "context", "")})")
      end)

    abertas =
      for(
        %{type: "artifact.open_question", payload: p} <- eventos,
        not MapSet.member?(respondidas, Map.get(p || %{}, "questionId")),
        do: p || %{}
      )
      |> Enum.take(-@teto_itens)
      |> Enum.map(fn p ->
        "- questionId=#{Map.get(p, "questionId")}: " <>
          curto(to_string(Map.get(p, "pergunta", "")))
      end)

    montar(decisoes, abertas)
  end

  defp montar([], []), do: nil

  defp montar(decisoes, abertas) do
    texto =
      [
        "DECISÕES E PERGUNTAS DO PROJETO. Ao escrever história, regra, DoR, DoD ou " <>
          "tarefa, use a RESPOSTA decidida — nunca escreva \"pergunta em aberto N\".",
        if(decisoes != [], do: "Decisões do usuário:\n" <> Enum.join(decisoes, "\n")),
        if(abertas != [],
          do:
            "Perguntas AINDA abertas (não invente a resposta; cite o questionId no que " <>
              "depende dela):\n" <> Enum.join(abertas, "\n")
        )
      ]
      |> Enum.reject(&is_nil/1)
      |> Enum.join("\n\n")

    if String.length(texto) > @teto, do: String.slice(texto, 0, @teto - 1) <> "…", else: texto
  end

  defp curto(s) do
    s = String.trim(s)
    if String.length(s) > @teto_item, do: String.slice(s, 0, @teto_item - 1) <> "…", else: s
  end
end
