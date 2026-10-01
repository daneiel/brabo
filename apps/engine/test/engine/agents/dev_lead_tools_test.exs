defmodule Engine.Agents.DevLeadToolsTest do
  # Sem DataCase — só o FakeEngineApiClient (scriptado por dicionário de
  # processo). async: false (Application env global).
  use ExUnit.Case, async: false

  alias Engine.Agents.DevLeadTools
  alias Engine.Gates.FakeGateDispatcher
  alias Engine.Sessions.FakeEngineApiClient

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    # `assess_implementability` dispara `Dispatcher.run_appsec_design/2`
    # (RN-539) — o fake evita subir um `SecOpsAgentServer` real (mesmo motivo
    # do `qa_lead_server_test.exs`).
    Application.put_env(:engine, :gate_dispatcher, FakeGateDispatcher)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :gate_dispatcher)
      Application.delete_env(:engine, :test_pid)
    end)

    %{ctx: %{project_id: "proj-1", session_id: "sess-1"}}
  end

  defp plano(modulos) do
    %{"modulos" => modulos, "resumo" => "um agente por módulo"}
  end

  defp modulo(nome, agentes) do
    %{"modulo" => nome, "agentes" => agentes, "porque" => "backlog de #{nome}"}
  end

  describe "propose_execution_plan" do
    test "propõe o plano como proposed_action, com o total somado (status auto_approved do fake)",
         %{ctx: ctx} do
      assert {:ok, msg} = DevLeadTools.run(plano([modulo("api", 2), modulo("web", 1)]), ctx)

      assert msg =~ "3 agente(s)"
      assert msg =~ "2 módulo(s)"

      assert_received {:propose_action, action_type, actor, payload}
      assert action_type == "propose_execution_plan"
      assert actor == %{kind: "agent", id: "dev-lead"}
      assert payload.totalAgentes == 3
    end

    test "o PORQUÊ de cada módulo viaja no payload da proposta", %{ctx: ctx} do
      # É o que o usuário lê para decidir quando o plano passa do teto. Um
      # plano sem justificativa por módulo vira um número sem argumento.
      DevLeadTools.run(plano([modulo("api", 3)]), ctx)

      assert_received {:propose_action, _action_type, _actor, payload}
      assert [%{porque: porque}] = payload.modulos
      assert porque =~ "backlog de api"
    end

    test "status pending devolve {:pending, action_id} — o chamador é quem suspende", %{ctx: ctx} do
      Process.put(:fake_propose_action, %{"id" => "pa-42", "status" => "pending"})

      assert {:pending, "pa-42"} = DevLeadTools.run(plano([modulo("api", 2)]), ctx)

      assert_received {:propose_action, "propose_execution_plan", _actor, _payload}
    end

    test "status executed também conta como sucesso", %{ctx: ctx} do
      Process.put(:fake_propose_action, %{"id" => "pa-9", "status" => "executed"})

      assert {:ok, msg} = DevLeadTools.run(plano([modulo("api", 1)]), ctx)
      assert msg =~ "1 agente(s)"
    end

    test "status denied vira {:error, _} — a proposta não é reencaminhada como sucesso", %{
      ctx: ctx
    } do
      Process.put(:fake_propose_action, %{"id" => "pa-7", "status" => "denied"})

      assert {:error, msg} = DevLeadTools.run(plano([modulo("api", 1)]), ctx)
      assert msg =~ "denied"
    end

    test "plano VAZIO é recusado, sem propor ação", %{ctx: ctx} do
      # Chegaria ao usuário como uma decisão sem conteúdo.
      assert {:error, msg} = DevLeadTools.run(plano([]), ctx)
      assert msg =~ "ao menos um módulo"
      refute_received {:propose_action, _, _, _}
    end

    test "zero agente num módulo é recusado, sem propor ação", %{ctx: ctx} do
      assert {:error, msg} = DevLeadTools.run(plano([modulo("api", 0)]), ctx)
      assert msg =~ "api"
      assert msg =~ ">= 1"
      refute_received {:propose_action, _, _, _}
    end

    test "um módulo invalido no MEIO da lista nao propõe nada", %{ctx: ctx} do
      # Validação antes de qualquer I/O: uma vez proposta, a ação é decisão
      # real do usuário — um plano meio proposto não teria como ser retratado.
      assert {:error, _} =
               DevLeadTools.run(
                 plano([modulo("api", 1), modulo("web", 0), modulo("infra", 1)]),
                 ctx
               )

      refute_received {:propose_action, _, _, _}
    end

    # AT-274 (RN-678): o Dev Lead atribui o módulo de cada tarefa no plano.
    test "`tarefas` viaja no payload como o modelo a escreveu", %{ctx: ctx} do
      tarefas = [%{"taskId" => "t-1", "modulo" => "api"}]
      DevLeadTools.run(Map.put(plano([modulo("api", 1)]), "tarefas", tarefas), ctx)

      assert_received {:propose_action, "propose_execution_plan", _actor, payload}
      assert payload.tarefas == tarefas
    end

    test "a recusa NOMEADA da api (tarefa sem módulo) volta ao modelo como está", %{ctx: ctx} do
      Process.put(
        :fake_propose_action_erro,
        {400,
         %{
           "code" => "plano_de_execucao_invalido",
           "message" => "A tarefa t-1 está sem módulo."
         }}
      )

      assert {:error, msg} = DevLeadTools.run(plano([modulo("api", 1)]), ctx)
      assert msg =~ "plano recusado: A tarefa t-1 está sem módulo."
      assert msg =~ "proponha o plano de novo"
    end

    # AT-263 (RN-677): auto-aprovado, a api já ativou (ou falhou ao ativar).
    test "status executed diz que a execução foi ATIVADA", %{ctx: ctx} do
      Process.put(:fake_propose_action, %{"id" => "pa-10", "status" => "executed"})

      assert {:ok, msg} = DevLeadTools.run(plano([modulo("api", 1)]), ctx)
      assert msg =~ "execução ATIVADA"
    end

    test "status failed vira {:error, _} com o motivo da ativação", %{ctx: ctx} do
      Process.put(:fake_propose_action, %{
        "id" => "pa-11",
        "status" => "failed",
        "executionResult" => %{"motivo" => "Projeto sem repositório"}
      })

      assert {:error, msg} = DevLeadTools.run(plano([modulo("api", 1)]), ctx)
      assert msg =~ "a ativação da execução falhou: Projeto sem repositório"
    end

    test "sem os campos obrigatorios: erro que diz quais", %{ctx: ctx} do
      assert {:error, msg} = DevLeadTools.run(%{"resumo" => "só o resumo"}, ctx)
      assert msg =~ "modulos"
    end
  end

  describe "assess_implementability (ADR 0090, insumo do ADR 0192)" do
    defp assessment(story_id \\ "st-1") do
      %{
        "storyId" => story_id,
        "parecer" => "implementavel",
        "justificativa" => "critérios claros"
      }
    end

    # Um plano de teste de ENTREGA (ADR 0192) que por acaso esteja na sessão
    # — de outra rodada, de outra task. Ele não é mais insumo do parecer.
    defp plano_de_teste_event(story_id) do
      %{
        "type" => "artifact.plano_de_teste",
        "payload" => %{
          "storyId" => story_id,
          "taskId" => "task-1",
          "planoDeTeste" => "cobrir X",
          "criteriosExecutaveis" => ["dado X, quando Y, então Z"],
          "estrategiaDeAutomacao" => "integração"
        }
      }
    end

    defp threat_model_event(story_id) do
      %{
        "type" => "artifact.threat_model",
        "payload" => %{
          "storyId" => story_id,
          "threatModel" => "Spoofing: ...",
          "requisitosDeSeguranca" => ["autenticar o webhook"],
          "riscos" => []
        }
      }
    end

    # O sintoma do uso real de 29/09: sem plano, a ferramenta disparava a
    # QA-estratégia PRE-DEV e devolvia erro pedindo retentativa — e o plano
    # nunca chegava. Desde o ADR 0192 o parecer sai na PRIMEIRA chamada.
    test "sem plano de teste na sessão: propõe o parecer na PRIMEIRA chamada", %{ctx: ctx} do
      Process.put(:fake_events, [])

      assert {:ok, msg} = DevLeadTools.run_assessment(assessment(), ctx)
      assert msg =~ "implementavel"
      assert msg =~ "st-1"

      assert_received {:propose_action, "assess_implementability", actor, payload}
      assert actor == %{kind: "agent", id: "dev-lead"}
      assert payload.storyId == "st-1"
      assert payload.parecer == "implementavel"
      assert payload.justificativa == "critérios claros"
    end

    test "o payload NÃO carrega plano de teste, mesmo com um na sessão", %{ctx: ctx} do
      Process.put(:fake_events, [plano_de_teste_event("st-1")])

      assert {:ok, _msg} = DevLeadTools.run_assessment(assessment(), ctx)

      assert_received {:propose_action, "assess_implementability", _actor, payload}
      assert payload |> Map.keys() |> Enum.sort() == [:justificativa, :parecer, :storyId]
    end

    test "sessão com mais de 200 eventos: UMA leitura, da CAUDA", %{ctx: ctx} do
      ruido = Enum.map(1..250, &%{"type" => "chat.message", "payload" => %{"text" => "m#{&1}"}})
      Process.put(:fake_events, ruido)
      Process.put(:fake_list_events_calls, [])

      assert {:ok, _msg} = DevLeadTools.run_assessment(assessment(), ctx)

      assert [opts] = Process.get(:fake_list_events_calls)
      assert opts[:latest] == true
      assert opts[:limit] == 200
    end

    test "status pending devolve {:pending, action_id}", %{ctx: ctx} do
      Process.put(:fake_events, [])
      Process.put(:fake_propose_action, %{"id" => "pa-imp-1", "status" => "pending"})

      assert {:pending, "pa-imp-1"} = DevLeadTools.run_assessment(assessment(), ctx)
    end

    test "status denied vira {:error, _}", %{ctx: ctx} do
      Process.put(:fake_events, [])
      Process.put(:fake_propose_action, %{"id" => "pa-imp-2", "status" => "denied"})

      assert {:error, msg} = DevLeadTools.run_assessment(assessment(), ctx)
      assert msg =~ "denied"
    end

    test "sem os campos obrigatorios: erro que diz quais", %{ctx: ctx} do
      assert {:error, msg} = DevLeadTools.run_assessment(%{"storyId" => "st-1"}, ctx)
      assert msg =~ "storyId"
      assert msg =~ "parecer"
    end

    test "parecer fora do enum é recusado", %{ctx: ctx} do
      args = %{"storyId" => "st-1", "parecer" => "talvez", "justificativa" => "x"}
      assert {:error, _msg} = DevLeadTools.run_assessment(args, ctx)
    end

    test "a descrição da ferramenta não pede retentativa à espera de plano" do
      descricao = DevLeadTools.spec_assess_implementability().description
      assert descricao =~ "module_map"
      refute descricao =~ "tentar de novo"
    end
  end

  # RN-539: o gatilho do appsec (`SecOpsAgentServer.run_design/2`), que até
  # aqui não tinha chamador de produção nenhum. Dispara em PARALELO e nunca
  # entra no caminho do parecer — os testes abaixo provam as duas metades.
  describe "assess_implementability dispara o appsec (RN-539)" do
    test "story SEM threat model: pede o threat model de design", %{ctx: ctx} do
      Process.put(:fake_events, [])

      assert {:ok, _msg} = DevLeadTools.run_assessment(assessment("st-1"), ctx)

      assert_received {:appsec_dispatch, "proj-1", "st-1"}
    end

    test "story COM threat model: NÃO pede de novo (idempotência)", %{ctx: ctx} do
      # O modelo pode reavaliar a mesma story — sem esta guarda, cada
      # rechamada custaria outra rodada de LLM do appsec e mais três handoffs
      # (RN-361) sobre a MESMA story.
      Process.put(:fake_events, [threat_model_event("st-1")])

      assert {:ok, _msg} = DevLeadTools.run_assessment(assessment("st-1"), ctx)

      refute_received {:appsec_dispatch, _project_id, _story_id}
    end

    test "threat model de OUTRA story não conta como guarda", %{ctx: ctx} do
      Process.put(:fake_events, [threat_model_event("st-outra")])

      assert {:ok, _msg} = DevLeadTools.run_assessment(assessment("st-1"), ctx)

      assert_received {:appsec_dispatch, "proj-1", "st-1"}
    end

    test "o parecer é proposto normalmente ao lado do disparo", %{ctx: ctx} do
      # Não-regressão: o disparo do appsec não desvia nem atrasa a proposta.
      Process.put(:fake_events, [])

      assert {:ok, _msg} = DevLeadTools.run_assessment(assessment("st-1"), ctx)

      assert_received {:appsec_dispatch, "proj-1", "st-1"}
      assert_received {:propose_action, "assess_implementability", _actor, payload}
      assert payload.storyId == "st-1"
    end

    test "args inválidos NÃO disparam o appsec", %{ctx: ctx} do
      # A cláusula de fallback não sabe qual é a story — disparar dali seria
      # pedir threat model para um id que o modelo nem mandou.
      Process.put(:fake_events, [])

      assert {:error, _msg} = DevLeadTools.run_assessment(%{"storyId" => "st-1"}, ctx)

      refute_received {:appsec_dispatch, _project_id, _story_id}
    end

    test "histórico ilegível: não dispara nada (ausência não é prova de ausência)", %{ctx: ctx} do
      Process.put(:fake_events_error, :timeout)

      assert {:error, msg} = DevLeadTools.run_assessment(assessment("st-1"), ctx)
      assert msg =~ "não consegui ler o histórico"

      refute_received {:appsec_dispatch, _project_id, _story_id}
      refute_received {:propose_action, "assess_implementability", _actor, _payload}
    end
  end
end
