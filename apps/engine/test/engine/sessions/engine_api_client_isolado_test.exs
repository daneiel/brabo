defmodule Engine.Sessions.EngineApiClientIsoladoTest do
  # AT-428 (RN-742): a resposta tardia de uma chamada HTTP não pode ficar na
  # caixa de mensagens de quem chamou.
  use ExUnit.Case, async: true

  alias Engine.Sessions.EngineApiClient

  test "mensagem tardia do pedido chega a um processo que já acabou, nunca ao chamador" do
    eu = self()

    assert {:error, %Req.TransportError{reason: :timeout}} =
             EngineApiClient.Live.isolado(fn ->
               # A conexão que responde depois do timeout entrega a mensagem
               # atrasada ao processo que fez o pedido.
               dono = self()

               spawn(fn ->
                 Process.sleep(30)
                 send(dono, {:status, make_ref(), 201})
               end)

               send(eu, {:dono, dono})
               {:error, %Req.TransportError{reason: :timeout}}
             end)

    assert_receive {:dono, dono}
    assert dono != eu
    Process.sleep(80)
    refute_received {:status, _, _}
  end

  test "exceção dentro do pedido volta como {:error, _}, sem derrubar o chamador" do
    assert {:error, %RuntimeError{message: "caiu"}} =
             EngineApiClient.Live.isolado(fn -> raise "caiu" end)
  end
end
