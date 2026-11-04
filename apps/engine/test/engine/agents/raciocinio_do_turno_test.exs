defmodule Engine.Agents.RaciocinioDoTurnoTest do
  # AT-676 (RN-993): o raciocínio é gravado fora do `content` e nunca volta ao modelo.
  use ExUnit.Case, async: true

  alias Engine.Agents.{RaciocinioDoTurno, Reidratacao, TextoDoTurno}
  alias Engine.Sessions.EngineApiClient

  test "o frame raciocinio acumula ao vivo e o final.raciocinio substitui" do
    me = self()

    frames =
      for f <- [
            %{type: "raciocinio", text: "pen"},
            %{type: "raciocinio", text: "sando"},
            %{type: "final", raciocinio: "pensando inteiro", message: %{}}
          ],
          do: "data: #{Jason.encode!(f)}\n\n"

    %{final: final} =
      EngineApiClient.Live.consume_sse(
        %{buffer: "", final: nil},
        Enum.join(frames),
        fn _ -> :ok end,
        &send(me, {:rac, &1})
      )

    assert_received {:rac, "pen"}
    assert_received {:rac, "sando"}
    assert final["raciocinio"] == "pensando inteiro"
  end

  test "o payload grava raciocinio e raciocinioTotal, com o content intacto" do
    RaciocinioDoTurno.registrar(%{"raciocinio" => "um"})
    RaciocinioDoTurno.registrar(%{"raciocinio" => "dois"})
    payload = TextoDoTurno.payload_do_turno("Pronto.", "m")

    assert payload.content == "Pronto."
    assert payload.raciocinio == "um\n\ndois"
    assert payload.raciocinioTotal == 8
    assert RaciocinioDoTurno.descarregar() == %{}
  end

  test "sem raciocínio, o payload não ganha a chave" do
    refute Map.has_key?(TextoDoTurno.payload_do_turno("Oi.", "m"), :raciocinio)
  end

  test "a reidratação NÃO devolve o raciocínio" do
    eventos = [
      %{
        "type" => "agent.response",
        "actorId" => "criativo",
        "payload" => %{"content" => "Olá", "raciocinio" => "SEGREDO", "raciocinioTotal" => 7}
      }
    ]

    refute inspect(Reidratacao.mensagens(eventos, "criativo")) =~ "SEGREDO"
  end

  test "os thinkingBlocks voltam na mensagem assistant com toolCalls da chamada seguinte" do
    blocos = [%{"type" => "thinking", "thinking" => "x", "signature" => "s"}]
    RaciocinioDoTurno.registrar(%{"message" => %{"thinkingBlocks" => blocos}})

    msgs = [
      %{"role" => "user", "content" => "a"},
      %{"role" => "assistant", "content" => "", "toolCalls" => [%{"id" => "1"}]},
      %{"role" => "tool", "content" => "r"}
    ]

    assert [_, %{"thinkingBlocks" => ^blocos}, tool] = RaciocinioDoTurno.anexar_blocos(msgs)
    refute Map.has_key?(tool, "thinkingBlocks")
    RaciocinioDoTurno.descarregar()
    assert RaciocinioDoTurno.anexar_blocos(msgs) == msgs
  end
end
