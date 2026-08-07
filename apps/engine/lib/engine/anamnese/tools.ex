defmodule Engine.Anamnese.Tools do
  @moduledoc """
  Registro de ferramentas da Anamnese (Fase 4b): emitir perfil
  (obrigatória, termina a rodada), propor patch de instrução e propor
  subir o teto de paralelismo (as duas opcionais). Sem
  `terminal`/`write_file`/`read_file` — a análise é puramente sobre o
  contexto injetado, mesma restrição estrutural do Psicólogo.

  As duas opcionais têm a mesma forma e a mesma garantia: viram
  `proposed_action` que NUNCA se auto-aprova. A Anamnese aponta; quem
  decide é o usuário.
  """

  alias Engine.Anamnese.Tools.{
    EmitProficiency,
    ProposeInstructionPatch,
    ProposeMaxParallel,
    SkipProficiency
  }

  @registry [EmitProficiency, ProposeInstructionPatch, ProposeMaxParallel, SkipProficiency]

  def registry, do: @registry

  @doc """
  Extrai a mensagem útil de um erro da api pra devolver ao modelo — é ELA
  que guia a correção no próximo turno, então não pode virar um
  `inspect/1` de tuple cru.
  """
  def describe({_status, %{"message" => message}}) when is_binary(message), do: message

  def describe({_status, %{"message" => [message | _]}}) when is_binary(message),
    do: message

  def describe(reason), do: inspect(reason)
end
