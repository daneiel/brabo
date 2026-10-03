defmodule Engine.Gates.GateRescuer do
  @moduledoc """
  Resgate de ciclos de gate (QA/SecOps) órfãos — o que o ADR 0057 declarou
  como limite conhecido ("restart no meio da espera perde o laço") e o
  ADR 0067 fecha.

  Varre `Engine.Gates.GateState` por linhas paradas há mais de
  `gate_rescue_stale_after_seconds` (default 15 min — generoso de propósito:
  o ToolLoop de um subagente de QA pode legitimamente rodar até
  `TOOL_LOOP_MAX_ITERATIONS_GATE` iterações, e um limiar curto duplicaria
  trabalho num ciclo só lento) e retoma cada uma, conforme `step`:

    * `"in_progress"` — nenhum veredito foi gravado nesta tentativa (o
      processo caiu antes de registrar, ou no meio de um subagente suspenso
      esperando aprovação). O `ctx` do ToolLoop não sobrevive a um restart
      (mesma limitação do `laço_pendente` do dev agent, ADR 0052) — não há o
      que retomar CIRURGICAMENTE, então o resgate reinicia a ÁREA inteira
      (`Dispatcher.run_qa`/`run_secops` de novo). É seguro: a api só aceita
      `record_gate_verdict` pro gate que ainda é DONO do `gate_status` atual
      (`nextGateStatus`); se este ciclo já tinha terminado por outra via, a
      segunda tentativa recebe erro e não corrompe nada (ver `_ -> :ok` em
      `qa_lead_server.ex`/`secops_agent_server.ex`).
    * `"dispatch_pending"` — o veredito JÁ foi gravado (durável, na api); só a
      chamada em processo (`Dispatcher.run_secops`/`DevAgentServer.correct`)
      que aplica o próximo passo se perdeu. Reenvia exatamente ela.

  Dupla proteção contra duplicar trabalho, além do limiar de staleness:
  `Engine.Gates.Registry`/`Engine.Dev.Registry` são consultados ANTES de
  qualquer resgate — um processo vivo NESTE nó nunca é perturbado. Isso não
  cobre outra réplica (Registry é local ao nó, mesma ressalva que
  `Engine.Dev.Wake` já declara desde o ADR 0045); o limiar generoso é a
  segunda linha de defesa para esse caso, e o pior desfecho de uma corrida
  residual é trabalho duplicado e barato (SecOps re-varre; QA re-roda e o
  segundo `record_gate_verdict` é rejeitado pela api sem gravar nada), nunca
  dado inconsistente.

  Duas guardas a mais desde a RN-722, as duas para o `"in_progress"`:

    * **Ciclo esperando HUMANO não é órfão.** Se a sessão do ciclo tem
      `proposed_action` PENDENTE de um ator do gate (`qa*`, `secops*`,
      `appsec`), o ciclo está parado por decisão de alguém, não por crash —
      reiniciá-lo pagaria a área de novo e deixaria a ação pendente órfã. O
      resgate registra no log e segue; a linha fica para o próximo tick.
    * **"Vivo" é por TASK, não por projeto.** O processo do lead é UM por
      projeto e a linha é por task: um lead vivo e ocioso segurava para
      sempre o resgate de um ciclo perdido (8 h no uso real). O resgate
      PERGUNTA ao lead se aquela task está em voo (`em_voo?/2`); lead
      ocupado demais para responder conta como vivo (a próxima varredura
      pergunta de novo).

  E desde o ADR 0207 (decisão do dono, 02/10), um TETO: ciclo `"in_progress"`
  parado há mais de `gate_rescue_park_after_seconds` (default 2 h) desde a
  ÚLTIMA ATIVIDADE (`updated_at`, a mesma coluna do limiar de staleness — um
  ciclo que avança de subagente em subagente não é velho) NÃO é retomado
  sozinho, nem no boot nem no tick: o resgate grava `gate.rescue_parked` no log
  da sessão (task, gate, idade, motivo) e ESTACIONA a linha. Retomar passa a
  exigir gesto humano, por `retomar_estacionado/3`. Reiniciar sozinho, horas
  depois, um ciclo que ninguém olhou é pagar a área inteira de novo sobre um
  contexto que pode ter mudado.

  Chamado de dois lugares (mesmo par que `Engine.Dev.DevRehydrator` usa para
  dev agents): uma vez no boot (`Engine.Application`) e periodicamente via
  `Engine.Workers.GateRescueSchedulerWorker` (Oban).
  """

  require Logger
  import Ecto.Query, only: [from: 2]

  alias Engine.Dev.{DevAgentServer, DevAgentState}
  alias Engine.Gates.{Dispatcher, GateState}
  alias Engine.Sessions.EngineApiClient

  def run do
    stale_after_seconds()
    |> GateState.list_stale()
    |> Enum.each(&rescue_one/1)

    :ok
  end

  defp rescue_one(
         %{step: "in_progress", gate: gate, project_id: project_id, task_id: task_id} = linha
       ) do
    cond do
      task_em_voo?(project_id, gate, task_id) ->
        :ok

      aguardando_humano?(gate, Map.get(linha, :session_id)) ->
        Logger.info(
          "GateRescuer: ciclo #{gate} da task #{task_id} (projeto #{project_id}) " <>
            "espera decisão humana em ação pendente — não reiniciado (RN-722)"
        )

        :ok

      DevAgentState.find_by_task_id(project_id, task_id) == nil ->
        # A task não tem mais dev agent dono (terminou por outra via, ou o
        # engine nunca chegou a montar o estado) — nada a resgatar, só a
        # bookkeeping órfã.
        GateState.delete(project_id, task_id, gate)

      velho_demais?(linha) ->
        estacionar(linha)

      true ->
        Logger.warning(
          "GateRescuer: reiniciando ciclo #{gate} órfão (task #{task_id}, projeto #{project_id})"
        )

        dispatch_fresh(gate, project_id, task_id)
    end
  end

  defp rescue_one(%{
         step: "dispatch_pending",
         next_action: "run_secops",
         project_id: project_id,
         task_id: task_id,
         gate: gate
       }) do
    unless locally_alive?(project_id, "secops") do
      Logger.warning(
        "GateRescuer: reenviando run_secops perdido (task #{task_id}, projeto #{project_id})"
      )

      :ok = Dispatcher.run_secops(project_id, task_id)
    end

    GateState.delete(project_id, task_id, gate)
  end

  defp rescue_one(%{
         step: "dispatch_pending",
         next_action: "correct",
         project_id: project_id,
         task_id: task_id,
         gate: gate,
         correction_reason: reason,
         correction_diagnosis: diagnosis
       }) do
    case DevAgentState.find_by_task_id(project_id, task_id) do
      nil ->
        :ok

      dev_state ->
        Logger.warning(
          "GateRescuer: reenviando correct(#{gate}) perdido (task #{task_id}, projeto #{project_id})"
        )

        DevAgentServer.correct(project_id, dev_state.agent_id, %{
          gate: gate,
          reason: reason,
          diagnosis: diagnosis
        })
    end

    GateState.delete(project_id, task_id, gate)
  end

  # Linha em formato inesperado (não deveria acontecer — os dois `step`
  # gravados são "in_progress"/"dispatch_pending") — apaga em vez de
  # resweeping pra sempre.
  defp rescue_one(%{project_id: project_id, task_id: task_id, gate: gate}) do
    GateState.delete(project_id, task_id, gate)
  end

  defp dispatch_fresh("qa", project_id, task_id), do: :ok = Dispatcher.run_qa(project_id, task_id)

  defp dispatch_fresh("secops", project_id, task_id),
    do: :ok = Dispatcher.run_secops(project_id, task_id)

  # VIVO, e não só registrado (AT-204): o Registry apaga a chave de forma
  # ASSÍNCRONA, e logo depois de o processo morrer o lookup ainda pode devolver
  # o pid morto — a linha órfã seria tomada por "processo local vivo" e o
  # resgate não religaria nada.
  defp locally_alive?(project_id, gate) do
    case Registry.lookup(Engine.Gates.Registry, {project_id, gate}) do
      [{pid, _}] -> Process.alive?(pid)
      [] -> false
    end
  end

  # ADR 0207: idade pela última atividade do ciclo.
  defp velho_demais?(%{updated_at: %DateTime{} = em}) do
    DateTime.diff(DateTime.utc_now(), em, :second) > park_after_seconds()
  end

  defp velho_demais?(_linha), do: false

  defp estacionar(%{project_id: project_id, task_id: task_id, gate: gate} = linha) do
    idade = DateTime.diff(DateTime.utc_now(), linha.updated_at, :second)

    Logger.warning(
      "GateRescuer: ciclo #{gate} da task #{task_id} (projeto #{project_id}) parado há " <>
        "#{idade}s — ESTACIONADO, retomar exige gesto humano (ADR 0207)"
    )

    :ok = GateState.park!(project_id, task_id, gate)

    if is_binary(linha.session_id) do
      EngineApiClient.append_event(project_id, linha.session_id, %{
        type: "gate.rescue_parked",
        actorKind: "system",
        actorId: "gate-rescuer",
        payload: %{
          taskId: task_id,
          gate: gate,
          idadeSegundos: idade,
          motivo:
            "ciclo parado há mais de #{div(park_after_seconds(), 60)} min sem atividade; " <>
              "o resgate automático não o reinicia — retomar exige gesto humano"
        }
      })
    end

    :ok
  end

  defp park_after_seconds,
    do: Application.get_env(:engine, :gate_rescue_park_after_seconds, 7_200)

  @doc """
  O gesto humano que retoma um ciclo ESTACIONADO (ADR 0207). Hoje não há tela:
  é chamado pelo operador (`bin/engine rpc`). Linha que não existe ou não está
  estacionada devolve `{:error, :nao_estacionado}` e não despacha nada.
  """
  def retomar_estacionado(project_id, task_id, gate) do
    case GateState.get(project_id, task_id, gate) do
      %{parked_at: %DateTime{}} ->
        Logger.warning(
          "GateRescuer: retomando por gesto humano o ciclo #{gate} estacionado " <>
            "(task #{task_id}, projeto #{project_id})"
        )

        dispatch_fresh(gate, project_id, task_id)

      _ ->
        {:error, :nao_estacionado}
    end
  end

  # RN-722: o lead VIVO só segura o resgate se a TASK está em voo nele.
  defp task_em_voo?(project_id, gate, task_id) do
    case Registry.lookup(Engine.Gates.Registry, {project_id, gate}) do
      [{pid, _}] -> Process.alive?(pid) and perguntar_em_voo(pid, task_id)
      [] -> false
    end
  end

  defp perguntar_em_voo(pid, task_id) do
    GenServer.call(pid, {:em_voo?, task_id}, em_voo_timeout_ms())
  catch
    # Ocupado (rodando um ciclo dentro do `handle_cast`) — pode ser ESTA task;
    # na dúvida não religa, e a próxima varredura pergunta de novo.
    :exit, {:timeout, _} -> true
    # Morreu entre o lookup e a pergunta.
    :exit, _ -> false
  end

  defp em_voo_timeout_ms,
    do: Application.get_env(:engine, :gate_rescue_em_voo_timeout_ms, 2_000)

  @atores_do_gate %{"qa" => ["qa%"], "secops" => ["secops%", "appsec"]}

  # RN-722: ação PENDENTE de um ator do gate na sessão do ciclo — lida direto
  # do Postgres (mesmo padrão de `outbox_events`), sem HTTP no resgate.
  defp aguardando_humano?(_gate, nil), do: false

  defp aguardando_humano?(gate, session_id) do
    case Ecto.UUID.cast(session_id) do
      {:ok, uuid} -> ha_acao_pendente_do_gate?(gate, uuid)
      :error -> false
    end
  end

  defp ha_acao_pendente_do_gate?(gate, session_id) do
    padroes = Map.get(@atores_do_gate, gate, [])

    query =
      from(a in "proposed_actions",
        where:
          a.session_id == type(^session_id, :binary_id) and
            a.status == "pending",
        select: a.actor_id
      )

    query
    |> Engine.Repo.all()
    |> Enum.any?(fn ator -> Enum.any?(padroes, &casa?(ator, &1)) end)
  end

  defp casa?(ator, padrao) do
    case String.split(padrao, "%") do
      [prefixo, ""] -> String.starts_with?(ator, prefixo)
      _ -> ator == padrao
    end
  end

  defp stale_after_seconds,
    do: Application.get_env(:engine, :gate_rescue_stale_after_seconds, 900)

  # --- Boot task (mesmo idioma do Engine.Dev.DevRehydrator) -----------------
  #
  # Sem bypass de staleness no boot: uma linha recente demais pode pertencer
  # a um processo vivo em OUTRA réplica (Registry é local ao nó), então o
  # boot varre com o MESMO limiar que o tick periódico usa.

  def start_link(_opts) do
    :ok = run()
    :ignore
  end

  def child_spec(_opts) do
    %{id: __MODULE__, start: {__MODULE__, :start_link, [[]]}, restart: :transient}
  end
end
