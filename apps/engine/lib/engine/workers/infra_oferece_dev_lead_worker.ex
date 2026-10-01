defmodule Engine.Workers.InfraOfereceDevLeadWorker do
  @moduledoc """
  O segundo consumidor de `container.running` (RN-672, AT-262, ADR 0190): o
  container do PROJETO chegou em `running` na api
  (`RegistrarTransicaoDeContainerUseCase`), e é esse o momento em que a Infra
  oferece o handoff ao Dev Lead — "só com o container `running`", na decisão
  do dono.

  O caso comum não precisa dele: a subida que o servidor do Infra Lead propõe
  no aceite (RN-671) executa DENTRO do kickoff, e o fecho do turno já pergunta
  pelo container e oferece. Este worker cobre a subida que acontece FORA de um
  turno da Infra — aprovada depois num `ApprovalCard`, pedida pela
  `/containers`, ou pelo `container_start_via_runner` de um projeto `runner`.

  Só AVISA: faz `broadcast` em `Engine.PubSub` no tópico do projeto
  (`InfraLeadServer.topico_do_container/1`), e quem decide é o Infra Lead vivo
  daquela sessão, que relê o registro e oferece no modo `if_absent`. PubSub e
  não `Registry`, pela mesma razão de `Engine.Dev.Wake`: o job roda em
  qualquer réplica, e o Registry é local ao nó. Entrega AT-MOST-ONCE, também
  como o `Wake`: sem Infra Lead de pé naquele instante, o aviso se perde, e a
  oferta fica para o fim do próximo turno dele — declarado no ADR 0190.
  """

  use Oban.Worker, queue: :default, max_attempts: 5

  alias Engine.Infra.InfraLeadServer

  @impl true
  def perform(%Oban.Job{
        args: %{"event_type" => "container.running", "payload" => %{"projectId" => project_id}}
      })
      when is_binary(project_id) do
    Phoenix.PubSub.broadcast(
      Engine.PubSub,
      InfraLeadServer.topico_do_container(project_id),
      {:container_running, project_id}
    )

    :ok
  end

  # Payload incompleto ou evento que o roteamento do drain não deveria ter
  # mandado para cá — nunca falha nem fica em retry infinito.
  def perform(%Oban.Job{}), do: :ok
end
