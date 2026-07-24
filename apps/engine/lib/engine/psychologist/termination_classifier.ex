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
  """

  @type cause :: :normal | :timeout | :kill | :crash | :unknown

  @spec classify(String.t() | nil, String.t()) :: cause()
  def classify(_reason, "closed"), do: :normal

  def classify(reason, "closed_abnormally") when is_binary(reason) do
    cond do
      String.contains?(reason, "heartbeat_timeout") -> :timeout
      reason =~ ~r/kill/i -> :kill
      true -> :crash
    end
  end

  def classify(_reason, "closed_abnormally"), do: :unknown
  def classify(_reason, _status), do: :unknown

  @doc "Rótulo pt-BR pra causa, usado no prompt do Psicólogo."
  @spec label(cause()) :: String.t()
  def label(:normal), do: "encerramento normal"
  def label(:timeout), do: "timeout de heartbeat (ninguém reconectou)"
  def label(:kill), do: "processo morto externamente (kill)"
  def label(:crash), do: "crash (exceção no processo da sessão)"
  def label(:unknown), do: "causa desconhecida (sem motivo reportado)"
end
