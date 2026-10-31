defmodule Engine.SessionEvents.EventWindowTest do
  @moduledoc """
  A janela por projeto (Fase 4b — Anamnese) não tinha teste nenhum, e foi
  justamente ali que morava o defeito mais escondido desta fase: `created_at`
  estava declarado `:utc_datetime` (precisão de SEGUNDO) contra uma coluna
  `timestamptz(6)`, então o Ecto TRUNCAVA o `window_to` na comparação e
  descartava tudo que tinha acontecido no segundo corrente.

  Consequência: uma rodada disparada logo depois da atividade via janela VAZIA,
  era pulada por triagem e não narrava nada — invisível.
  """

  use Engine.DataCase, async: false

  alias Engine.SessionEvents.Event

  setup do
    project_id = Ecto.UUID.generate()
    session_id = Ecto.UUID.generate()

    Engine.Repo.insert_all("projects", [
      %{
        id: Ecto.UUID.dump!(project_id),
        name: "cobaia",
        slug: "cobaia-#{System.unique_integer([:positive])}",
        created_at: DateTime.utc_now() |> DateTime.truncate(:second),
        updated_at: DateTime.utc_now() |> DateTime.truncate(:second)
      }
    ])

    Engine.Repo.insert_all("sessions", [
      %{
        id: Ecto.UUID.dump!(session_id),
        project_id: Ecto.UUID.dump!(project_id),
        created_at: DateTime.utc_now() |> DateTime.truncate(:second)
      }
    ])

    %{project_id: project_id, session_id: session_id}
  end

  defp insere_evento!(session_id, created_at, seq, opts \\ []) do
    Engine.Repo.insert_all("session_events", [
      %{
        id: "evt-#{System.unique_integer([:positive])}",
        session_id: Ecto.UUID.dump!(session_id),
        seq: seq,
        type: Keyword.get(opts, :type, "chat.message"),
        actor_kind: Keyword.get(opts, :actor_kind, "user"),
        actor_id: Keyword.get(opts, :actor_id, "user-1"),
        payload: %{},
        created_at: created_at
      }
    ])
  end

  test "evento do segundo CORRENTE entra na janela", %{
    project_id: project_id,
    session_id: session_id
  } do
    agora = DateTime.utc_now()
    # Mesmo segundo do fim da janela, mas alguns centésimos antes — é o caso
    # real de uma rodada disparada na sequência da atividade.
    insere_evento!(session_id, DateTime.add(agora, -300, :millisecond), 1)

    de = DateTime.add(agora, -3600, :second)

    assert Event.count_for_project_window(project_id, de, agora) == 1
    assert length(Event.list_for_project_window(project_id, de, agora)) == 1
  end

  test "microssegundo é respeitado nas duas pontas da janela", %{
    project_id: project_id,
    session_id: session_id
  } do
    base = DateTime.utc_now()
    evento_em = DateTime.add(base, -500, :millisecond)
    insere_evento!(session_id, evento_em, 1)

    # `to` exclusivo: exatamente no instante do evento, ele fica FORA.
    assert Event.count_for_project_window(
             project_id,
             DateTime.add(base, -3600, :second),
             evento_em
           ) == 0

    # Um microssegundo depois, entra.
    assert Event.count_for_project_window(
             project_id,
             DateTime.add(base, -3600, :second),
             DateTime.add(evento_em, 1, :microsecond)
           ) == 1
  end

  test "só conta evento do PROJETO pedido", %{
    project_id: project_id,
    session_id: session_id
  } do
    insere_evento!(session_id, DateTime.utc_now(), 1)

    de = DateTime.add(DateTime.utc_now(), -3600, :second)
    ate = DateTime.add(DateTime.utc_now(), 60, :second)

    assert Event.count_for_project_window(project_id, de, ate) == 1
    assert Event.count_for_project_window(Ecto.UUID.generate(), de, ate) == 0
  end

  test "o recorte pega a CAUDA da janela, em ordem cronológica", %{
    project_id: project_id,
    session_id: session_id
  } do
    agora = DateTime.utc_now()

    for i <- 1..5 do
      insere_evento!(session_id, DateTime.add(agora, -1000 * (6 - i), :millisecond), i)
    end

    de = DateTime.add(agora, -3600, :second)
    recorte = Event.list_for_project_window(project_id, de, agora, 2)

    # Os 2 mais recentes (seq 4 e 5), devolvidos em ordem crescente.
    assert Enum.map(recorte, & &1.seq) == [4, 5]
  end

  describe "o que a própria Anamnese e o sistema escrevem fica fora (RN-722)" do
    test "anamnese.*, ator anamnese e sistema não contam; a interação da pessoa conta", %{
      project_id: project_id,
      session_id: session_id
    } do
      agora = DateTime.utc_now()
      t = DateTime.add(agora, -60, :second)
      anam = [actor_kind: "agent", actor_id: "anamnese"]

      insere_evento!(session_id, t, 1, [type: "anamnese.analysis"] ++ anam)
      insere_evento!(session_id, t, 2, [type: "tool.call"] ++ anam)
      insere_evento!(session_id, t, 3, [type: "agent.status"] ++ anam)

      insere_evento!(session_id, t, 4,
        type: "session.created",
        actor_kind: "system",
        actor_id: "system"
      )

      insere_evento!(session_id, t, 5)

      insere_evento!(session_id, t, 6,
        type: "agent.response",
        actor_kind: "agent",
        actor_id: "po"
      )

      de = DateTime.add(agora, -3600, :second)

      assert Event.count_for_project_window(project_id, de, agora) == 2

      assert project_id
             |> Event.list_for_project_window(de, agora)
             |> Enum.map(& &1.seq)
             |> Enum.sort() == [5, 6]
    end

    test "dez eventos da Anamnese sozinhos não passam a triagem", %{
      project_id: project_id,
      session_id: session_id
    } do
      agora = DateTime.utc_now()
      t = DateTime.add(agora, -60, :second)

      for seq <- 1..12 do
        insere_evento!(session_id, t, seq,
          type: "anamnese.run_skipped",
          actor_kind: "agent",
          actor_id: "anamnese"
        )
      end

      de = DateTime.add(agora, -3600, :second)
      total = Event.count_for_project_window(project_id, de, agora)
      assert total == 0
      refute Engine.Anamnese.Triage.should_run?(total, 0, 0)
    end
  end
end
