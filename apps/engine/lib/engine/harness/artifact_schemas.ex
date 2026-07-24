defmodule Engine.Harness.ArtifactSchemas do
  @moduledoc """
  Validação de artefatos por tipo (Fase 3a — emit_artifact). Um artefato é um
  `session_event` `"artifact.<tipo>"` com payload validado AQUI (não há tabela
  de artefatos nem validação por tipo na api). Registro de chaves obrigatórias
  por tipo. Os tipos de produto (business_rule, product_brief, module_map) são
  Fase 3b; por ora só `"note"`.
  """

  # tipo => [chaves obrigatórias no payload]
  @schemas %{
    "note" => ["title", "body"]
  }

  @doc "Tipos de artefato conhecidos."
  def known, do: Map.keys(@schemas)

  @doc """
  Valida `payload` (map com chaves string) contra o schema do `type`.
  `:ok` | `{:error, reason}` (tipo desconhecido ou chaves faltando).
  """
  def validate(type, payload) when is_map(payload) do
    case Map.fetch(@schemas, type) do
      :error ->
        {:error, {:unknown_type, type}}

      {:ok, required} ->
        missing = Enum.reject(required, &Map.has_key?(payload, &1))
        if missing == [], do: :ok, else: {:error, {:missing_keys, missing}}
    end
  end

  def validate(_type, _payload), do: {:error, :invalid_payload}
end
