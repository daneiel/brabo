defmodule Engine.Harness.ToolCallRecovery do
  @moduledoc """
  Recupera tool calls que o modelo escreveu como TEXTO em vez de usar o
  protocolo nativo de tool calling.

  ## Por que isto existe

  Modelos locais pequenos (o caso do Ollama nos demos) frequentemente ignoram
  o campo `tools` da requisição e respondem com um bloco ```json descrevendo a
  chamada que QUERIAM fazer. O `ToolLoop` via `toolCalls` vazio, encerrava com
  `{:ok, ctx}`, e o DevAgent bloqueava a task com "parou sem concluir" — mesmo
  tendo o modelo produzido exatamente o trabalho certo. Foi o que travou a
  primeira execução do critério de aceite dos gates (ADR 0020): o
  `qwen2.5-coder:7b` emitiu, em texto, os três write_file/terminal corretos.

  ## Escopo deliberadamente estreito

  Só recupera objeto JSON cujo `name` é uma ferramenta REALMENTE registrada
  no loop. Sem esse filtro a recuperação vira um risco: um QA real emitiu
  `{"name": "enviar(payload)", "parameters": {...}}` — alucinando uma chamada à
  função de NEGÓCIO que estava revisando. Casar contra o registro de
  ferramentas separa "o modelo quis chamar uma tool" de "o modelo escreveu um
  JSON qualquer", que é a única distinção que importa aqui.

  Com o nome ancorado, `parameters` é aceito como sinônimo de `arguments`
  (variante comum entre modelos). Isto NÃO é um parser de linguagem natural —
  se o modelo só conversou, o resultado é `[]` e o loop encerra como antes.

  Não substitui o protocolo nativo: só é consultado quando `toolCalls` veio
  vazio. Modelo que faz tool call de verdade nunca passa por aqui.
  """

  @doc """
  Extrai tool calls no formato do wire (`%{"name", "arguments", "id"}`) do
  texto de uma mensagem, aceitando só os nomes em `tool_names`. Devolve `[]`
  quando não há nada recuperável.
  """
  def from_content(content, tool_names \\ [])

  def from_content(content, tool_names) when is_binary(content) and is_list(tool_names) do
    content
    |> candidatos()
    |> Enum.flat_map(&decodifica/1)
    |> Enum.map(&normaliza/1)
    |> Enum.filter(&tool_call?(&1, tool_names))
  end

  def from_content(_content, _tool_names), do: []

  # Cada objeto JSON de nível superior do texto. Varre caractere a caractere
  # contando chaves porque o modelo emite tanto um objeto por bloco quanto
  # vários objetos concatenados dentro do MESMO bloco ```json (foi o caso
  # real), e nenhum dos dois é JSON válido como documento único.
  defp candidatos(content) do
    content
    |> String.graphemes()
    |> Enum.reduce({[], nil, 0, false, false}, &varre/2)
    |> then(fn {acc, _atual, _prof, _str, _esc} -> Enum.reverse(acc) end)
  end

  # Dentro de string JSON: nada de contar chaves, e escape suspende a leitura
  # do próximo caractere.
  defp varre(char, {acc, atual, prof, true, true}),
    do: {acc, acumula(atual, char), prof, true, false}

  defp varre("\\", {acc, atual, prof, true, false}),
    do: {acc, acumula(atual, "\\"), prof, true, true}

  defp varre("\"", {acc, atual, prof, true, false}),
    do: {acc, acumula(atual, "\""), prof, false, false}

  defp varre(char, {acc, atual, prof, true, false}),
    do: {acc, acumula(atual, char), prof, true, false}

  defp varre("\"", {acc, atual, prof, false, _esc}) when prof > 0,
    do: {acc, acumula(atual, "\""), prof, true, false}

  defp varre("{", {acc, atual, prof, false, _esc}),
    do: {acc, acumula(atual, "{"), prof + 1, false, false}

  defp varre("}", {acc, atual, 1, false, _esc}) do
    completo = acumula(atual, "}")
    {[IO.iodata_to_binary(completo) | acc], nil, 0, false, false}
  end

  defp varre("}", {acc, atual, prof, false, _esc}) when prof > 1,
    do: {acc, acumula(atual, "}"), prof - 1, false, false}

  defp varre(char, {acc, atual, prof, false, _esc}) when prof > 0,
    do: {acc, acumula(atual, char), prof, false, false}

  # Fora de qualquer objeto (cercas de código, prosa): descarta.
  defp varre(_char, {acc, _atual, 0, false, _esc}), do: {acc, nil, 0, false, false}

  defp acumula(nil, char), do: [char]
  defp acumula(atual, char), do: [atual, char]

  defp decodifica(json) do
    case Jason.decode(json) do
      {:ok, %{} = mapa} -> [mapa]
      _ -> []
    end
  end

  defp tool_call?(%{"name" => name, "arguments" => args}, tool_names)
       when is_binary(name) and is_map(args),
       do: name in tool_names

  defp tool_call?(_outro, _tool_names), do: false

  # `id` existe pro `toolCallId` da mensagem de resultado; o modelo que
  # escreveu em texto não gerou nenhum, então o loop segue com nil (mesmo
  # caminho de um provider que não devolve id).
  defp normaliza(%{"name" => name} = objeto) when is_binary(name) do
    %{"name" => name, "arguments" => argumentos(objeto), "id" => nil}
  end

  defp normaliza(outro), do: outro

  defp argumentos(%{"arguments" => args}) when is_map(args), do: args
  defp argumentos(%{"parameters" => args}) when is_map(args), do: args
  defp argumentos(_objeto), do: nil
end
