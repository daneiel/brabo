defmodule Engine.Harness.Tools.RecusaDeHistoria do
  @moduledoc """
  O texto que `update_story`/`archive_story` (RN-727) devolvem ao modelo
  quando a api recusa. O 409 da api vem com `reason` nomeado
  (`historia_arquivada`, `historia_nao_draft`,
  `historia_com_tarefa_em_execucao`) e `message` legível — os dois vão ao
  modelo, para ele saber o que houve sem adivinhar.
  """

  def texto({status, %{"reason" => reason, "message" => message}}) when is_integer(status),
    do: "#{reason} — #{message}"

  def texto({status, %{"message" => message}}) when is_integer(status) and is_binary(message),
    do: message

  def texto(outro), do: inspect(outro)
end
