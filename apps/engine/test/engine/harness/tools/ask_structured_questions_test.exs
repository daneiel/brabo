defmodule Engine.Harness.Tools.AskStructuredQuestionsTest do
  @moduledoc """
  RN-162: `ask_structured_questions` grava `chat.structured_question` com a
  lista de perguntas normalizada — mesmo padrão de `emit_insight` (`:direct`,
  sem pipeline), com validação PRÓPRIA (não passa pelo `ArtifactSchemas`,
  porque não é um artefato: é uma pergunta).
  """

  use ExUnit.Case, async: false

  alias Engine.Harness.Tools.AskStructuredQuestions

  setup do
    Application.put_env(:engine, :engine_api_client, Engine.Sessions.FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn -> Application.delete_env(:engine, :test_pid) end)

    %{ctx: %{project_id: "p1", session_id: "s1", agent: "criativo"}}
  end

  test "registra chat.structured_question com as perguntas normalizadas", %{ctx: ctx} do
    questions = [
      %{"id" => "nome", "label" => "Qual o nome do produto?"},
      %{"id" => "usuarios", "label" => "Quem são os usuários?", "type" => "textarea"},
      %{
        "id" => "plataforma",
        "label" => "Qual plataforma?",
        "type" => "select",
        "options" => ["Web", "Mobile", "Ambos"]
      }
    ]

    assert {:ok, texto} = AskStructuredQuestions.run(%{"questions" => questions}, ctx)
    assert texto =~ "3 pergunta"

    assert_received {:event_appended, "p1", "s1",
                     %{type: "chat.structured_question", actorId: "criativo", payload: payload}}

    assert payload.questions == [
             %{
               id: "nome",
               label: "Qual o nome do produto?",
               type: "text",
               options: [],
               allowOther: false
             },
             %{
               id: "usuarios",
               label: "Quem são os usuários?",
               type: "textarea",
               options: [],
               allowOther: false
             },
             %{
               id: "plataforma",
               label: "Qual plataforma?",
               type: "select",
               options: ["Web", "Mobile", "Ambos"],
               allowOther: true
             }
           ]
  end

  # RN-171: a saída por texto livre do `select` é o DEFAULT. O uso real
  # encontrou o usuário preso numa lista fechada por esquecimento do modelo —
  # e uma lista fechada por engano não tem como ser destravada de fora.
  test "select sem `allowOther` nasce ABERTO (default true)", %{ctx: ctx} do
    questions = [%{"id" => "a", "label" => "A?", "type" => "select", "options" => ["x"]}]

    assert {:ok, _} = AskStructuredQuestions.run(%{"questions" => questions}, ctx)
    assert_received {:event_appended, _, _, %{payload: %{questions: [%{allowOther: true}]}}}
  end

  test "select com `allowOther: false` fecha a lista — é a declaração deliberada", %{ctx: ctx} do
    questions = [
      %{
        "id" => "a",
        "label" => "A?",
        "type" => "select",
        "options" => ["Sim", "Não"],
        "allowOther" => false
      }
    ]

    assert {:ok, _} = AskStructuredQuestions.run(%{"questions" => questions}, ctx)
    assert_received {:event_appended, _, _, %{payload: %{questions: [%{allowOther: false}]}}}
  end

  test "`allowOther` em text/textarea é sempre false — o campo já é texto livre", %{ctx: ctx} do
    questions = [%{"id" => "a", "label" => "A?", "type" => "text", "allowOther" => true}]

    assert {:ok, _} = AskStructuredQuestions.run(%{"questions" => questions}, ctx)
    assert_received {:event_appended, _, _, %{payload: %{questions: [%{allowOther: false}]}}}
  end

  test "`allowOther` não booleano é recusado", %{ctx: ctx} do
    questions = [
      %{
        "id" => "a",
        "label" => "A?",
        "type" => "select",
        "options" => ["x"],
        "allowOther" => "sim"
      }
    ]

    assert {:error, texto} = AskStructuredQuestions.run(%{"questions" => questions}, ctx)
    assert texto =~ "allowOther"
  end

  test "type default é text quando omitido", %{ctx: ctx} do
    assert {:ok, _} =
             AskStructuredQuestions.run(
               %{"questions" => [%{"id" => "a", "label" => "A?"}]},
               ctx
             )

    assert_received {:event_appended, _, _, %{payload: %{questions: [%{type: "text"}]}}}
  end

  test "sem `questions`, recusa dizendo o que falta", %{ctx: ctx} do
    assert {:error, texto} = AskStructuredQuestions.run(%{}, ctx)
    assert texto =~ "exige `questions`"
  end

  test "`questions` vazia é recusada", %{ctx: ctx} do
    assert {:error, texto} = AskStructuredQuestions.run(%{"questions" => []}, ctx)
    assert texto =~ "ao menos uma pergunta"
  end

  test "pergunta sem `id` é recusada", %{ctx: ctx} do
    assert {:error, texto} =
             AskStructuredQuestions.run(%{"questions" => [%{"label" => "sem id"}]}, ctx)

    assert texto =~ "id"
  end

  test "`id` duplicado entre perguntas é recusado", %{ctx: ctx} do
    questions = [
      %{"id" => "x", "label" => "Primeira?"},
      %{"id" => "x", "label" => "Segunda?"}
    ]

    assert {:error, texto} = AskStructuredQuestions.run(%{"questions" => questions}, ctx)
    assert texto =~ "únicos"
  end

  test "pergunta sem `label` é recusada", %{ctx: ctx} do
    assert {:error, texto} =
             AskStructuredQuestions.run(%{"questions" => [%{"id" => "a"}]}, ctx)

    assert texto =~ "label"
  end

  test "`type` fora do enum é recusado", %{ctx: ctx} do
    questions = [%{"id" => "a", "label" => "A?", "type" => "checkbox"}]

    assert {:error, texto} = AskStructuredQuestions.run(%{"questions" => questions}, ctx)
    assert texto =~ "text, textarea, select"
  end

  test "`type: select` sem `options` é recusado", %{ctx: ctx} do
    questions = [%{"id" => "a", "label" => "A?", "type" => "select"}]

    assert {:error, texto} = AskStructuredQuestions.run(%{"questions" => questions}, ctx)
    assert texto =~ "options"
  end

  test "`type: select` com `options` vazia é recusado", %{ctx: ctx} do
    questions = [%{"id" => "a", "label" => "A?", "type" => "select", "options" => []}]

    assert {:error, texto} = AskStructuredQuestions.run(%{"questions" => questions}, ctx)
    assert texto =~ "options"
  end

  test "erro da api vira tool-result de erro", %{ctx: ctx} do
    Process.put(:fake_append_event_error, :timeout)

    assert {:error, texto} =
             AskStructuredQuestions.run(
               %{"questions" => [%{"id" => "a", "label" => "A?"}]},
               ctx
             )

    assert texto =~ "falha ao registrar perguntas"
  end
end
