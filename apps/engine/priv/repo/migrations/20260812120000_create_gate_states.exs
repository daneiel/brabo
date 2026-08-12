defmodule Engine.Repo.Migrations.CreateGateStates do
  use Ecto.Migration

  # Estado durável de um ciclo de gate (QA/SecOps) em voo — rede de segurança
  # pra resgate depois de um restart, mesmo papel de `dev_agent_states`
  # (ADR 0045) só que pro `QaLeadServer`/`SecOpsAgentServer` (ambos
  # `restart: :temporary`, sem tabela equivalente até aqui — limite declarado
  # no ADR 0057). Chave composta {project_id, task_id, gate}: um projeto pode
  # ter várias tasks em gate ao mesmo tempo, e cada task tem no máximo UM ciclo
  # em voo por gate. Ao terminar (ou ao ser resgatada), a linha é deletada —
  # mesma disciplina de `dev_agent_states`.
  def change do
    create table(:gate_states, primary_key: false, prefix: "engine") do
      add :project_id, :string, null: false, primary_key: true
      add :task_id, :string, null: false, primary_key: true
      add :gate, :string, null: false, primary_key: true
      add :session_id, :string, null: false
      # "in_progress" — o ciclo está rodando (ou um subagente está suspenso
      # esperando aprovação dentro dele); o veredito ainda NÃO foi gravado na
      # api pra esta tentativa. "dispatch_pending" — o veredito JÁ foi
      # gravado (durável na api) e falta só a chamada em processo
      # (Dispatcher.run_secops/DevAgentServer.correct) que aplica o próximo
      # passo — ver Engine.Gates.GateRescuer.
      add :step, :string, null: false
      # Diagnóstico de QUAL subagente está suspenso, quando `step` é
      # "in_progress" (só QA — SecOps é determinístico, sem ToolLoop). Não é
      # usado pela recuperação (o `ctx` do ToolLoop não sobrevive a um
      # restart, mesma limitação do `laço_pendente` do dev agent), só ajuda a
      # entender o que estava rodando.
      add :subagent, :string
      # "correct" | "run_secops" — só quando `step` é "dispatch_pending".
      add :next_action, :string
      # Só preenchidos junto de `next_action: "correct"` — o que
      # `DevAgentServer.correct/3` precisa pra reconstruir `findings` no
      # resgate, sem reler o veredito da api.
      add :correction_reason, :text
      add :correction_diagnosis, :text

      timestamps(type: :utc_datetime_usec)
    end
  end
end
