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

  Chamado de dois lugares (mesmo par que `Engine.Dev.DevRehydrator` usa para
  dev agents): uma vez no boot (`Engine.Application`) e periodicamente via
  `Engine.Workers.GateRescueSchedulerWorker` (Oban).
  """

  require Logger

  alias Engine.Dev.{DevAgentServer, DevAgentState}
  alias Engine.Gates.{Dispatcher, GateState}

  def run do
    stale_after_seconds()
    |> GateState.list_stale()
    |> Enum.each(&rescue_one/1)

    :ok
  end

  defp rescue_one(%{step: "in_progress", gate: gate, project_id: project_id, task_id: task_id}) do
    cond do
      locally_alive?(project_id, gate) ->
        :ok

      DevAgentState.find_by_task_id(project_id, task_id) == nil ->
        # A task não tem mais dev agent dono (terminou por outra via, ou o
        # engine nunca chegou a montar o estado) — nada a resgatar, só a
        # bookkeeping órfã.
        GateState.delete(project_id, task_id, gate)

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

  defp locally_alive?(project_id, gate),
    do: Registry.lookup(Engine.Gates.Registry, {project_id, gate}) != []

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
