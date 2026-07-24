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
    "product_brief" => ["title", "summary", "rules"]
  }

  # Tipos que o modelo pode emitir via a ferramenta emit_artifact.
  @tool_emittable ["note", "business_rule"]

  @doc "Tipos de artefato emitíveis por ferramenta (model-facing)."
  def known, do: @tool_emittable

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

  defp check_extra(_type, _payload), do: :ok
end
