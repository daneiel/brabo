defmodule Engine.Harness.DecisoesDoProjetoTest do
  @moduledoc "RN-874 (AT-526): o turno do PO leva as decisões e as perguntas abertas do projeto."
  use Engine.DataCase, async: false

  alias Engine.Harness.DecisoesDoProjeto

  setup do
    project_id = Ecto.UUID.generate()
    session_id = Ecto.UUID.generate()
    agora = DateTime.utc_now() |> DateTime.truncate(:second)

    Engine.Repo.insert_all("projects", [
      %{
        id: Ecto.UUID.dump!(project_id),
        name: "cobaia",
        slug: "cobaia-#{System.unique_integer([:positive])}",
        created_at: agora,
        updated_at: agora
      }
    ])

    Engine.Repo.insert_all("sessions", [
      %{
        id: Ecto.UUID.dump!(session_id),
        project_id: Ecto.UUID.dump!(project_id),
        created_at: agora
      }
    ])

    %{project_id: project_id, session_id: session_id}
  end

  defp evento!(session_id, seq, type, payload) do
    Engine.Repo.insert_all("session_events", [
      %{
        id: "evt-#{System.unique_integer([:positive])}",
        session_id: Ecto.UUID.dump!(session_id),
        seq: seq,
        type: type,
        actor_kind: "agent",
        actor_id: "criativo",
        payload: payload,
        created_at: DateTime.add(DateTime.utc_now(), seq, :millisecond)
      }
    ])
  end

  @msgs [%{"role" => "user", "content" => "oi"}]

  test "o turno do PO leva a decisão e só a pergunta AINDA aberta", %{
    project_id: p,
    session_id: s
  } do
    evento!(s, 1, "artifact.open_question", %{"questionId" => "q-1", "pergunta" => "404?"})
    evento!(s, 2, "open_question.answered", %{"questionId" => "q-1", "resposta" => "sim"})
    evento!(s, 3, "artifact.decision_record", %{"choice" => "responde 404", "context" => "q-1"})
    evento!(s, 4, "artifact.open_question", %{"questionId" => "q-2", "pergunta" => "expira?"})

    [_, %{"role" => "system", "content" => texto}] = DecisoesDoProjeto.anexar(@msgs, p, "po")

    assert texto =~ "responde 404"
    assert texto =~ "questionId=q-2: expira?"
    refute texto =~ "q-1: 404?"
    assert texto =~ "nunca escreva \"pergunta em aberto N\""
  end

  test "custo de entrada tem teto", %{project_id: p, session_id: s} do
    for i <- 1..30 do
      evento!(s, i, "artifact.decision_record", %{
        "choice" => String.duplicate("x", 1000),
        "context" => "c"
      })
    end

    [_, %{"content" => texto}] = DecisoesDoProjeto.anexar(@msgs, p, "po")
    assert String.length(texto) <= DecisoesDoProjeto.teto_de_caracteres()
  end

  test "sem decisões nem perguntas não acrescenta nada", %{project_id: p} do
    assert DecisoesDoProjeto.anexar(@msgs, p, "po") == @msgs
  end

  test "outro agente não recebe", %{project_id: p, session_id: s} do
    evento!(s, 1, "artifact.decision_record", %{"choice" => "a", "context" => "b"})
    assert DecisoesDoProjeto.anexar(@msgs, p, "arquiteto") == @msgs
  end

  test "leitura que falha deixa o turno sem a mensagem, sem queda" do
    assert DecisoesDoProjeto.anexar(@msgs, "nao-e-uuid", "po") == @msgs
  end
end
