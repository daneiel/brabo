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

  defp insere_evento!(session_id, created_at, seq) do
    Engine.Repo.insert_all("session_events", [
      %{
        id: "evt-#{System.unique_integer([:positive])}",
        session_id: Ecto.UUID.dump!(session_id),
        seq: seq,
        type: "chat.message",
        actor_kind: "user",
        actor_id: "user-1",
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
end
