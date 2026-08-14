defmodule Engine.Harness.Tools.AskStructuredQuestions do
  @moduledoc """
  Ferramenta do Criativo (RN-162): quando ele faz VÁRIAS perguntas na mesma
  resposta (ex.: "1. Qual o nome do produto? 2. Quem são os usuários? 3. Que
  problema resolve?"), o modelo pode emitir a lista em formato ESTRUTURADO em
  vez de deixar o usuário digitar tudo numa mensagem de texto livre,
  respondendo item por item à mão.

  `session_event` `chat.structured_question`, com `payload.questions`.
  `:direct` — não é efeito externo (git, terminal, gasto), é uma PERGUNTA;
  não passa pelo pipeline de `proposed_action`.

  O frontend renderiza um formulário com um campo por pergunta (`type` decide
  o input: `text`→campo curto, `textarea`→campo longo, `select`→lista de
  `options`) e devolve as respostas concatenadas como `chat.message` — o
  Criativo as lê no próximo turno como uma mensagem normal do usuário. Este
  tool não espera resposta síncrona nenhuma: `run/2` só registra a pergunta.

  RN-171 — `select` tem SAÍDA por texto livre (`allowOther`), e o default dela
  é `true`. O uso real encontrou o usuário preso: o modelo ofereceu uma opção
  do tipo "Escreva você mesmo" e o formulário não tinha onde escrever, porque
  o schema não sabia dizer "além destas, o que você quiser". A escapatória ser
  o DEFAULT (e fechá-la exigir `allowOther: false` explícito) é deliberada:
  uma lista de opções fechada por ESQUECIMENTO trava a conversa inteira, e o
  usuário não tem como destravá-la; uma lista aberta por engano só oferece um
  campo a mais. Só a lista genuinamente fechada — "Sim/Não" — declara `false`.
  """

  @behaviour Engine.Harness.Tool

  alias Engine.Sessions.EngineApiClient

  @tipos_validos ["text", "textarea", "select"]

  @impl true
  def spec do
    %{
      name: "ask_structured_questions",
      description: descricao(),
      parameters: %{
        "type" => "object",
        "properties" => %{
          "questions" => %{
            "type" => "array",
            "items" => %{
              "type" => "object",
              "properties" => %{
                "id" => %{"type" => "string"},
                "label" => %{"type" => "string"},
                "type" => %{"type" => "string", "enum" => @tipos_validos},
                "options" => %{"type" => "array", "items" => %{"type" => "string"}},
                "allowOther" => %{"type" => "boolean"}
              },
              "required" => ["id", "label"]
            }
          }
        },
        "required" => ["questions"]
      }
    }
  end

  @impl true
  def category, do: :direct

  @impl true
  def run(%{"questions" => questions}, ctx) when is_list(questions) and questions != [] do
    case validar(questions) do
      :ok ->
        event = %{
          type: "chat.structured_question",
          actorKind: "agent",
          actorId: ctx.agent,
          payload: %{questions: normalizar(questions)}
        }

        case EngineApiClient.append_event(ctx.project_id, ctx.session_id, event) do
          :ok ->
            {:ok, "#{length(questions)} pergunta(s) estruturada(s) enviada(s) ao usuário"}

          {:error, reason} ->
            {:error, "falha ao registrar perguntas: #{inspect(reason)}"}
        end

      {:error, motivo} ->
        {:error, motivo}
    end
  end

  def run(%{"questions" => []}, _ctx),
    do: {:error, "ask_structured_questions exige ao menos uma pergunta em `questions`"}

  def run(_args, _ctx),
    do: {:error, "ask_structured_questions exige `questions` (lista não-vazia)"}

  # --- Validação ---

  defp validar(questions) do
    cond do
      Enum.any?(questions, &(not is_map(&1))) ->
        {:error, "cada pergunta precisa ser um objeto com `id` e `label`"}

      motivo = id_invalido(questions) ->
        motivo

      motivo = label_invalido(questions) ->
        motivo

      Enum.any?(questions, &tipo_invalido?/1) ->
        {:error, "`type` precisa ser um de: #{Enum.join(@tipos_validos, ", ")}"}

      Enum.any?(questions, &select_sem_options?/1) ->
        {:error, "pergunta `type: \"select\"` exige `options` (lista não vazia de strings)"}

      Enum.any?(questions, &allow_other_invalido?/1) ->
        {:error, "`allowOther` precisa ser booleano (true/false)"}

      true ->
        :ok
    end
  end

  defp id_invalido(questions) do
    ids = Enum.map(questions, &Map.get(&1, "id"))

    cond do
      Enum.any?(ids, &(not is_binary(&1) or &1 == "")) ->
        {:error, "toda pergunta exige `id` (string não vazia)"}

      Enum.uniq(ids) != ids ->
        {:error, "os `id` das perguntas precisam ser únicos"}

      true ->
        nil
    end
  end

  defp label_invalido(questions) do
    if Enum.any?(questions, fn q ->
         label = Map.get(q, "label")
         not is_binary(label) or label == ""
       end) do
      {:error, "toda pergunta exige `label` (string não vazia)"}
    end
  end

  defp tipo_invalido?(q) do
    case Map.get(q, "type") do
      nil -> false
      tipo -> tipo not in @tipos_validos
    end
  end

  defp select_sem_options?(q) do
    Map.get(q, "type") == "select" and
      (not is_list(Map.get(q, "options")) or
         Map.get(q, "options") == [] or
         not Enum.all?(Map.get(q, "options"), &is_binary/1))
  end

  defp allow_other_invalido?(q) do
    case Map.get(q, "allowOther") do
      nil -> false
      valor -> not is_boolean(valor)
    end
  end

  defp normalizar(questions) do
    Enum.map(questions, fn q ->
      tipo = Map.get(q, "type", "text")

      %{
        id: Map.fetch!(q, "id"),
        label: Map.fetch!(q, "label"),
        type: tipo,
        options: Map.get(q, "options", []),
        # RN-171: só `select` tem o que escapar — em `text`/`textarea` o campo
        # JÁ é texto livre, e gravar `allowOther: true` neles seria estado
        # sem significado no event log. Em `select`, ausente vale TRUE.
        allowOther: tipo == "select" and Map.get(q, "allowOther", true)
      }
    end)
  end

  defp descricao do
    """
    Emite um conjunto de perguntas ESTRUTURADAS pro usuário responder de uma
    vez só, num formulário — em vez de texto livre que ele teria que
    responder item por item. Use quando for pedir VÁRIAS coisas na mesma
    resposta (ex.: nome do produto, público-alvo, problema que resolve).

    `questions` é uma lista de objetos com:
    - `id` (string, único dentro da lista) — identifica a pergunta na resposta
    - `label` (string) — o texto da pergunta, em pt-BR
    - `type` (opcional, default "text") — "text" (campo curto), "textarea"
      (campo longo) ou "select" (lista de opções)
    - `options` (lista de strings) — OBRIGATÓRIO quando `type` é "select"
    - `allowOther` (booleano, opcional, default TRUE em "select") — o usuário
      pode escrever uma resposta fora da lista. NÃO crie uma opção do tipo
      "Outro"/"Escreva você mesmo" dentro de `options`: o formulário já
      oferece o campo de texto livre sozinho. Só declare `allowOther: false`
      quando a lista for genuinamente fechada (ex.: "Sim"/"Não").

    Exemplo de chamada válida:
    {"questions": [
      {"id": "nome", "label": "Qual o nome do produto?", "type": "text"},
      {"id": "usuarios", "label": "Quem são os usuários?", "type": "textarea"},
      {"id": "plataforma", "label": "Qual plataforma?", "type": "select",
       "options": ["Web", "Mobile", "Ambos"]},
      {"id": "cobranca", "label": "Vai cobrar?", "type": "select",
       "options": ["Sim", "Não"], "allowOther": false}
    ]}

    As respostas voltam como uma mensagem normal do usuário, num próximo
    turno — esta chamada só confirma que as perguntas foram enviadas.
    """
  end
end
