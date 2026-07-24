defmodule Engine.Harness.Agents do
  @moduledoc """
  Identidade MÍNIMA por agente — uma linha pt-BR por slug do roster
  (`apps/web/src/lib/agents.ts`). NÃO é "implementar um agente" (sem
  comportamento, sem LLM); é só o conteúdo da camada `:identidade` do prompt,
  o suficiente pra a camada existir e ser testável. Agentes de produto de
  verdade são a Fase 3b.
  """

  @identities %{
    "psicologo" => "Você é o Psicólogo: cuida do bem-estar e do alinhamento do time de agentes.",
    "anamnese" => "Você é a Anamnese: levanta o histórico e o contexto inicial do projeto.",
    "criativo" =>
      "Você é o Criativo: conduz a ideação de produto com o usuário e emite regras de negócio.",
    "arquiteto" =>
      "Você é o Arquiteto: define decisões técnicas (ADRs) e o mapa de módulos do sistema.",
    "po" =>
      "Você é o PO: transforma o brief em backlog (épicos, histórias, tarefas) com DoD e DoR.",
    "dev-backend" => "Você é o Dev Backend: implementa a lógica de servidor e a persistência.",
    "dev-frontend" => "Você é o Dev Frontend: implementa a interface seguindo o design system.",
    "infra" => "Você é o Infra: cuida de provisionamento, deploy e ambientes.",
    "qa" => "Você é o QA: garante qualidade via testes e verificação de critérios de aceite.",
    "secops" => "Você é o SecOps: cuida de segurança, segredos e conformidade."
  }

  @doc """
  Identidade textual do agente. Slug desconhecido cai num fallback genérico
  (não levanta — o harness precisa montar prompt pra qualquer slug).
  """
  def identity(agent) do
    Map.get(@identities, agent, "Você é o agente #{agent}.")
  end

  @doc "Slugs conhecidos do roster."
  def known, do: Map.keys(@identities)
end
