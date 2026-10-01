defmodule Engine.Harness.Tools.OfferHandoffTest do
  @moduledoc """
  ADR 0182 (RN-635): o que a ferramenta devolve ao modelo diante dos desfechos
  novos da api. O texto é ENTRADA do laço (RN-163): a oferta repetida não pode
  soar como segunda passagem de bastão, e a recusa por agente já ativo chega
  com a frase da api, nunca com o `inspect` do corpo.
  """

  use ExUnit.Case, async: false

  alias Engine.Harness.Tools.OfferHandoff

  setup do
    Application.put_env(:engine, :engine_api_client, Engine.Sessions.FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    on_exit(fn -> Application.delete_env(:engine, :test_pid) end)

    %{ctx: %{project_id: "p1", session_id: "s1", agent: "po"}}
  end

  test "oferta criada: diz que foi oferecida", %{ctx: ctx} do
    assert {:ok, texto} = OfferHandoff.run(%{"to_agent" => "arquiteto"}, ctx)
    assert texto =~ "handoff oferecido a arquiteto"
    assert_received {:handoff_created, "p1", "s1", "po", "arquiteto", nil}
  end

  test "oferta que já estava pendente: diz que nenhuma nova foi criada", %{ctx: ctx} do
    Process.put(:fake_handoff, %{"id" => "ho-1", "desfecho" => "ja_oferecido"})

    assert {:ok, texto} = OfferHandoff.run(%{"to_agent" => "arquiteto"}, ctx)
    assert texto =~ "já havia um handoff pendente a arquiteto"
    assert texto =~ "nenhum novo foi criado"
  end

  # RN-660 (ADR 0186): a api aceitou pelo sistema — o modelo não pode ficar
  # esperando um clique que não vem.
  test "aceite automático: diz que o destino já foi ativado", %{ctx: ctx} do
    Process.put(:fake_handoff, %{
      "id" => "ho-1",
      "status" => "accepted",
      "desfecho" => "criado",
      "aceiteAutomatico" => %{"aceito" => true}
    })

    assert {:ok, texto} = OfferHandoff.run(%{"to_agent" => "arquiteto"}, ctx)
    assert texto =~ "aceito automaticamente"
    refute texto =~ "aguardando o usuário"
  end

  test "sem aceite automático: segue aguardando o usuário", %{ctx: ctx} do
    Process.put(:fake_handoff, %{
      "id" => "ho-1",
      "desfecho" => "criado",
      "aceiteAutomatico" => %{"aceito" => false, "motivo" => "regras_sem_historia"}
    })

    assert {:ok, texto} = OfferHandoff.run(%{"to_agent" => "arquiteto"}, ctx)
    assert texto =~ "aguardando o usuário aceitar"
  end

  test "destino já ativo: a frase da api vira o erro que o modelo lê", %{ctx: ctx} do
    frase = ~s(Handoff não criado: o agente "arquiteto" já está ativo neste projeto)

    Process.put(
      :fake_handoff_error,
      {409, %{"reason" => "agente_ja_ativo", "message" => frase}}
    )

    assert {:error, ^frase} = OfferHandoff.run(%{"to_agent" => "arquiteto"}, ctx)
  end

  test "qualquer outra falha segue nomeada como falha", %{ctx: ctx} do
    Process.put(:fake_handoff_error, {500, %{"message" => "boom"}})

    assert {:error, texto} = OfferHandoff.run(%{"to_agent" => "arquiteto"}, ctx)
    assert texto =~ "falha ao oferecer handoff"
  end
end
