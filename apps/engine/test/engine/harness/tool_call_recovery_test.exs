defmodule Engine.Harness.ToolCallRecoveryTest do
  use ExUnit.Case, async: true

  alias Engine.Harness.ToolCallRecovery

  @ferramentas ["write_file", "read_file", "terminal", "emit_qa_verdict"]

  test "bloco ```json com VÁRIAS tool calls concatenadas (o caso real do demo)" do
    # Texto reproduzido da primeira execução do critério de aceite dos gates:
    # o qwen2.5-coder:7b produziu o trabalho certo, mas em texto — o ToolLoop
    # via toolCalls vazio e a task morria como "parou sem concluir".
    conteudo = """
    ```json
    {"name": "write_file", "arguments": {"path": "src/cliente.js", "content": "const TOKEN = \\"ghp_abc\\";\\nmodule.exports = { enviar };"}}
    {"name": "write_file", "arguments": {"path": "test/cliente.test.js", "content": "const test = require('node:test');"}}
    {"name": "terminal", "arguments": {"command": "npm test"}}
    ```
    """

    assert [primeira, segunda, terceira] = ToolCallRecovery.from_content(conteudo, @ferramentas)

    assert primeira["name"] == "write_file"
    assert primeira["arguments"]["path"] == "src/cliente.js"
    # Chaves DENTRO de string escapada não podem confundir a contagem.
    assert primeira["arguments"]["content"] =~ ~s(const TOKEN = "ghp_abc")
    assert primeira["arguments"]["content"] =~ "module.exports = { enviar };"

    assert segunda["arguments"]["path"] == "test/cliente.test.js"
    assert terceira["name"] == "terminal"
    assert terceira["arguments"]["command"] == "npm test"
  end

  test "objeto JSON solto, sem cerca de código" do
    assert [chamada] =
             ToolCallRecovery.from_content(
               ~s(Vou rodar a suite: {"name": "terminal", "arguments": {"command": "npm test"}}),
               @ferramentas
             )

    assert chamada["name"] == "terminal"
    assert chamada["id"] == nil
  end

  test "argumentos aninhados preservam a estrutura" do
    assert [chamada] =
             ToolCallRecovery.from_content(
               ~s({"name": "emit_qa_verdict", "arguments": {"veredito": "approved", "coverageMatrix": [{"rule": "RF1", "covered": true}]}}),
               @ferramentas
             )

    assert chamada["arguments"]["veredito"] == "approved"
    assert [%{"rule" => "RF1", "covered" => true}] = chamada["arguments"]["coverageMatrix"]
  end

  test "texto sem tool call nenhuma: lista vazia (o loop encerra como antes)" do
    assert [] =
             ToolCallRecovery.from_content("Terminei a análise, está tudo certo.", @ferramentas)

    assert [] = ToolCallRecovery.from_content("", @ferramentas)
    assert [] = ToolCallRecovery.from_content(nil, @ferramentas)
  end

  test "`parameters` é aceito como sinônimo de `arguments`" do
    assert [chamada] =
             ToolCallRecovery.from_content(
               ~s[{"name": "terminal", "parameters": {"command": "npm test"}}],
               @ferramentas
             )

    assert chamada["arguments"]["command"] == "npm test"
  end

  test "nome que NÃO é ferramenta registrada é ignorado" do
    # O caso real que motivou ancorar no registro: o QA alucinou uma chamada à
    # função de NEGÓCIO que estava revisando. Despachar isso viraria uma tool
    # call inexistente; sem o filtro, qualquer JSON com name+arguments passava.
    assert [] =
             ToolCallRecovery.from_content(
               ~s[{"name": "enviar(payload)", "parameters": {"payload": "x", "token": "ghp_x"}}],
               @ferramentas
             )
  end

  test "JSON que não é tool call é ignorado" do
    assert [] = ToolCallRecovery.from_content(~s({"resultado": "ok", "total": 3}), @ferramentas)
    assert [] = ToolCallRecovery.from_content(~s({"name": "terminal"}), @ferramentas)

    assert [] =
             ToolCallRecovery.from_content(
               ~s({"name": "terminal", "arguments": "npm test"}),
               @ferramentas
             )

    assert [] = ToolCallRecovery.from_content(~s({"name": "", "arguments": {}}), @ferramentas)
  end

  test "JSON malformado não derruba nada" do
    assert [] =
             ToolCallRecovery.from_content(
               ~s[{"name": "terminal", "arguments": {],
               @ferramentas
             )
  end
end
