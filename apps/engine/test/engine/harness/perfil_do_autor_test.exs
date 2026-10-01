defmodule Engine.Harness.PerfilDoAutorTest do
  @moduledoc """
  RN-680 (ADR 0196): os fatos do perfil do AUTOR entram no turno dele como
  mensagem de sistema EFÊMERA — pelo mesmo dicionário de processo do idioma
  (RN-622), sem tocar servidor de agente.
  """

  use ExUnit.Case, async: true

  alias Engine.Harness.PerfilDoAutor

  @historico [%{"role" => "user", "content" => "oi"}]

  test "caminho feliz: com perfil, a mensagem de sistema vai no FIM" do
    enviado =
      PerfilDoAutor.com_perfil("Fatos do perfil: prefere uma pergunta por vez", fn ->
        PerfilDoAutor.anexar(@historico, "po")
      end)

    assert List.last(enviado) == %{
             "role" => "system",
             "content" => "Fatos do perfil: prefere uma pergunta por vez"
           }

    assert length(enviado) == 2
  end

  test "sem perfil (turno sem autor, ou api sem fatos): lista intacta" do
    assert PerfilDoAutor.anexar(@historico, "po") == @historico

    assert PerfilDoAutor.com_perfil(nil, fn -> PerfilDoAutor.anexar(@historico, "po") end) ==
             @historico
  end

  test "o perfil não sobrevive ao handle_call que o pôs" do
    PerfilDoAutor.com_perfil("fatos", fn -> :ok end)

    assert PerfilDoAutor.anexar(@historico, "po") == @historico
  end

  test "o sumarizador da compactação fica de fora" do
    enviado =
      PerfilDoAutor.com_perfil("fatos", fn ->
        PerfilDoAutor.anexar(@historico, "context-manager")
      end)

    assert enviado == @historico
  end

  test "falha: texto acima do teto é cortado, nunca derruba o turno" do
    longo = String.duplicate("x", PerfilDoAutor.teto_de_caracteres() + 500)

    [_, %{"content" => conteudo}] =
      PerfilDoAutor.com_perfil(longo, fn -> PerfilDoAutor.anexar(@historico, "po") end)

    assert String.length(conteudo) == PerfilDoAutor.teto_de_caracteres()
  end
end
