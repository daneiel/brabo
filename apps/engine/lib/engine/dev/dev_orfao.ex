defmodule Engine.Dev.DevOrfao do
  @moduledoc """
  O dev agent que morreu sem deixar dono fecha com desfecho DURÁVEL (RN-778,
  AT-465) — o molde da RN-586 (`Engine.Agents.TurnoOrfao`) aplicado ao
  vocabulário `dev.*`.

  O `GetSessionPendingWorkUseCase` conta como trabalho pendente o dev agent cujo
  ÚLTIMO evento `dev.*` na sessão é `dev.working` (ou outro estado de espera).
  Se o processo do agente morreu e a linha durável de `dev_agent_states` sumiu
  (rebuild, encerramento interrompido), ninguém mais grava nada: no TP-01 de
  09/10 a sessão `63a4e1aa` seguia `active`, reagendada pelo heartbeat a cada
  30 s, para sempre, por um `dev.working` sem processo.

  ## O que é órfão

  O último `dev.*` do agente na sessão é de espera (`@pendentes`) e NÃO há linha
  em `dev_agent_states` para `{projeto, agente}` NESTA sessão. A linha é a
  verdade durável de um agente vivo em qualquer nó: com ela, o
  `Engine.Dev.DevRehydrator` religa o agente no boot, e fechá-lo daqui mataria
  um agente saudável. Por isso não há consulta a outros nós.

  ## O que faz

  ACRESCENTA (evento é imutável) `dev.error` com origem `infra` e
  `reason: dev_agent_sem_processo`, e depois `dev.idle`, que tira o agente da
  régua do trabalho pendente. NUNCA reexecuta nada e não toca tarefa: a tarefa
  que ele segurava, se bloqueada ou com PR esperando o merge, segue segurando a
  sessão de execução vigente pela RN-776 — que tem dono humano, não processo.

  Roda no boot, pelo `Engine.Sessions.Rehydrator`, para cada sessão não
  terminal. Nunca lança: falha de leitura é logada e nada é fechado.
  """

  require Logger

  alias Engine.Dev.DevAgentState
  alias Engine.Sessions.EngineApiClient

  @pendentes ~w(dev.working dev.blocked dev.blocked_by_container dev.idle_tripped
                dev.credit_exhausted dev.awaiting_gate dev.awaiting_approval)

  # Todo o vocabulário `dev.*`: o ÚLTIMO de verdade decide, não só os pendentes.
  @tipos ~w(dev.started dev.idle dev.error) ++ @pendentes

  @janela 200

  @doc "Fecha os dev agents órfãos da sessão e devolve os ids fechados."
  @spec varrer(String.t(), String.t()) :: [String.t()]
  def varrer(project_id, session_id) do
    case EngineApiClient.list_events(project_id, session_id,
           types: @tipos,
           latest: true,
           limit: @janela
         ) do
      {:ok, eventos} ->
        fechados =
          eventos
          |> ultimos_pendentes()
          |> Enum.reject(&tem_dono?(project_id, session_id, &1))

        Enum.each(fechados, &encerrar(project_id, session_id, &1))
        fechados

      {:error, motivo} ->
        Logger.warning(
          "dev agent órfão: não consegui ler os eventos da sessão #{session_id} " <>
            "(#{inspect(motivo)}); nada foi fechado"
        )

        []
    end
  rescue
    erro ->
      Logger.warning(
        "dev agent órfão: falha inesperada na sessão #{session_id}: #{inspect(erro)}"
      )

      []
  end

  defp ultimos_pendentes(eventos) do
    eventos
    |> Enum.reduce(%{}, fn e, acc ->
      ator = get_in(e, ["actor", "id"]) || e["actorId"]
      Map.update(acc, ator, e, fn atual -> if seq(e) >= seq(atual), do: e, else: atual end)
    end)
    |> Enum.filter(fn {ator, e} -> is_binary(ator) and e["type"] in @pendentes end)
    |> Enum.map(fn {ator, _} -> ator end)
    |> Enum.sort()
  end

  defp tem_dono?(project_id, session_id, agente) do
    case DevAgentState.get(project_id, agente) do
      %{session_id: ^session_id} -> true
      _ -> false
    end
  end

  defp seq(%{"seq" => s}) when is_integer(s), do: s
  defp seq(_), do: 0

  defp encerrar(project_id, session_id, agente) do
    base = %{actorKind: "agent", actorId: agente}

    _ =
      EngineApiClient.append_event(
        project_id,
        session_id,
        Map.merge(base, %{
          type: "dev.error",
          payload: %{
            agentId: agente,
            origem: "infra",
            reason: "dev_agent_sem_processo",
            mensagem:
              "O processo deste dev agent não existe mais (o engine foi reiniciado " <>
                "ou a execução foi interrompida) e nada vai retomá-lo. Nada foi refeito; " <>
                "para continuar, ative a execução de novo."
          }
        })
      )

    _ =
      EngineApiClient.append_event(
        project_id,
        session_id,
        Map.merge(base, %{
          type: "dev.idle",
          payload: %{agentId: agente, reason: "dev agent sem processo"}
        })
      )

    Logger.info("dev agent órfão: #{agente} da sessão #{session_id} fechado")
  end
end
