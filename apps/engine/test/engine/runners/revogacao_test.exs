defmodule Engine.Runners.RevogacaoTest do
  @moduledoc """
  `derrubar/2` (ADR 0147 ponto 6, RN-520) — mesmo molde de roundtrip que
  `Engine.Runners.RunnerRouterTest`: um processo FAKE assume o papel do canal
  do runner via `Engine.Runners.Registry.register/2` e responde ao
  `{:derrubar_por_revogacao, ref, user_id, from}`.

  Aqui o fake decide como o canal de verdade decide (comparando o `user_id`),
  e o que se prova é a CORRELAÇÃO e o teto. Que o canal REAL derruba a
  conexão e libera a presença é `EngineWeb.TerminalChannelTest`.

  `async: false`: `Engine.Runners.Registry` usa `:global`, global ao node de
  teste inteiro (mesmo motivo de `EngineWeb.TerminalChannelTest`).
  """

  use ExUnit.Case, async: false

  alias Engine.Runners.{Registry, Revogacao}

  defp unique_project_id, do: Ecto.UUID.generate()

  defp fake_canal!(project_id, dono) do
    parent = self()

    pid =
      spawn(fn ->
        :ok = Registry.register(project_id, self())
        send(parent, :fake_pronto)

        receive do
          {:derrubar_por_revogacao, ref, user_id, from} ->
            desfecho = if user_id == dono, do: :derrubado, else: :de_outro_dono
            send(from, {:runner_derrubado, ref, desfecho})
        end
      end)

    assert_receive :fake_pronto, 1_000
    on_exit(fn -> Process.exit(pid, :kill) end)
    pid
  end

  test "sem runner conectado devolve {:ok, :sem_runner} — o caso normal da chave órfã, nunca erro" do
    assert {:ok, :sem_runner} =
             Revogacao.derrubar(unique_project_id(), Ecto.UUID.generate())
  end

  test "caminho feliz: runner DAQUELE usuário é derrubado" do
    project_id = unique_project_id()
    dono = Ecto.UUID.generate()
    fake_canal!(project_id, dono)

    assert {:ok, :derrubado} = Revogacao.derrubar(project_id, dono)
  end

  test "runner de OUTRO usuário no mesmo projeto NÃO cai" do
    project_id = unique_project_id()
    fake_canal!(project_id, Ecto.UUID.generate())

    assert {:ok, :de_outro_dono} = Revogacao.derrubar(project_id, Ecto.UUID.generate())
  end

  test "canal registrado que não responde: {:error, :timeout}, nunca espera para sempre" do
    project_id = unique_project_id()
    # O próprio processo de teste ocupa a presença e nunca responde.
    :ok = Registry.register(project_id, self())
    on_exit(fn -> Registry.unregister(project_id) end)

    assert {:error, :timeout} = Revogacao.derrubar(project_id, Ecto.UUID.generate(), 50)
  end

  test "argumento fora de forma não levanta — a revogação nunca vira 5xx por causa disto" do
    assert {:ok, :sem_runner} = Revogacao.derrubar(nil, "user-1")
    assert {:ok, :sem_runner} = Revogacao.derrubar("proj-1", nil)
  end
end
