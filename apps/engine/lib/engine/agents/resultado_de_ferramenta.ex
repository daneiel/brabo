defmodule Engine.Agents.ResultadoDeFerramenta do
  @moduledoc """
  O payload do `tool.result` dos agentes conversacionais (RN-589, AT-151).

  Até aqui só o Criativo gravava `tool.result`, e sem o texto que a ferramenta
  devolveu: o agente reidratado (RN-580) sabia QUE chamou `create_epic`, não o
  id do épico que ela respondeu. Este módulo é o ÚNICO lugar que monta o
  payload, para os seis servidores não divergirem.

  O texto é CORTADO em #{2_000} caracteres (`teto/0`) — o resultado de uma
  ferramenta pode ser uma listagem grande, e o event log é lido por todo
  membro do projeto e entra no backup. Quando corta, `resultadoTotal` diz o
  tamanho REAL (ADR 0060: teto que trunca declara o total). Aditivo: quem
  lia `tool`/`ok`/`erro` continua lendo; evento antigo não muda.
  """

  @teto 2_000

  @spec teto() :: pos_integer()
  def teto, do: @teto

  @spec payload(String.t(), {:ok | :error, term()}) :: map()
  def payload(tool, {:ok, texto}) do
    texto = to_string(texto)
    base = %{tool: tool, ok: true, resultado: cortar(texto)}
    total(base, texto)
  end

  def payload(tool, {:error, texto}) do
    texto = to_string(texto)
    base = %{tool: tool, ok: false, erro: cortar(texto)}
    total(base, texto)
  end

  defp total(base, texto) do
    if String.length(texto) > @teto,
      do: Map.put(base, :resultadoTotal, String.length(texto)),
      else: base
  end

  defp cortar(texto), do: String.slice(texto, 0, @teto)
end
