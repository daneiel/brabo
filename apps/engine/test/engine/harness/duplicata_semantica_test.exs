defmodule Engine.Harness.DuplicataSemanticaTest do
  @moduledoc """
  RN-681 (AT-171, ADR 0198): a duplicata SEMÂNTICA de regra e de história
  AVISA, e o aviso volta ao modelo como parte do resultado da ferramenta. Quem
  compara é a api (embedding + limiar); aqui se prova o lado do engine — a
  frase chega, a checagem que falha não derruba a emissão, e só `business_rule`
  e `create_story` passam por ela.
  """

  use Engine.DataCase, async: false

  alias Engine.Harness.Tools.{CreateStory, EmitArtifact}
  alias Engine.Sessions.FakeEngineApiClient

  @aviso "AVISO (não é recusa): esta regra de negócio parece duplicar \"Saudação determinística\""

  setup do
    project_id = Ecto.UUID.generate()
    session_id = Ecto.UUID.generate()

    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
    end)

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

    %{ctx: %{project_id: project_id, session_id: session_id, agent: "criativo"}}
  end

  defp regra(titulo) do
    %{
      "type" => "business_rule",
      "payload" => %{"title" => titulo, "description" => "d", "origin" => [1]}
    }
  end

  defp historia do
    %{"epic_id" => "ep-1", "title" => "GET /hello", "business_rule_ids" => ["r1"]}
  end

  describe "emit_artifact de business_rule" do
    test "grava a regra e DEPOIS pede a checagem, com o título", %{ctx: ctx} do
      assert {:ok, _} = EmitArtifact.run(regra("GET /hello devolve saudação"), ctx)

      assert_received {:event_appended, _p, _s, %{type: "artifact.business_rule"}}

      assert_received {:semantic_duplicate_checked,
                       %{kind: "business_rule", title: "GET /hello devolve saudação"}}
    end

    test "o aviso volta ao modelo no resultado — e a emissão continua :ok", %{ctx: ctx} do
      Process.put(:fake_semantic_duplicate, %{"status" => "warned", "message" => @aviso})

      assert {:ok, texto} = EmitArtifact.run(regra("GET /hello devolve saudação"), ctx)

      assert texto =~ "artefato business_rule emitido"
      assert texto =~ @aviso
    end

    test "checagem PULADA também é dita ao modelo", %{ctx: ctx} do
      Process.put(:fake_semantic_duplicate, %{
        "status" => "skipped",
        "message" => "A checagem de duplicata semântica foi PULADA: sem provider."
      })

      assert {:ok, texto} = EmitArtifact.run(regra("Outra regra"), ctx)
      assert texto =~ "PULADA"
    end

    test "sem frase (nada a comparar) o resultado é o de sempre", %{ctx: ctx} do
      assert {:ok, "artefato business_rule emitido"} = EmitArtifact.run(regra("Primeira"), ctx)
    end

    test "a api que não responde NÃO derruba a emissão — e isso é dito", %{ctx: ctx} do
      Process.put(:fake_semantic_duplicate, {:error, :timeout})

      assert {:ok, texto} = EmitArtifact.run(regra("Regra com api lenta"), ctx)
      assert_received {:event_appended, _p, _s, %{type: "artifact.business_rule"}}
      assert texto =~ "não respondeu"
    end

    test "regra recusada por duplicata EXATA (RN-080) não chega à checagem", %{ctx: ctx} do
      Engine.Repo.insert_all("session_events", [
        %{
          id: "evt-#{System.unique_integer([:positive])}",
          session_id: Ecto.UUID.dump!(ctx.session_id),
          seq: System.unique_integer([:positive, :monotonic]),
          type: "artifact.business_rule",
          actor_kind: "agent",
          actor_id: "criativo",
          payload: %{"title" => "Saudação com nome", "description" => "d", "origin" => [1]},
          created_at: DateTime.utc_now() |> DateTime.truncate(:second)
        }
      ])

      assert {:error, _} = EmitArtifact.run(regra("Saudação com nome"), ctx)
      refute_received {:semantic_duplicate_checked, _}
    end

    test "nota não passa pela checagem", %{ctx: ctx} do
      nota = %{"type" => "note", "payload" => %{"title" => "t", "body" => "b"}}

      assert {:ok, _} = EmitArtifact.run(nota, ctx)
      refute_received {:semantic_duplicate_checked, _}
    end
  end

  describe "create_story" do
    test "a frase que a api devolve em semanticDuplicate chega ao modelo", %{ctx: ctx} do
      Process.put(:fake_story, %{
        "id" => "st-1",
        "status" => "ready",
        "semanticDuplicate" => %{"status" => "warned", "message" => "AVISO (não é recusa): ..."}
      })

      assert {:ok, texto} = CreateStory.run(historia(), ctx)
      assert texto =~ "história criada: id=st-1"
      assert texto =~ "AVISO (não é recusa)"
    end

    test "corpo sem o campo (api anterior) não muda o resultado", %{ctx: ctx} do
      Process.put(:fake_story, %{"id" => "st-2", "status" => "ready"})

      assert {:ok, "história criada: id=st-2, status=ready."} = CreateStory.run(historia(), ctx)
    end
  end
end
