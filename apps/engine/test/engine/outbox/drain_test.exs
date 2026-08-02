defmodule Engine.Outbox.DrainTest do
  use Engine.DataCase, async: true
  use Oban.Testing, repo: Engine.Repo, prefix: "engine"

  alias Engine.Outbox.{Event, Drain}

  defp insert_outbox_event!(attrs) do
    defaults = %{
      id: Ecto.UUID.generate(),
      aggregate_id: Ecto.UUID.generate(),
      payload: %{},
      created_at: DateTime.utc_now(),
      processed_at: nil
    }

    %Event{}
    |> Ecto.Changeset.change(Map.merge(defaults, attrs))
    |> Repo.insert!()
  end

  test "session.created não é mais roteado (só SessionLifecycleWorker por herança do catch-all, sem PsychologistWorker)" do
    row =
      insert_outbox_event!(%{
        aggregate_type: "session",
        event_type: "session.created",
        payload: %{"projectId" => "project-1"}
      })

    Drain.run_once()

    reloaded = Repo.get!(Event, row.id)
    assert reloaded.processed_at != nil

    assert_enqueued(
      worker: Engine.Workers.SessionLifecycleWorker,
      args: %{
        "event_type" => "session.created",
        "aggregate_id" => row.aggregate_id,
        "payload" => %{"projectId" => "project-1"}
      }
    )

    refute_enqueued(worker: Engine.Workers.PsychologistWorker)
  end

  test "session.closed enfileira SessionLifecycleWorker E PsychologistWorker (fan-out)" do
    row =
      insert_outbox_event!(%{
        aggregate_type: "session",
        event_type: "session.closed",
        payload: %{"projectId" => "project-1"}
      })

    Drain.run_once()

    reloaded = Repo.get!(Event, row.id)
    assert reloaded.processed_at != nil

    assert_enqueued(
      worker: Engine.Workers.SessionLifecycleWorker,
      args: %{"aggregate_id" => row.aggregate_id}
    )

    assert_enqueued(
      worker: Engine.Workers.PsychologistWorker,
      args: %{"aggregate_id" => row.aggregate_id}
    )
  end

  test "linha de outro aggregate_type e ignorada (nao processa, nao enfileira)" do
    row =
      insert_outbox_event!(%{
        aggregate_type: "proposed_action",
        event_type: "proposed_action.created",
        payload: %{}
      })

    Drain.run_once()

    reloaded = Repo.get!(Event, row.id)
    assert reloaded.processed_at == nil
    refute_enqueued(worker: Engine.Workers.SessionLifecycleWorker)
    refute_enqueued(worker: Engine.Workers.PsychologistWorker)
  end

  describe "aggregate_type task (Fase 12b — reagendamento do dev agent)" do
    test "task.gate_resolved roteia pro DevAgentWakeWorker" do
      row =
        insert_outbox_event!(%{
          aggregate_type: "task",
          event_type: "task.gate_resolved",
          payload: %{"taskId" => "t1", "agentId" => "dev-api", "nextAction" => "done"}
        })

      Drain.run_once()

      reloaded = Repo.get!(Event, row.id)
      assert reloaded.processed_at != nil

      assert_enqueued(
        worker: Engine.Workers.DevAgentWakeWorker,
        args: %{
          "event_type" => "task.gate_resolved",
          "aggregate_id" => row.aggregate_id,
          "payload" => %{"taskId" => "t1", "agentId" => "dev-api", "nextAction" => "done"}
        }
      )
    end

    test "task.became_claimable roteia pro DevAgentWakeWorker" do
      row =
        insert_outbox_event!(%{
          aggregate_type: "task",
          event_type: "task.became_claimable",
          payload: %{"taskId" => "t1", "modules" => ["api"]}
        })

      Drain.run_once()

      reloaded = Repo.get!(Event, row.id)
      assert reloaded.processed_at != nil

      assert_enqueued(
        worker: Engine.Workers.DevAgentWakeWorker,
        args: %{"event_type" => "task.became_claimable", "aggregate_id" => row.aggregate_id}
      )
    end

    test "task de event_type desconhecido cai no catch-all (SessionLifecycleWorker), não no DevAgentWakeWorker" do
      # `aggregate_type` entrou na lista de lidos pela Fase 12b, mas
      # `handlers_for/1` só tem regra explícita pros dois tipos conhecidos —
      # qualquer outro cai no catch-all pré-existente, que é inofensivo
      # (SessionLifecycleWorker ignora o que não reconhece).
      row =
        insert_outbox_event!(%{
          aggregate_type: "task",
          event_type: "task.algo_desconhecido",
          payload: %{}
        })

      Drain.run_once()

      reloaded = Repo.get!(Event, row.id)
      assert reloaded.processed_at != nil
      refute_enqueued(worker: Engine.Workers.DevAgentWakeWorker)

      assert_enqueued(
        worker: Engine.Workers.SessionLifecycleWorker,
        args: %{"aggregate_id" => row.aggregate_id}
      )
    end
  end

  # A correlação do trabalho assíncrono (ADR 0035).
  #
  # Estava quebrada em silêncio desde a Fase 5: o schema `Engine.Outbox.Event`
  # não declarava `metadata`, então `%Event{}` não tinha a chave, a primeira
  # cláusula de `Drain.traceparent/1` era inalcançável, e TODO job nascia com
  # `traceparent: nil`. Nada falhava — a api gravava a coluna, o drain "propagava"
  # nil, e o Psicólogo aparecia no Tempo numa trace própria, desligada da sessão
  # que o disparou.
  describe "traceparent" do
    test "o schema declara metadata — sem isso a propagação é inalcançável" do
      # Teste de CONTRATO, não de comportamento: falha exatamente na regressão
      # (alguém enxugando o schema) em vez de num efeito colateral distante.
      assert :metadata in Event.__schema__(:fields)
    end

    test "chega no job quando a api gravou no metadado do evento" do
      traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"

      row =
        insert_outbox_event!(%{
          aggregate_type: "session",
          event_type: "session.closed",
          payload: %{"projectId" => "project-1"},
          metadata: %{"traceparent" => traceparent}
        })

      Drain.run_once()

      assert_enqueued(
        worker: Engine.Workers.PsychologistWorker,
        args: %{"aggregate_id" => row.aggregate_id, "traceparent" => traceparent}
      )

      assert_enqueued(
        worker: Engine.Workers.SessionLifecycleWorker,
        args: %{"traceparent" => traceparent}
      )
    end

    test "metadata vazio virou nil, sem levantar" do
      # Evento gravado antes da Fase 5, ou por um caminho fora de contexto de
      # trace. `with_session/4` trata nil como "abre trace própria".
      row =
        insert_outbox_event!(%{
          aggregate_type: "session",
          event_type: "session.closed",
          payload: %{"projectId" => "project-1"},
          metadata: %{}
        })

      Drain.run_once()

      job = Enum.find(all_enqueued(), &(&1.args["aggregate_id"] == row.aggregate_id))
      assert job.args["traceparent"] == nil
    end

    test "metadado com outra chave não é confundido com traceparent" do
      row =
        insert_outbox_event!(%{
          aggregate_type: "session",
          event_type: "session.closed",
          payload: %{"projectId" => "project-1"},
          metadata: %{"outro" => "campo"}
        })

      Drain.run_once()

      job = Enum.find(all_enqueued(), &(&1.args["aggregate_id"] == row.aggregate_id))
      assert job.args["traceparent"] == nil
    end
  end
end
