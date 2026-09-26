defmodule Engine.Agents.ConversacionaisTest do
  @moduledoc """
  RN-581 (AT-072): fechar a sessão para os agentes conversacionais vivos dela.
  Até aqui `SessionLifecycleWorker` só derrubava o `SessionServer`, e o
  Criativo de uma sessão fechada seguia vivo.

  Usa o `CriativoServer` e o `StaffServer` DE VERDADE sob os supervisores
  reais — o que se prova é o registro e o supervisor, não um processo de
  mentira com o mesmo nome.
  """
  use Engine.DataCase, async: false

  alias Engine.Agents.{Conversacionais, CriativoSupervisor, StaffSupervisor}
  alias Engine.Sessions.FakeEngineApiClient
  alias Engine.Workers.SessionLifecycleWorker

  setup do
    Engine.GlobalSessionTestLock.acquire()

    root =
      Path.join(
        System.tmp_dir!(),
        "brabo-conversacionais-#{System.os_time(:microsecond)}-#{System.unique_integer([:positive])}"
      )

    Application.put_env(:engine, :project_workspaces_root, root)
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn ->
      File.rm_rf!(root)
      Application.delete_env(:engine, :project_workspaces_root)
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
      Engine.GlobalSessionTestLock.release()
    end)

    %{project_id: Ecto.UUID.generate()}
  end

  # "Vivo" é haver, sob a chave da sessão, um processo VIVO — e não haver uma
  # entrada no Registry. A limpeza do Registry é ASSÍNCRONA: quem apaga a
  # chave é a partição dele, ao receber o `EXIT` do processo registrado, e
  # isso pode acontecer DEPOIS de `GenServer.stop/3` voltar (o `stop` espera o
  # `:DOWN` do monitor dele, não a partição). Medido (AT-175): em 5 de 20
  # rodadas deste arquivo o `lookup` logo depois do `stop` devolvia o pid JÁ
  # MORTO — com `refute Process.alive?(pid)` passando na linha de cima.
  #
  # Checar a vivacidade do pid encontrado é determinístico (morto não volta) e
  # é a mesma leitura que o próprio `Registry` faz de uma entrada velha:
  # registrar de novo a chave de um pid morto não é recusado. Esperar a
  # partição por tempo (o `wait_unregister` de outros testes) seria sleep.
  defp vivo?(prefixo, session_id) do
    case Registry.lookup(Engine.Sessions.Registry, prefixo <> ":" <> session_id) do
      [{pid, _}] -> Process.alive?(pid)
      [] -> false
    end
  end

  test "para os conversacionais DAQUELA sessão, e só dela", %{project_id: project_id} do
    sessao = Ecto.UUID.generate()
    outra = Ecto.UUID.generate()

    {:ok, criativo} = CriativoSupervisor.start_agent(sessao, project_id)
    {:ok, staff, _} = StaffSupervisor.start_agent(sessao, project_id)
    {:ok, criativo_de_outra} = CriativoSupervisor.start_agent(outra, project_id)

    parados = Conversacionais.parar_da_sessao(sessao)

    assert Enum.sort(parados) == ["criativo", "staff"]
    refute Process.alive?(criativo)
    refute Process.alive?(staff)
    refute vivo?("criativo", sessao)
    refute vivo?("staff", sessao)

    # A outra sessão não é tocada.
    assert Process.alive?(criativo_de_outra)
    assert Conversacionais.parar_da_sessao(outra) == ["criativo"]
  end

  test "sessão sem conversacional vivo é no-op" do
    assert Conversacionais.parar_da_sessao(Ecto.UUID.generate()) == []
  end

  test "entrada velha no Registry (pid já morto) não entra na lista de parados",
       %{project_id: project_id} do
    sessao = Ecto.UUID.generate()
    {:ok, criativo} = CriativoSupervisor.start_agent(sessao, project_id)
    {:ok, staff, _} = StaffSupervisor.start_agent(sessao, project_id)

    # A limpeza do Registry fica SUSPENSA (AT-204): o Criativo morre antes do
    # fechamento, e a chave dele ainda está lá quando `parar_da_sessao/1` lê —
    # a janela que o Registry tem de verdade, aberta de propósito. O log do
    # fechamento dizia "parei criativo" sobre quem já estava morto.
    parados =
      com_limpeza_do_registry_suspensa(Engine.Sessions.Registry, fn ->
        ref = Process.monitor(criativo)
        Process.exit(criativo, :kill)
        assert_receive {:DOWN, ^ref, :process, ^criativo, :killed}

        assert [{^criativo, _}] =
                 Registry.lookup(Engine.Sessions.Registry, "criativo:" <> sessao)

        Conversacionais.parar_da_sessao(sessao)
      end)

    assert parados == ["staff"]
    refute Process.alive?(staff)
  end

  test "no cluster (um nó só aqui) devolve o mesmo que o local", %{project_id: project_id} do
    sessao = Ecto.UUID.generate()
    {:ok, _} = CriativoSupervisor.start_agent(sessao, project_id)

    assert Conversacionais.parar_da_sessao_no_cluster(sessao) == ["criativo"]
    refute vivo?("criativo", sessao)
  end

  test "a lista cobre os sete conversacionais que o engine registra por sessão" do
    # Mesma lista que `AGENTES_CONVERSACIONAIS` na api (pelo id de ator), e as
    # MESMAS chaves que os supervisores usam no `Registry.lookup`.
    assert Conversacionais.prefixos() ==
             ~w(criativo po arquiteto dev-lead ux-designer staff infra)
  end

  test "session.closed pelo worker de ciclo de vida para o Criativo vivo", %{
    project_id: project_id
  } do
    sessao = Ecto.UUID.generate()
    {:ok, criativo} = CriativoSupervisor.start_agent(sessao, project_id)
    ref = Process.monitor(criativo)

    :ok =
      SessionLifecycleWorker.perform(%Oban.Job{
        args: %{"event_type" => "session.closed", "aggregate_id" => sessao, "payload" => %{}}
      })

    assert_receive {:DOWN, ^ref, :process, ^criativo, {:shutdown, :sessao_encerrada}}
    refute vivo?("criativo", sessao)
  end

  test "session.closed_abnormally também para", %{project_id: project_id} do
    sessao = Ecto.UUID.generate()
    {:ok, criativo} = CriativoSupervisor.start_agent(sessao, project_id)

    :ok =
      SessionLifecycleWorker.perform(%Oban.Job{
        args: %{
          "event_type" => "session.closed_abnormally",
          "aggregate_id" => sessao,
          "payload" => %{}
        }
      })

    refute Process.alive?(criativo)
  end
end
