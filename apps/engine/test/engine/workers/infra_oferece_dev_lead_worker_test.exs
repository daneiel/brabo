defmodule Engine.Workers.InfraOfereceDevLeadWorkerTest do
  # RN-672 (AT-262, ADR 0190): o `container.running` do outbox vira o aviso,
  # cluster-wide, para o Infra Lead do projeto oferecer o Dev Lead.
  use ExUnit.Case, async: true

  alias Engine.Infra.InfraLeadServer
  alias Engine.Workers.InfraOfereceDevLeadWorker

  test "container.running avisa no tópico DO PROJETO, e só nele" do
    projeto = Ecto.UUID.generate()
    outro = Ecto.UUID.generate()
    Phoenix.PubSub.subscribe(Engine.PubSub, InfraLeadServer.topico_do_container(projeto))
    Phoenix.PubSub.subscribe(Engine.PubSub, InfraLeadServer.topico_do_container(outro))

    assert :ok =
             InfraOfereceDevLeadWorker.perform(%Oban.Job{
               args: %{
                 "event_type" => "container.running",
                 "payload" => %{"projectId" => projeto}
               }
             })

    assert_receive {:container_running, ^projeto}
    refute_received {:container_running, ^outro}
  end

  test "payload sem projectId não falha nem avisa ninguém" do
    projeto = Ecto.UUID.generate()
    Phoenix.PubSub.subscribe(Engine.PubSub, InfraLeadServer.topico_do_container(projeto))

    assert :ok =
             InfraOfereceDevLeadWorker.perform(%Oban.Job{
               args: %{"event_type" => "container.running", "payload" => %{}}
             })

    refute_received {:container_running, _}
  end
end
