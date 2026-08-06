defmodule Engine.Harness.EmitArtifactDedupeTest do
  @moduledoc """
  Achado K: rodar o Criativo duas vezes no mesmo projeto deixou 10 regras,
  5 delas órfãs. Não havia dedupe nem aviso.

  A recusa acontece na ENTRADA porque não há outro lugar: `artifact.*` é
  evento de domínio, e evento de domínio não é apagado nem editado.
  """

  use Engine.DataCase, async: false

  alias Engine.Harness.Tools.EmitArtifact
  alias Engine.Sessions.FakeEngineApiClient

  setup do
    project_id = Ecto.UUID.generate()
    session_id = Ecto.UUID.generate()

    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
    end)

    seed_projeto!(project_id, session_id)

    %{
      project_id: project_id,
      session_id: session_id,
      ctx: %{project_id: project_id, session_id: session_id, agent: "criativo"}
    }
  end

  defp seed_projeto!(project_id, session_id) do
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
  end

  # O append do fake não escreve no banco, então a regra "já existente" é
  # semeada direto — que é também como ela chega numa SEGUNDA sessão.
  defp seed_regra!(session_id, titulo) do
    Engine.Repo.insert_all("session_events", [
      %{
        id: "evt-#{System.unique_integer([:positive])}",
        session_id: Ecto.UUID.dump!(session_id),
        seq: System.unique_integer([:positive, :monotonic]),
        type: "artifact.business_rule",
        actor_kind: "agent",
        actor_id: "criativo",
        payload: %{"title" => titulo, "description" => "d", "origin" => [1]},
        created_at: DateTime.utc_now() |> DateTime.truncate(:second)
      }
    ])
  end

  defp regra(titulo) do
    %{
      "type" => "business_rule",
      "payload" => %{"title" => titulo, "description" => "d", "origin" => [1]}
    }
  end

  test "regra inédita passa", %{ctx: ctx, project_id: pid} do
    assert {:ok, _} = EmitArtifact.run(regra("Saudação com nome"), ctx)
    assert_received {:event_appended, ^pid, _s, %{type: "artifact.business_rule"}}
  end

  test "regra já registrada é recusada, sem gravar evento", %{
    ctx: ctx,
    session_id: session_id
  } do
    seed_regra!(session_id, "Saudação com nome")

    assert {:error, motivo} = EmitArtifact.run(regra("Saudação com nome"), ctx)

    # A mensagem mostra o título COMO FOI GRAVADO — é o que o modelo
    # precisa ler para saber que não deve reemitir.
    assert motivo =~ "Saudação com nome"
    refute_received {:event_appended, _p, _s, _e}
  end

  test "caixa e acento diferentes ainda são a mesma regra", %{
    ctx: ctx,
    session_id: session_id
  } do
    seed_regra!(session_id, "Saudação com nome")

    assert {:error, _} = EmitArtifact.run(regra("SAUDACAO COM NOME"), ctx)
    refute_received {:event_appended, _p, _s, _e}
  end

  test "regra de OUTRO projeto não bloqueia", %{ctx: ctx, project_id: pid} do
    outro_projeto = Ecto.UUID.generate()
    outra_sessao = Ecto.UUID.generate()
    seed_projeto!(outro_projeto, outra_sessao)
    seed_regra!(outra_sessao, "Saudação com nome")

    assert {:ok, _} = EmitArtifact.run(regra("Saudação com nome"), ctx)
    assert_received {:event_appended, ^pid, _s, %{type: "artifact.business_rule"}}
  end

  test "o escopo é o PROJETO, não a sessão — é entre sessões que a duplicata nasce", %{
    ctx: ctx,
    project_id: project_id
  } do
    # A segunda rodada do Criativo abre sessão nova. Uma checagem por
    # sessão não veria a primeira rodada, que é o caso do achado.
    outra_sessao = Ecto.UUID.generate()

    Engine.Repo.insert_all("sessions", [
      %{
        id: Ecto.UUID.dump!(outra_sessao),
        project_id: Ecto.UUID.dump!(project_id),
        created_at: DateTime.utc_now() |> DateTime.truncate(:second)
      }
    ])

    seed_regra!(outra_sessao, "Saudação com nome")

    assert {:error, _} = EmitArtifact.run(regra("Saudação com nome"), ctx)
  end

  test "outros tipos de artefato não são deduplicados", %{ctx: ctx, project_id: pid} do
    # `note` é o outro tipo emissível por ferramenta, e é anotação livre:
    # repetir o título ali é legítimo.
    nota = %{"type" => "note", "payload" => %{"title" => "t", "body" => "b"}}

    assert {:ok, _} = EmitArtifact.run(nota, ctx)
    assert {:ok, _} = EmitArtifact.run(nota, ctx)

    assert_received {:event_appended, ^pid, _s, %{type: "artifact.note"}}
    assert_received {:event_appended, ^pid, _s, %{type: "artifact.note"}}
  end

  test "payload sem título cai no erro de SCHEMA, não no de duplicata", %{ctx: ctx} do
    assert {:error, motivo} =
             EmitArtifact.run(
               %{"type" => "business_rule", "payload" => %{"description" => "d"}},
               ctx
             )

    assert motivo =~ "inválido"
  end
end
