defmodule EngineWeb.ForceSslExclusions do
  @moduledoc """
  Quem escapa do `force_ssl` do endpoint (Fase 5).

  ## Por que não dá para fazer isso com `exclude: [paths: [...]]`

  O `Plug.SSL` normaliza os paths com `Plug.Router.Utils.split/1` no `init` e
  compara `conn.path_info in paths` — casamento **exato** do caminho inteiro.
  Serve para `/live`, que é um caminho só; não serve para `/internal/*`, que
  tem mais de vinte rotas. Listar todas seria uma lista que se desatualiza no
  primeiro endpoint novo, e o modo de falha é um 301 no meio de uma chamada
  entre serviços.

  ## O que escapa, e por quê

  **Probes** (`/health`, `/live`, `/ready`) e **scrape** (`/metrics`): o
  kubelet e o Prometheus chegam pelo IP do pod, não por `localhost`, então a
  exclusão por host não os cobre. Sem isto o pod nunca fica Ready.

  **`/internal/*`**: é a api falando com o engine dentro do cluster. O TLS
  termina no ingress; o engine não tem listener HTTPS, e a api não manda
  `x-forwarded-proto: https` — então `force_ssl` aqui não protege nada e
  **quebra tudo**: a ativação de sessão virava um 301 para `https://localhost`.
  A proteção dessas rotas é outra: token de client credentials
  (`VerifyServiceToken`), NetworkPolicy, e bloqueio na borda pelo Ingress de
  produção.

  Este defeito viveu desde a sessão 2 sem ninguém ver, porque nenhum smoke
  ativava uma sessão — criar sessão não chama o engine; transicioná-la para
  `active` é que chama.
  """

  @probe_paths [["health"], ["live"], ["ready"], ["metrics"]]

  @doc "Callback do `exclude: [conn: {…}]` do `Plug.SSL`."
  def exclude?(conn) do
    conn.path_info in @probe_paths or match?(["internal" | _], conn.path_info)
  end
end
