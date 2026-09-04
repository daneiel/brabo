defmodule Engine.Runners.RunnerRouterTest do
  @moduledoc """
  `start_container/2`, `stop_container/2` e `remove_container/2` (ADR
  0137) — mesmo molde de roundtrip que `Engine.Actions.TerminalExecutorTest`
  já usa para `RunnerRouter.exec/4`: um processo FAKE assume o papel do
  runner via `Engine.Runners.Registry.register/2` (não passa pelo canal
  Phoenix de verdade — o mecanismo testado é a correlação por `ref` e o
  `receive ... after`, não o transporte websocket) e responde ao
  `{:dispatch_container_*, ref, payload, from, timeout_ms}` que
  `RunnerRouter` manda.

  `async: false`: `Engine.Runners.Registry` usa `:global`, global ao node de
  teste inteiro (mesmo motivo de `EngineWeb.TerminalChannelTest`).
  """

  use ExUnit.Case, async: false

  alias Engine.Runners.{Registry, RunnerRouter}

  defp unique_project_id, do: Ecto.UUID.generate()

  # Spawna um processo que registra a presença e responde ao dispatch
  # recebido com o payload que `responder` devolver. Roda num processo
  # PRÓPRIO porque `RunnerRouter.*` bloqueia em `receive` — o processo de
  # teste não pode esperar por si mesmo.
  defp start_fake_runner!(project_id, dispatch_tag, resultado_tag, responder) do
    parent = self()

    pid =
      spawn(fn ->
        :ok = Registry.register(project_id, self())
        send(parent, :fake_runner_ready)

        receive do
          {^dispatch_tag, ref, payload, from, _timeout_ms} ->
            send(from, {resultado_tag, ref, responder.(payload)})
        end
      end)

    assert_receive :fake_runner_ready, 1_000
    on_exit(fn -> Process.exit(pid, :kill) end)
    pid
  end

  describe "start_container/3" do
    test "sem runner conectado, devolve {:error, :not_connected}" do
      assert {:error, :not_connected} =
               RunnerRouter.start_container(unique_project_id(), %{"imagem" => "node:22"})
    end

    test "runner conectado: roundtrip via dispatch_container_start/container_start_result" do
      project_id = unique_project_id()
      spec = %{"workspaceDirName" => "proj-abc12345", "imagem" => "node:22-bookworm-slim"}

      start_fake_runner!(
        project_id,
        :dispatch_container_start,
        :runner_container_start_result,
        fn recebido ->
          assert recebido == spec

          %{
            "sucesso" => true,
            "containerId" => "container-1",
            "nome" => "brabo-proj-abc12345",
            "jaEstavaDePe" => false
          }
        end
      )

      assert {:ok, payload} = RunnerRouter.start_container(project_id, spec)
      assert payload["sucesso"] == true
      assert payload["containerId"] == "container-1"
    end

    test "runner conectado mas nunca responde: devolve {:error, :timeout}" do
      project_id = unique_project_id()
      :ok = Registry.register(project_id, self())

      assert {:error, :timeout} =
               RunnerRouter.start_container(project_id, %{"imagem" => "node:22"}, 50)
    end
  end

  describe "stop_container/3" do
    test "sem runner conectado, devolve {:error, :not_connected}" do
      assert {:error, :not_connected} =
               RunnerRouter.stop_container(unique_project_id(), "proj-abc12345")
    end

    test "runner conectado: roundtrip via dispatch_container_stop/container_stop_result" do
      project_id = unique_project_id()

      start_fake_runner!(
        project_id,
        :dispatch_container_stop,
        :runner_container_stop_result,
        fn recebido ->
          assert recebido == "proj-abc12345"
          %{"sucesso" => true}
        end
      )

      assert {:ok, %{"sucesso" => true}} =
               RunnerRouter.stop_container(project_id, "proj-abc12345")
    end
  end

  describe "remove_container/3" do
    test "sem runner conectado, devolve {:error, :not_connected}" do
      assert {:error, :not_connected} =
               RunnerRouter.remove_container(unique_project_id(), "proj-abc12345")
    end

    test "runner conectado: roundtrip via dispatch_container_remove/container_remove_result" do
      project_id = unique_project_id()

      start_fake_runner!(
        project_id,
        :dispatch_container_remove,
        :runner_container_remove_result,
        fn recebido ->
          assert recebido == "proj-abc12345"
          %{"sucesso" => true}
        end
      )

      assert {:ok, %{"sucesso" => true}} =
               RunnerRouter.remove_container(project_id, "proj-abc12345")
    end

    test "runner conectado mas RECUSA (Docker indisponível na máquina dele)" do
      project_id = unique_project_id()

      start_fake_runner!(
        project_id,
        :dispatch_container_remove,
        :runner_container_remove_result,
        fn _recebido -> %{"sucesso" => false, "erro" => "docker indisponível"} end
      )

      assert {:ok, %{"sucesso" => false, "erro" => "docker indisponível"}} =
               RunnerRouter.remove_container(project_id, "proj-abc12345")
    end
  end
end
