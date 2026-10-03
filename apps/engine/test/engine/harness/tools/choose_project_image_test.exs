defmodule Engine.Harness.Tools.ChooseProjectImageTest do
  use ExUnit.Case, async: true

  alias Engine.Harness.Tools.ChooseProjectImage

  test "rede none: o resultado diz que gerenciador de pacotes não instala e aponta egress (RN-735)" do
    msg = ChooseProjectImage.mensagem_de_fixada(2, %{"image" => "node:22", "network" => "none"})
    assert msg =~ "rede none"
    assert msg =~ "npm"
    assert msg =~ "network \"egress\""
  end

  test "rede egress: sem aviso" do
    msg = ChooseProjectImage.mensagem_de_fixada(1, %{"image" => "node:22", "network" => "egress"})
    refute msg =~ "ATENÇÃO"
  end

  test "a descrição da ferramenta diz que none impede instalar dependências" do
    assert ChooseProjectImage.spec().description =~ "gerenciador de pacotes"
  end
end
