defmodule Engine.Agents.TurnoAssincronoCase do
  @moduledoc """
  Helper de teste pros quatro agentes conversacionais depois da RN-122: o
  turno passou a rodar numa `Task`, então `handle_call`/`handle_cast` não
  devolve mais a resposta na hora — ela chega via `handle_info/2` quando a
  task termina (ver `Engine.Agents.TurnoAssincrono`).

  `sync_call/3` e `sync_cast/3` escondem essa volta pro `handle_info` e
  devolvem a MESMA forma de tupla que o `handle_call`/`handle_cast` síncrono
  devolvia ANTES desta mudança — os testes existentes só trocam o CALL SITE
  (`Mod.handle_call(msg, self(), state)` vira `sync_call(Mod, msg, state)`),
  sem reescrever a asserção.
  """

  import ExUnit.Assertions

  @doc """
  Roda `mod.handle_call(msg, from, state)` com um `from` de verdade
  (`{pid, tag}`) e, se o turno foi pra uma Task, drena o resultado dela e
  chama `handle_info/2` para completar o ciclo. Devolve `{:reply, reply,
  state}` — `reply` é o ACEITE que o `handle_call` deu na hora (ADR 0163,
  RN-578: `:ok` com o turno subindo, `{:error, _}` quando recusou antes), e
  `state` é o do FIM do turno.

  Até o ADR 0163 o `handle_call` devolvia `{:noreply, _}` e a resposta
  chegava pelo `GenServer.reply/2` no fim do turno; agora ela vem na própria
  tupla, e nada mais é mandado ao `from` depois — o `refute_received` abaixo
  prova isso a cada chamada.
  """
  def sync_call(mod, msg, state, timeout \\ 5_000) do
    tag = make_ref()
    from = {self(), tag}

    case mod.handle_call(msg, from, state) do
      {:reply, reply, %{turno_assincrono: %{task: %Task{ref: ref}}} = state_with_task} ->
        assert_receive {^ref, resultado}, timeout
        {:noreply, final_state} = mod.handle_info({ref, resultado}, state_with_task)
        refute_received {^tag, _}
        {:reply, reply, final_state}

      {:reply, reply, new_state} ->
        {:reply, reply, new_state}
    end
  end

  @doc """
  Mesma ideia para `handle_cast/2` (o `:kickoff`): sem `from`, então sem
  reply — só drena a task (se ela chegou a subir) e devolve `{:noreply,
  state}`.
  """
  def sync_cast(mod, msg, state, timeout \\ 5_000) do
    case mod.handle_cast(msg, state) do
      {:noreply, %{turno_assincrono: %{task: %Task{ref: ref}}} = state_with_task} ->
        assert_receive {^ref, resultado}, timeout
        mod.handle_info({ref, resultado}, state_with_task)

      {:noreply, _state} = ja_pronto ->
        ja_pronto
    end
  end
end
