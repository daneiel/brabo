defmodule Engine.Agents.Areas do
  @moduledoc """
  GERADO por `pnpm --filter api gerar:areas` a partir de
  `apps/api/src/domain/agents/agent-areas.ts`. NÃO edite à mão: a próxima
  geração sobrescreve, e o teste `agent-areas.spec.ts` reprova a divergência.

  As áreas do ADR 0038: um lead como contato externo, subagentes por dentro.
  Aqui só a lista — a REGRA de endereçamento de handoff mora na api, que é
  quem grava `handoffs`.

  `dev` vem com `members` vazio de propósito: os membros dela são um por
  módulo do `module_map`, por projeto, e o engine os conhece pelo
  `session_id` que sobe, não por esta lista.
  """

  @areas [
    %{
      key: "dev",
      label: "Dev",
      lead: "dev-lead",
      members: []
    },
    %{
      key: "qa",
      label: "QA",
      lead: "qa",
      members: ["qa-automacao", "qa-performance-seguranca"]
    },
    %{
      key: "infra",
      label: "Infra",
      lead: "infra",
      members: ["infra-workflows"]
    }
  ]

  @doc "Todas as áreas, na ordem canônica da api."
  def all, do: @areas

  @doc "O lead da área, ou `nil` se a chave não existe."
  def lead(key) do
    case Enum.find(@areas, &(&1.key == key)) do
      nil -> nil
      area -> area.lead
    end
  end

  @doc "Os subagentes da área (lista vazia quando a área não existe)."
  def membros(key) do
    case Enum.find(@areas, &(&1.key == key)) do
      nil -> []
      area -> area.members
    end
  end
end
