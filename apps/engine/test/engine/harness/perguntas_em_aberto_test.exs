defmodule Engine.Harness.PerguntasEmAbertoTest do
  # ADR 0214 (RN-862): a pergunta em aberto do lado do engine — a ferramenta,
  # a frase central, o veredito novo do QA, a régua do recorte e as decisões
  # do usuário no contexto de quem trabalha.
  use ExUnit.Case, async: false

  alias Engine.Dev.ContextBuilder
  alias Engine.Gates.{QaLead, RecorteDaTarefa}
  alias Engine.Gates.Tools.EmitQaVerdict
  alias Engine.Harness.FluxoDoTime
  alias Engine.Harness.Tools.DeclareOpenQuestion
  alias Engine.Sessions.FakeEngineApiClient

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
    end)

    %{ctx: %{project_id: "p-1", session_id: "s-1", agent: "po"}}
  end

  describe "declare_open_question" do
    test "válida grava artifact.open_question com questionId, autor e sessão", %{ctx: ctx} do
      assert {:ok, msg} =
               DeclareOpenQuestion.run(
                 %{
                   "pergunta" => "O limite é por usuário?",
                   "sugestao" => "Sim",
                   "afeta" => %{"historias" => ["st-1"]}
                 },
                 ctx
               )

      assert msg =~ "pergunta em aberto registrada"

      assert_received {:event_appended, "p-1", "s-1",
                       %{type: "artifact.open_question", actorId: "po", payload: payload}}

      assert {:ok, _} = Ecto.UUID.cast(payload["questionId"])
      assert payload["autor"] == "po"
      assert payload["sessionId"] == "s-1"
      assert payload["sugestao"] == "Sim"
      assert payload["afeta"] == %{"regras" => [], "historias" => ["st-1"], "tarefas" => []}
    end

    test "inválida é recusa nomeada e não grava nada", %{ctx: ctx} do
      assert {:error, m1} = DeclareOpenQuestion.run(%{"pergunta" => " ", "afeta" => %{}}, ctx)
      assert m1 =~ "`pergunta` vazia"

      assert {:error, m2} =
               DeclareOpenQuestion.run(%{"pergunta" => "x", "afeta" => %{"telas" => []}}, ctx)

      assert m2 =~ "regras, historias e tarefas"

      assert {:error, m3} =
               DeclareOpenQuestion.run(
                 %{"pergunta" => String.duplicate("a", 501), "afeta" => %{}},
                 ctx
               )

      assert m3 =~ "500"
      refute_received {:event_appended, _, _, _}
    end

    test "a descrição não nomeia idioma (RN-667)" do
      refute DeclareOpenQuestion.spec().description =~ ~r/pt-BR|português|inglês/i
    end
  end

  test "o fecho do turno conta a pergunta em aberto gravada" do
    Engine.Agents.GravadoNoTurno.anotar("declare_open_question", %{}, {:ok, "ok"})
    assert Engine.Agents.GravadoNoTurno.descarregar("pt-BR") =~ "1 pergunta em aberto"
  end

  test "a frase central vai só aos quatro que têm a ferramenta" do
    for agente <- ~w(criativo po arquiteto dev-lead) do
      assert FluxoDoTime.texto(agente) =~ "`declare_open_question`"
    end

    refute FluxoDoTime.texto("infra") =~ "declare_open_question"
  end

  describe "QA" do
    test "emit_qa_verdict aceita needs_user_decision com pergunta e recusa sem ela" do
      assert {:ok, _} =
               EmitQaVerdict.run(%{"veredito" => "needs_user_decision", "pergunta" => "5?"}, %{})

      assert {:error, msg} = EmitQaVerdict.run(%{"veredito" => "needs_user_decision"}, %{})
      assert msg =~ "exige `pergunta`"
    end

    test "consolidação: needs_user_decision vence approved" do
      decisao = %{pergunta: "5?", sugestao: "sim", open_question_id: nil}

      assert {:ok, %{veredito: "needs_user_decision", decisao_do_usuario: ^decisao}} =
               QaLead.consolidar([
                 {"A", {:ok, %{veredito: "approved", resumo: "", itens: []}}},
                 {"B",
                  {:ok,
                   %{
                     veredito: "needs_user_decision",
                     resumo: "não confirmado",
                     itens: [],
                     decisao_do_usuario: decisao
                   }}}
               ])
    end

    test "o recorte diz a régua e, com decisões, as mostra" do
      sem = RecorteDaTarefa.texto(%{task: %{"title" => "T"}})
      assert sem =~ "não confirmado pelo usuário"
      assert sem =~ "nunca `changes_requested`"
      refute sem =~ "Decisões do usuário"

      com =
        RecorteDaTarefa.texto(%{
          task: %{"title" => "T"},
          decisoes: [%{"pergunta" => "Limite?", "decisao" => "10", "questionId" => nil}]
        })

      assert com =~ "Decisões do usuário — vencem RF/DoR quando conflitam"
      assert com =~ "- Limite? → 10"
    end
  end

  test "ContextBuilder: a história leva as decisões; sem decisões, nada" do
    base = %{
      "task" => %{"id" => "t", "title" => "t", "description" => ""},
      "story" => %{"title" => "s", "description" => ""}
    }

    Process.put(
      :fake_dev_context,
      Map.put(base, "decisoes", [%{"context" => "Q", "choice" => "R"}])
    )

    {:ok, com} = ContextBuilder.fetch("p", "s", "t")
    story = Enum.find(com.task_state_units, &(&1.id == :story))
    assert story.content =~ "Decisões do usuário — vencem RF/DoR quando conflitam:\n- Q → R"

    Process.put(:fake_dev_context, base)
    {:ok, sem} = ContextBuilder.fetch("p", "s", "t")
    refute Enum.find(sem.task_state_units, &(&1.id == :story)).content =~ "Decisões do usuário"
  end
end
