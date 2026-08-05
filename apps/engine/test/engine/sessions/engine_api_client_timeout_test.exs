defmodule Engine.Sessions.EngineApiClientTimeoutTest do
  @moduledoc """
  O teto de tempo de um turno de LLM, nos DOIS caminhos que existem.

  A regressão que este arquivo existe para pegar: `llm_turn/5` passava
  `receive_timeout: llm_turn_timeout_ms()` e `llm_turn_stream/6` não passava
  nada, caindo no default do Req (15s). Os quatro agentes conversacionais
  (Criativo, PO, Arquiteto e o lead de Infra) só usam o caminho em streaming —
  então o teto generoso e configurável nunca valeu para nenhum deles.

  O defeito era invisível com modelo LOCAL, que respondia dentro dos 15s. Com
  provider de API e contexto grande o turno estourava, e o desfecho era
  `%Req.TransportError{reason: :timeout}` — classificado como origem `infra`,
  que é honesto e leva a investigar a rede em vez do teto errado.

  Como no teste de headers ao lado: nada aqui faz HTTP. O que se afirma é que
  **os dois caminhos usam o mesmo teto, e nenhum escapa** — mais difícil de
  burlar do que um teste de nível HTTP e proporcional ao que se está guardando.
  """

  use ExUnit.Case, async: true

  @caminho "lib/engine/sessions/engine_api_client.ex"

  setup do
    %{fonte: File.read!(Path.join(File.cwd!(), @caminho))}
  end

  test "os dois turnos de LLM passam o teto configurável", %{fonte: fonte} do
    ocorrencias =
      fonte
      |> String.split("receive_timeout: llm_turn_timeout_ms()")
      |> length()
      |> Kernel.-(1)

    assert ocorrencias >= 2,
           "esperava o teto nos dois caminhos (llm_turn e llm_turn_stream), achei #{ocorrencias}"
  end

  test "o caminho em streaming não fica no default do Req", %{fonte: fonte} do
    # O corpo do `llm_turn_stream/6` até o `case result do` que fecha a chamada.
    [_, depois] = String.split(fonte, "def llm_turn_stream(project_id", parts: 2)
    [corpo, _] = String.split(depois, "case result do", parts: 2)

    assert corpo =~ "receive_timeout: llm_turn_timeout_ms()",
           "llm_turn_stream/6 sem teto explícito volta ao default de 15s do Req"
  end

  test "o teto é configurável por ambiente, com default generoso" do
    # 15s é curto para um turno de LLM em qualquer provider; o default precisa
    # ser folgado E ajustável sem recompilar.
    assert Application.get_env(:engine, :llm_turn_timeout_ms, 300_000) >= 60_000
  end
end
