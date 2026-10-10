defmodule Engine.Dev.MensagemDeCommitTest do
  # RN-781 (AT-464): a mensagem de commit não grava a pendência falsa que o
  # modelo narra no resumo do `report_done`.
  use ExUnit.Case, async: true

  alias Engine.Dev.AgentIo

  test "corta a narração de commit/PR pendente do fim do resumo" do
    resumo =
      "Validação de URL implementada; suite com exit 0. Pendente: commit com a " <>
        "identidade do agente e abertura do PR; as ações git_commit, git_push e " <>
        "pr_open não estavam disponíveis neste passo."

    assert AgentIo.mensagem_de_commit(resumo) ==
             "Validação de URL implementada; suite com exit 0."
  end

  test "tira o parêntese \"(ainda sem commit…)\" e mantém o resto" do
    assert AgentIo.mensagem_de_commit(
             "Implementado o comando `npm run user:create` em encurtador-api " <>
               "(ainda sem commit; commit e PR vêm nos próximos passos)."
           ) == "Implementado o comando `npm run user:create` em encurtador-api."
  end

  test "pendência que não fala do sistema fica no texto" do
    resumo = "Rota criada. Pendente: decidir o formato da data com o PO."
    assert AgentIo.mensagem_de_commit(resumo) == resumo
  end
end
