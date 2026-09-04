defmodule Engine.Agents.WakeDoOutboxAoDevLeadTest do
  @moduledoc """
  O caminho INTEIRO que solta um Dev Lead suspenso esperando a decisão do
  plano de execução (ADR 0086, RN-284): linha na outbox da api →
  `Engine.Outbox.Drain` → job do Oban → `DevAgentWakeWorker` →
  `Engine.Dev.Wake` → o processo do agente.

  Mesmo espírito de `Engine.Dev.WakeDoOutboxAoAgenteTest` (a corrente
  equivalente do dev agent, ADR 0052): os testes de `DevLeadServerTest`
  chamam `handle_info({:action_settled, ...})` direto — provam o que o Dev
  Lead FAZ com a mensagem, e assumem que ela chega. Este teste prova que ela
  CHEGA — os dois elos do meio (dreno + worker) não sabem nada sobre
  "dev-lead" além do `agentId` no payload, e é essa a garantia que se
  quebra em silêncio se algum dia divergir: `DevAgentWakeWorker` roteia por
  `Engine.Dev.Wake`, que é topic-por-agente-id, não topic-por-tipo-de-
  agente — e é por isso que ele serve tanto o dev agent quanto o Dev Lead
  sem saber disso, apesar do módulo se chamar "Dev".

  A subscrição aqui NÃO é montada à mão: quem assina o tópico é o `init/1`
  do próprio `DevLeadServer`, rodando no processo de teste — se o Dev Lead e
  o worker discordarem sobre o formato do tópico ou a identidade do agente,
  é este teste que reprova.
  """

  use Engine.DataCase, async: false

  alias Engine.Agents.DevLeadServer
  alias Engine.Outbox.{Drain, Event}
  alias Engine.Sessions.FakeEngineApiClient
  import Engine.Agents.TurnoAssincronoCase, only: [sync_cast: 3]

  setup do
    root =
      Path.join(
        System.tmp_dir!(),
        "brabo-wake-devlead-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
      )

    Application.put_env(:engine, :project_workspaces_root, root)
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      File.rm_rf!(root)
      Application.delete_env(:engine, :project_workspaces_root)
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
    end)

    project_id = Ecto.UUID.generate()
    session_id = Ecto.UUID.generate()

    # `init/1` assina o tópico do agente com o processo de teste como
    # destinatário — a mesma linha que roda num Dev Lead de verdade.
    {:ok, state} = DevLeadServer.init({session_id, project_id})

    %{state: state, project_id: project_id, session_id: session_id}
  end

  defp plano_turn(resumo) do
    %{
      "message" => %{
        "role" => "assistant",
        "content" => "",
        "toolCalls" => [
          %{
            "id" => "call-#{System.unique_integer([:positive])}",
            "name" => "propose_execution_plan",
            "arguments" => %{
              "modulos" => [
                %{"modulo" => "api", "agentes" => 1, "porque" => "uma história"}
              ],
              "resumo" => resumo
            }
          }
        ]
      },
      "usage" => %{"estimated" => true},
      "error" => nil
    }
  end

  # A linha como a api a grava em `avisarQuemEsperava` (approve/deny-action):
  # agregado `task`, e o id da ação no payload.
  defp evento_da_api!(project_id, session_id, action_id, extras) do
    payload =
      Map.merge(
        %{
          "projectId" => project_id,
          "sessionId" => session_id,
          "actionId" => action_id,
          "agentId" => "dev-lead",
          "actionType" => "propose_execution_plan"
        },
        extras
      )

    %Event{}
    |> Ecto.Changeset.change(%{
      id: Ecto.UUID.generate(),
      aggregate_type: "task",
      aggregate_id: action_id,
      event_type: "task.action_settled",
      payload: payload,
      created_at: DateTime.utc_now(),
      processed_at: nil
    })
    |> Repo.insert!()
  end

  # Os dois elos do meio, rodados de verdade: o dreno lê a outbox e enfileira,
  # e a fila executa o worker (`testing: :manual` não roda job sozinho).
  defp drenar_e_executar do
    Drain.run_once()
    Oban.drain_queue(queue: :default)
  end

  # `action_id` é UUID de verdade: `outbox_events.aggregate_id` é `binary_id`,
  # e a api grava ali o id da própria ação.
  defp parar_o_dev_lead(state, action_id) do
    Process.put(:fake_propose_action, %{"id" => action_id, "status" => "pending"})
    Process.put(:fake_llm_turns, [plano_turn("um agente na api")])

    {:noreply, parado} = sync_cast(DevLeadServer, :kickoff, state)
    assert parado.aguardando_aprovacao.action_id == action_id
    parado
  end

  test "aprovação na api chega ao Dev Lead e o laço retoma", ctx do
    action_id = Ecto.UUID.generate()
    parado = parar_o_dev_lead(ctx.state, action_id)

    evento_da_api!(ctx.project_id, ctx.session_id, action_id, %{"status" => "auto_approved"})

    drenar_e_executar()

    # A mensagem CHEGOU — é isto que nenhum teste unitário de
    # `DevLeadServerTest` afirmava (ele monta `{:action_settled, ...}` à
    # mão).
    assert_receive {:action_settled, desfecho}
    assert desfecho.action_id == action_id
    assert desfecho.status == "auto_approved"

    # E o Dev Lead a aceita: o formato que o worker monta é o que o
    # `handle_info` casa. Duas metades que só se encontram aqui.
    Process.put(:fake_llm_turns, [
      FakeEngineApiClient.final_response("plano aprovado, seguindo")
    ])

    assert {:noreply, retomando} = DevLeadServer.handle_info({:action_settled, desfecho}, parado)
    %{turno_assincrono: %{task: %Task{ref: ref}}} = retomando
    assert_receive {^ref, resultado}, 5_000

    assert {:noreply, final_state} = DevLeadServer.handle_info({ref, resultado}, retomando)
    refute final_state.aguardando_aprovacao
    assert final_state.turno_assincrono == nil
  end

  test "recusa na api também chega, com o motivo", ctx do
    action_id = Ecto.UUID.generate()
    _parado = parar_o_dev_lead(ctx.state, action_id)

    evento_da_api!(ctx.project_id, ctx.session_id, action_id, %{
      "status" => "denied",
      "rejectionReason" => "número de agentes desproporcional ao backlog"
    })

    drenar_e_executar()

    assert_receive {:action_settled, desfecho}
    assert desfecho.status == "denied"
    assert desfecho.rejection_reason == "número de agentes desproporcional ao backlog"
  end

  test "o agregado errado quebra a corrente no primeiro elo, em silêncio", ctx do
    # A mesma regressão que `WakeDoOutboxAoAgenteTest` prova para o dev
    # agent, agora do lado do Dev Lead: com `aggregate_type:
    # "proposed_action"` o dreno nem lê a linha. Nada falha, nada é logado —
    # e o Dev Lead espera para sempre.
    action_id = Ecto.UUID.generate()

    row =
      %Event{}
      |> Ecto.Changeset.change(%{
        id: Ecto.UUID.generate(),
        aggregate_type: "proposed_action",
        aggregate_id: action_id,
        event_type: "task.action_settled",
        payload: %{
          "projectId" => ctx.project_id,
          "actionId" => action_id,
          "agentId" => "dev-lead",
          "status" => "auto_approved"
        },
        created_at: DateTime.utc_now(),
        processed_at: nil
      })
      |> Repo.insert!()

    drenar_e_executar()

    assert Repo.get!(Event, row.id).processed_at == nil
    refute_receive {:action_settled, _}, 100
  end
end
