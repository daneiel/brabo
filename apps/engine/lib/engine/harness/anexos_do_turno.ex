defmodule Engine.Harness.AnexosDoTurno do
  @moduledoc """
  Os anexos de imagem/arquivo do chat chegam ao LLM SÓ no turno em que a
  mensagem chegou (AT-715, RN-990, decisão do dono: reenvio só no turno em
  que chegou).

  Mesmo desenho do `PerfilDoAutor`: `TurnoAssincrono` põe os anexos no
  dicionário do processo ao subir o turno (a Task os herda), e a fachada
  `EngineApiClient` chama `anexar/1` em cada chamada de LLM. A PRIMEIRA
  chamada do turno troca o `content` da última mensagem `user` pela lista de
  partes (`text` + uma parte `anexo` por id; o engine nunca carrega bytes, a
  api resolve) e CONSOME o dicionário: as iterações seguintes do laço de
  ferramentas e os turnos seguintes mandam só o texto com o rótulo
  `[anexos: a.png, b.txt]` (`rotulo/1`), que também é o que a reidratação
  devolve. Mensagem sem anexos não muda (string).
  """

  @chave :brabo_anexos_do_turno
  @teto_do_rotulo 300

  @doc "Roda `fun` com os anexos no dicionário e o RESTAURA ao sair."
  def com_anexos(anexos, fun) when is_function(fun, 0) do
    anterior = Process.get(@chave)

    case lista(anexos) do
      [] -> Process.delete(@chave)
      l -> Process.put(@chave, l)
    end

    try do
      fun.()
    after
      if anterior, do: Process.put(@chave, anterior), else: Process.delete(@chave)
    end
  end

  @doc "O rótulo textual dos anexos (vazio sem anexos), cortado no teto da cauda."
  @spec rotulo(term()) :: String.t()
  def rotulo(anexos) do
    case lista(anexos) do
      [] ->
        ""

      l ->
        nomes = "[anexos: " <> Enum.map_join(l, ", ", & &1["nome"]) <> "]"

        " " <>
          if String.length(nomes) > @teto_do_rotulo,
            do: String.slice(nomes, 0, @teto_do_rotulo - 2) <> "…]",
            else: nomes
    end
  end

  @doc "Só a PRIMEIRA chamada do turno leva as partes; a seguinte volta intacta."
  @spec anexar([map()]) :: [map()]
  def anexar(messages) when is_list(messages) do
    case Process.delete(@chave) do
      [_ | _] = anexos ->
        case Enum.find_index(Enum.reverse(messages), &(&1["role"] == "user")) do
          nil ->
            messages

          i ->
            alvo = length(messages) - 1 - i

            List.update_at(messages, alvo, fn m ->
              partes =
                [%{"type" => "text", "text" => to_string(m["content"])}] ++
                  for a <- anexos, do: %{"type" => "anexo", "id" => a["id"]}

              Map.put(m, "content", partes)
            end)
        end

      _ ->
        messages
    end
  end

  def anexar(messages), do: messages

  @doc "Só os anexos bem formados (id e nome textuais), o teto de 4 por mensagem é da api e do controller."
  def lista(anexos) when is_list(anexos) do
    anexos
    |> Enum.filter(&(is_map(&1) and is_binary(&1["id"]) and is_binary(&1["nome"])))
  end

  def lista(_), do: []
end
