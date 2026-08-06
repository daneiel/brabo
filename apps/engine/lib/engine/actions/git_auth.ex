defmodule Engine.Actions.GitAuth do
  @moduledoc """
  Injeta a credencial de um remoto autenticado **por invocação** de git
  (ADR 0056, decisão 2).

  ## Por que não a URL com token

  O caminho que todo tutorial ensina é
  `git remote add origin https://x-access-token:TOKEN@github.com/…`. Isso grava
  a credencial em texto puro no `.git/config` — que fica **dentro da pasta do
  projeto**, exatamente onde a [RN-075] deu ao dev agent leitura
  **auto-aprovada**. Um `cat .git/config` devolveria o token sem passar por
  aprovação nenhuma, e ele viajaria ao provider de LLM no histórico do laço.

  O escopo de caminho protege contra o agente ler para FORA do projeto. Ele não
  tem como proteger contra um segredo que o próprio produto colocou DENTRO.

  ## Onde o token vive, então

  No **ambiente do processo filho**, durante a chamada, e em nenhum outro
  lugar:

  - **não em argv** — `ps` mostra a linha de comando de qualquer processo;
  - **não em arquivo** — nem `.git/config`, nem helper persistido, nem
    `~/.git-credentials`;
  - **não no `origin`** — o remoto guarda a URL limpa.

  O helper é passado por `-c`, vale só para aquele processo, e vem depois de um
  `credential.helper=` vazio: sem isso, um helper herdado da configuração
  global do host responderia antes do nosso.
  """

  alias Engine.Actions.GitCmd

  @var_usuario "BRABO_GIT_USERNAME"
  @var_token "BRABO_GIT_TOKEN"

  @doc """
  Roda git em `dir` com a autenticação do `remoto`, quando houver.

  Remoto sem token (provider `local`) passa direto para o `GitCmd`: não há o
  que injetar, e o caminho local é o que a suite inteira exercita.
  """
  def run(dir, args, remoto) do
    GitCmd.run(dir, args_de_auth(remoto) ++ args, env: env_de_auth(remoto))
  end

  @doc "Os `-c` que instalam o helper efêmero. Lista vazia sem token."
  def args_de_auth(%{token: token}) when is_binary(token) and token != "" do
    [
      # Zera o que vier da config global do host ANTES de instalar o nosso —
      # helpers são acumulativos e o primeiro a responder ganha.
      "-c",
      "credential.helper=",
      "-c",
      "credential.helper=" <> helper()
    ]
  end

  def args_de_auth(_), do: []

  @doc "O ambiente do processo filho. Lista vazia sem token."
  def env_de_auth(%{token: token} = remoto) when is_binary(token) and token != "" do
    [
      {@var_usuario, Map.get(remoto, :username) || "x-access-token"},
      {@var_token, token}
    ]
  end

  def env_de_auth(_), do: []

  # `!f(){...};f` é a forma de helper "comando de shell" do git. Ele lê as
  # variáveis do ambiente que `env_de_auth/1` põe, então o segredo nunca
  # aparece nem aqui dentro (esta string é constante e não contém o token).
  defp helper do
    "!f(){ echo username=$#{@var_usuario}; echo password=$#{@var_token}; };f"
  end
end
