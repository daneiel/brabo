defmodule Engine.Agents.AnexosDoTurnoTest do
  @moduledoc """
  AT-715 (RN-990): o anexo vai ao LLM SÓ no turno em que a mensagem chegou.
  """
  use Engine.DataCase, async: false

  alias Engine.Agents.{CriativoServer, FilaDeMensagens, Reidratacao}
  alias Engine.Harness.AnexosDoTurno
  alias Engine.Sessions.FakeEngineApiClient

  @a1 %{"id" => "11111111-1111-1111-1111-111111111111", "nome" => "a.png", "mime" => "image/png"}
  @a2 %{"id" => "22222222-2222-2222-2222-222222222222", "nome" => "b.txt", "mime" => "text/plain"}

  setup do
    Application.put_env(:engine, :engine_api_client, FakeEngineApiClient)
    Application.put_env(:engine, :test_pid, self())

    root = Path.join(System.tmp_dir!(), "brabo-anexos-#{System.unique_integer([:positive])}")
    Application.put_env(:engine, :project_workspaces_root, root)

    on_exit(fn ->
      File.rm_rf!(root)
      Application.delete_env(:engine, :engine_api_client)
      Application.delete_env(:engine, :test_pid)
      Application.delete_env(:engine, :project_workspaces_root)
    end)

    {:ok, state} = CriativoServer.init({Ecto.UUID.generate(), Ecto.UUID.generate()})
    %{state: state}
  end

  defp autor(anexos), do: %{idioma: "pt-BR", perfil: nil, anexos: anexos}

  defp falar(state, texto, id, anexos) do
    CriativoServer.handle_call(
      {:user_message, texto, if(anexos == [], do: nil, else: autor(anexos)), id},
      {self(), make_ref()},
      state
    )
  end

  defp terminar(%{turno_assincrono: %{task: %Task{ref: ref}}} = state) do
    assert_receive {^ref, resultado}, 1_000
    {:noreply, fechado} = CriativoServer.handle_info({ref, resultado}, state)
    fechado
  end

  defp ultimo_usuario(messages),
    do: messages |> Enum.filter(&(&1["role"] == "user")) |> List.last()

  test "com anexos vira partes no turno em que chegou; o turno seguinte manda só texto",
       %{state: state} do
    assert {:reply, :ok, s1} = falar(state, "olha isto", "m1", [@a1, @a2])
    assert_receive {:llm_turn_stream, _, msgs, _}, 1_000

    assert ultimo_usuario(msgs)["content"] == [
             %{"type" => "text", "text" => "olha isto [anexos: a.png, b.txt]"},
             %{"type" => "anexo", "id" => @a1["id"]},
             %{"type" => "anexo", "id" => @a2["id"]}
           ]

    s2 = terminar(s1)
    assert {:reply, :ok, _} = falar(s2, "e agora?", "m2", [])
    assert_receive {:llm_turn_stream, _, msgs2, _}, 1_000
    assert Enum.any?(msgs2, &(&1["content"] == "olha isto [anexos: a.png, b.txt]"))
    refute inspect(msgs2) =~ "\"anexo\""
    assert ultimo_usuario(msgs2)["content"] == "e agora?"
  end

  test "mensagem sem anexos não muda (string)", %{state: state} do
    assert {:reply, :ok, _} = falar(state, "oi", "m1", [])
    assert_receive {:llm_turn_stream, _, msgs, _}, 1_000
    assert ultimo_usuario(msgs)["content"] == "oi"
  end

  test "a 2ª chamada do MESMO turno não reenvia a parte (só a primeira)" do
    msgs = [%{"role" => "user", "content" => "x [anexos: a.png]"}]

    AnexosDoTurno.com_anexos([@a1], fn ->
      assert [%{"content" => [_, %{"type" => "anexo"}]}] = AnexosDoTurno.anexar(msgs)
      assert AnexosDoTurno.anexar(msgs) == msgs
    end)
  end

  test "na fila os anexos são preservados e juntam na ordem" do
    fila = [
      %{id: "m1", texto: "um", idioma: nil, anexos: [@a1]},
      %{id: "m2", texto: "dois", idioma: nil, anexos: [@a2]}
    ]

    texto = FilaDeMensagens.texto_do_turno(fila)
    assert texto =~ "[1] um [anexos: a.png]"
    assert texto =~ "[2] dois [anexos: b.txt]"

    evento = %{
      "seq" => 1,
      "type" => "chat.message_queued",
      "actor" => %{"kind" => "agent", "id" => "criativo"},
      "payload" => %{"mensagemId" => "m1", "texto" => "um", "anexos" => [@a1]}
    }

    assert [%{anexos: [@a1]}] = FilaDeMensagens.pendentes([evento], "criativo")
  end

  test "a reidratação devolve texto com os nomes, sem parte anexo" do
    evento = %{
      "seq" => 1,
      "type" => "chat.message",
      "id" => "m1",
      "payload" => %{"text" => "veja", "anexos" => [@a1]}
    }

    assert [%{"role" => "user", "content" => "veja [anexos: a.png]"}] =
             Reidratacao.mensagens([evento], "criativo")
  end
end
