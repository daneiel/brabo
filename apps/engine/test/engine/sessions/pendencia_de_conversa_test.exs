defmodule Engine.Sessions.PendenciaDeConversaTest do
  @moduledoc """
  RN-581: a forma da resposta de `GET /internal/sessions/:id/pending-work` no
  cliente Live. O instante é o que separa a pendência COM teto (conversa
  esperando o usuário) das sem teto — e um instante que não parseia não pode
  virar "sem teto", senão um formato quebrado faria sessão imortal.
  """
  use ExUnit.Case, async: true

  alias Engine.Sessions.EngineApiClient.Live

  test "sem aguardandoUsuarioDesde: pendência comum, instante nil" do
    assert {:ok, %{pending: true, motivo: "handoff", aguardando_usuario_desde: nil}} =
             Live.pendencia_da_resposta(%{"pending" => true, "motivo" => "handoff"})
  end

  test "com aguardandoUsuarioDesde ISO: vira DateTime" do
    assert {:ok, %{pending: true, aguardando_usuario_desde: %DateTime{} = desde}} =
             Live.pendencia_da_resposta(%{
               "pending" => true,
               "motivo" => "agente criativo aguardando",
               "aguardandoUsuarioDesde" => "2026-09-18T12:00:00.000Z"
             })

    assert DateTime.to_iso8601(desde) == "2026-09-18T12:00:00.000Z"
  end

  test "instante presente e inválido vira ERRO (cai no encerramento por heartbeat), nunca nil" do
    assert {:error, {:aguardando_usuario_desde_invalido, "ontem"}} =
             Live.pendencia_da_resposta(%{
               "pending" => true,
               "aguardandoUsuarioDesde" => "ontem"
             })
  end
end
