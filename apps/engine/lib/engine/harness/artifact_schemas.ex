defmodule Engine.Harness.ArtifactSchemas do
  @moduledoc """
  Validação de artefatos por tipo (emit_artifact). Um artefato é um
  `session_event` `"artifact.<tipo>"` com payload validado AQUI (não há tabela
  de artefatos nem validação por tipo na api). Registro de chaves obrigatórias
  por tipo, mais validações extras (ex.: `business_rule.origin` não pode ser
  vazia — é a rastreabilidade da regra até a conversa).

  Nem todo tipo pode ser emitido por FERRAMENTA: `known/0` (usado na descrição
  do tool pro LLM e como whitelist em `EmitArtifact`) lista só os
  model-emittable. O `product_brief` é validável mas NÃO tool-emittable — ele
  é emitido pelo servidor do Criativo só após a confirmação de prontidão do
  usuário (CLAUDE.md 3b.3), nunca por uma tool call do modelo.
  """

  # tipo => [chaves obrigatórias no payload]
  @schemas %{
    "note" => ["title", "body"],
    "business_rule" => ["title", "description", "origin"],
    "product_brief" => ["title", "summary", "rules"],
    # Fase 4a — o DevAgent desistiu da task (suite não fecha, limite de
    # iterações, orçamento estourado, ou parou sem sinalizar). Emitido pelo
    # SERVIDOR (`Engine.Dev.AgentIo.block_task/3`), nunca por tool call: é o
    # registro do desfecho, não algo que o modelo escolhe declarar.
    "task_blocked" => ["taskId", "agentId", "reason", "diagnosis"],
    # Fase 4a — pareceres dos gates de PR (QA e SecOps). Server-emitted como o
    # task_blocked: o SecOps é determinístico (nem tem LLM), e o parecer do QA
    # nasce da tool `emit_qa_verdict`, que é enforçada à parte — em nenhum dos
    # dois o modelo escolhe emitir o artefato. `coverageMatrix` (só do QA) é
    # opcional de propósito: um parecer sem matriz ainda é um parecer válido,
    # e perdê-lo por validação seria pior do que registrá-lo incompleto. O
    # SUJEITO do parecer não entra nas chaves obrigatórias porque varia entre
    # os dois consumidores — ver `check_extra/2`.
    "qa_verdict" => ["veredito", "resumo", "itens"],
    "secops_verdict" => ["veredito", "resumo", "itens"],
    # Fase 8c — resultado de UM delegado da área de Infra (o próprio Lead,
    # gerando Dockerfiles/compose; ou o Workflows, gerando o pipeline de CI).
    # Server-emitted como `task_blocked`/`qa_verdict`: o `InfraLeadServer`
    # emite depois que cada delegado termina, só pra ter um
    # `parecer_artifact_id` pra referenciar em `delegations` — nunca visto
    # de fora da área (o que a api vê é a PR consolidada, via
    # `open_infra_pr`).
    "infra_delegation_files" => ["files", "summary"]
  }

  # Pareceres de gate. Os vereditos possíveis são os mesmos da máquina de
  # estados da api (`pr-gate-state-machine.ts`) — um veredito fora disso faria
  # o `RecordGateVerdictUseCase` estourar, então é melhor recusar o artefato.
  @gate_verdict_types ["qa_verdict", "secops_verdict"]
  @gate_verdicts ["approved", "changes_requested"]

  # Um parecer é sobre UMA task de dev (`taskId`) ou sobre UMA PR de infra
  # (`prActionId`, ver `Engine.Infra.InfraGateRunner`) — nunca sobre as duas,
  # nunca sobre nenhuma. Mesmo tipo de artefato, sujeitos diferentes: a UI já
  # trata os dois estruturalmente (`GateSubject` em PrGateTimeline.tsx).
  @gate_subject_keys ["taskId", "prActionId"]

  # Tipos que o modelo pode emitir via a ferramenta emit_artifact.
  @tool_emittable ["note", "business_rule"]

  @doc "Tipos de artefato emitíveis por ferramenta (model-facing)."
  def known, do: @tool_emittable

  @doc """
  Campos obrigatórios de um tipo. Existe para a DESCRIÇÃO da ferramenta poder
  nomeá-los ao modelo: um modelo conversando em português emitiu `titulo`,
  `descricao` e `comportamento` contra um schema que exige `title`,
  `description` e `origin` — as quatro regras de negócio da conversa foram
  recusadas, e ninguém ficou sabendo.
  """
  def required(type), do: Map.get(@schemas, type, [])

  @doc """
  Valida `payload` (map com chaves string) contra o schema do `type`.
  `:ok` | `{:error, reason}` (tipo desconhecido, chaves faltando, ou
  validação extra do tipo).
  """
  def validate(type, payload) when is_map(payload) do
    with {:ok, required} <- fetch_schema(type),
         :ok <- check_required(required, payload),
         :ok <- check_extra(type, payload) do
      :ok
    end
  end

  def validate(_type, _payload), do: {:error, :invalid_payload}

  defp fetch_schema(type) do
    case Map.fetch(@schemas, type) do
      :error -> {:error, {:unknown_type, type}}
      {:ok, required} -> {:ok, required}
    end
  end

  defp check_required(required, payload) do
    missing = Enum.reject(required, &Map.has_key?(payload, &1))
    if missing == [], do: :ok, else: {:error, {:missing_keys, missing}}
  end

  # A origem de uma regra de negócio referencia os eventos da conversa que a
  # originaram — precisa ser uma lista NÃO-vazia (CLAUDE.md 3b.2).
  defp check_extra("business_rule", payload) do
    case Map.get(payload, "origin") do
      origin when is_list(origin) and origin != [] -> :ok
      _ -> {:error, :origem_invalida}
    end
  end

  defp check_extra(type, payload) when type in @gate_verdict_types do
    with :ok <- check_gate_subject(payload) do
      check_gate_verdict(payload)
    end
  end

  # Um delegado de Infra sem NENHUM arquivo não terminou nada — mesma lição
  # do `nada_a_validar/1` do `InfraGateRunner` (ADR 0021), aplicada um passo
  # antes: nunca deixar "vazio" passar por "concluído".
  defp check_extra("infra_delegation_files", payload) do
    case Map.get(payload, "files") do
      files when is_list(files) and files != [] -> :ok
      _ -> {:error, :arquivos_vazios}
    end
  end

  defp check_extra(_type, _payload), do: :ok

  defp check_gate_subject(payload) do
    case Enum.filter(@gate_subject_keys, &Map.has_key?(payload, &1)) do
      [_only_one] -> :ok
      keys -> {:error, {:sujeito_invalido, keys}}
    end
  end

  defp check_gate_verdict(payload) do
    case Map.get(payload, "veredito") do
      veredito when veredito in @gate_verdicts -> :ok
      other -> {:error, {:veredito_invalido, other}}
    end
  end
end
