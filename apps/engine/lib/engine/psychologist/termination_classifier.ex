defmodule Engine.Psychologist.TerminationClassifier do
  @moduledoc """
  Classifica a CAUSA de um término de sessão (Fase 4b) a partir do
  motivo reportado pelo engine (`sessions.termination_reason`) e do
  status terminal.

  DETERMINÍSTICO (pattern-match puro), não julgamento do LLM — mesma
  racional do ADR 0013 pro SecOps: reconhecer "heartbeat_timeout" vs um
  sinal de kill vs uma mensagem de exceção é casamento de padrão, não
  semântica. A causa classificada entra no prompt como FATO; o modelo
  analisa as CONSEQUÊNCIAS dela, não infere qual foi.

  Ver `Engine.Sessions.Monitor.classify/1`, que é quem produz essas
  strings do outro lado.

  **A causa vem do MOTIVO, não do status.** `Monitor.classify/1` manda
  `heartbeat_timeout` fechar como `"closed"` de propósito (ninguém do outro
  lado é um jeito normal de a sessão acabar, não uma falha do engine). Mas o
  enunciado da Fase 4b nomeia timeout ao lado de crash e kill como causa que
  merece a seção de análise de término — e classificar pelo status fazia
  `:timeout` ser inalcançável, com o timeout aparecendo como "encerramento
  normal". Então o motivo é lido primeiro, e o status só decide o que fazer
  quando não há motivo reportado (fecho gracioso/humano deixa null).
  """

  @type cause :: :normal | :timeout | :kill | :crash | :node_shutdown | :unknown

  @doc """
  Motivos que `Monitor.classify/1` produz, e onde cada um cai:

    * `{"heartbeat_timeout", "closed"}` -> `:timeout`
    * `{"killed", "closed_abnormally"}` -> `:kill`
    * `{Exception.message(e), "closed_abnormally"}` -> `:crash`
    * `{"normal", "closed_abnormally"}` -> `:unknown` (o processo saiu limpo
      mas a api não esperava a parada — anormal sem causa identificada)
    * motivo `nil` com `"closed"` -> `:normal` (fecho gracioso/humano)
  """
  @spec classify(String.t() | nil, String.t()) :: cause()
  def classify(reason, status) when is_binary(reason) do
    cond do
      String.contains?(reason, "heartbeat_timeout") -> :timeout
      # ANTES do catch-all de `closed_abnormally`, senão o drain de shutdown
      # apareceria como `:crash` e o Psicólogo levantaria hipótese sobre um
      # defeito que não existe.
      String.contains?(reason, "node_shutdown") -> :node_shutdown
      reason =~ ~r/kill/i -> :kill
      reason == "normal" and status == "closed_abnormally" -> :unknown
      status == "closed_abnormally" -> :crash
      true -> :normal
    end
  end

  # Sem motivo reportado: fecho gracioso deixa `termination_reason` null.
  def classify(nil, "closed"), do: :normal
  def classify(nil, "closed_abnormally"), do: :unknown
  def classify(_reason, _status), do: :unknown

  @doc """
  Toda causa que não seja `:normal` exige a seção de análise de término —
  é ISTO que a api valida (via a `cause` no payload de `emit_hypotheses`),
  em vez de olhar só `status == "closed_abnormally"`, que deixava timeout
  de fora.
  """
  @spec abnormal?(cause()) :: boolean()
  def abnormal?(cause), do: cause != :normal

  @doc "Rótulo pt-BR pra causa, usado no prompt do Psicólogo."
  @spec label(cause()) :: String.t()
  def label(:normal), do: "encerramento normal"
  def label(:timeout), do: "timeout de heartbeat (ninguém reconectou)"
  def label(:kill), do: "processo morto externamente (kill)"
  def label(:crash), do: "crash (exceção no processo da sessão)"

  def label(:node_shutdown),
    do: "réplica do engine desligada (rollout ou scale-down), sessão não adotada"

  def label(:unknown), do: "parada inesperada, sem causa identificada"
end
