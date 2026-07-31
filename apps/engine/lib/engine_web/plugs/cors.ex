defmodule EngineWeb.Plugs.Cors do
  @moduledoc """
  CORS para as rotas de health do engine — as únicas que um NAVEGADOR consome
  (ADR 0037).

  ## O que estava quebrado

  O endpoint não tinha CORS nenhum. `GET /health` respondia 200 com o corpo
  correto, e o navegador **descartava a resposta** por não haver
  `Access-Control-Allow-Origin`: a `StatusPage` mostrava o engine como `error`
  com ele perfeitamente saudável. Reproduzido dos dois lados — `curl -H "Origin:
  http://localhost:5173"` devolvendo 200 sem cabeçalho algum de CORS, e o Chrome
  registrando `blocked by CORS policy` no console.

  O canal Phoenix nunca sofreu disso: WebSocket não passa por CORS, e o
  `check_origin` do endpoint já lia `WEB_ORIGIN` desde a Fase 4a. Era só o
  caminho HTTP — e justamente o único que a web busca por `fetch`.

  ## Por que um plug próprio, e não o Corsica

  O `Corsica` é a escolha óbvia e resolve muito mais do que se precisa: este plug
  atende `GET`/`HEAD`, sem credencial, em três caminhos fixos. São ~40 linhas de
  lógica contra uma dependência nova, e o `CLAUDE.md` pede justificativa para lib
  nova. Se um dia o engine expuser API de navegador de verdade — `POST`, cookie,
  cabeçalho próprio — a troca por Corsica passa a se pagar, e este moduledoc é o
  registro de que a decisão foi consciente, não desconhecimento da alternativa.

  ## Por que no ENDPOINT e não num pipeline do router

  Pipeline de router só roda depois de uma rota casar. Não existe rota `OPTIONS`,
  então um preflight morre com 404 antes de qualquer plug do pipeline — foi
  medido: `OPTIONS /health` respondia 404 com a página de erro do Phoenix.
  Um plug de CORS que não vê preflight é um plug de CORS pela metade, e a metade
  que falta é a que quebra no dia em que a web acrescentar um cabeçalho.

  No endpoint ele vê tudo, e o preço é ter de dizer explicitamente ONDE se aplica.
  É o mesmo desenho do `EngineWeb.Plugs.AccessLog`, que também filtra por prefixo
  de caminho por não poder depender do router.

  ## A allowlist de caminho é a fronteira de segurança

  Só `/health`, `/live` e `/ready`. Duas exclusões deliberadas:

  - **`/internal/*`** — as 13 rotas por onde a api comanda o engine, autenticadas
    por segredo compartilhado (RN-035). Servidor não faz CORS: quem chama é o
    cliente HTTP da api, que ignora esses cabeçalhos (verificado — a chamada
    responde igual com e sem `Origin`). Anunciar CORS ali não habilita nada de
    útil e diz a um navegador que ele é um cliente esperado daquelas rotas.
  - **`/metrics`** — scrape do Prometheus. Métrica interna não tem por que ser
    legível por JavaScript de página nenhuma.

  ## As origens são as mesmas do resto do sistema

  `WEB_ORIGIN`, via `:web_origins` no `runtime.exs` — a mesma lista que alimenta o
  `check_origin` do socket, e a mesma variável que a api usa. Foi a leitura
  DUPLICADA dessa variável que permitiu os dois divergirem.

  Origem desconhecida não recebe o cabeçalho, e o pedido é atendido normalmente:
  quem barra a leitura é o navegador. Responder 403 transformaria uma requisição
  legítima sem `Origin` (probe do kubelet, `curl`, o `docker/smoke.sh`) num modo
  de falha diferente por acidente.

  `vary: origin` é obrigatório, não enfeite: sem ele um proxy que guarde a
  resposta de uma origem pode entregá-la a outra, com o cabeçalho errado dentro.
  """

  @behaviour Plug

  import Plug.Conn

  @doc """
  Caminhos em que o CORS se aplica. Público para o teste poder afirmar que
  `/internal` e `/metrics` estão FORA — é a asserção que guarda a fronteira.
  """
  def caminhos_de_navegador, do: ["/health", "/live", "/ready"]

  # `GET`/`HEAD` cobrem tudo o que o navegador faz aqui. `OPTIONS` está na lista
  # porque é o que o preflight pergunta, não porque exista rota `OPTIONS`.
  @metodos "GET, HEAD, OPTIONS"

  # Nada fora da safelist é usado hoje — `fetchHealth` manda um `GET` cru, e é por
  # isso que o caso simples funciona sem preflight. `traceparent` está aqui pelo
  # mesmo motivo que na api: se a web instrumentar esta chamada como instrumenta as
  # outras, o preflight não passa a falhar por um cabeçalho que a lista esqueceu.
  # É exatamente o modo de falha que o ADR 0035 descreveu do outro lado.
  @cabecalhos "Content-Type, traceparent"

  @impl Plug
  def init(opts), do: opts

  @impl Plug
  def call(conn, _opts) do
    with true <- de_navegador?(conn.request_path),
         [origem | _] <- get_req_header(conn, "origin") do
      aplicar(conn, origem)
    else
      # Caminho fora da allowlist, ou requisição sem `Origin` (probe, scrape,
      # curl): segue sem tocar em cabeçalho nenhum.
      _ -> conn
    end
  end

  defp de_navegador?(caminho) do
    Enum.any?(caminhos_de_navegador(), fn permitido ->
      caminho == permitido or String.starts_with?(caminho, permitido <> "/")
    end)
  end

  defp aplicar(conn, origem) do
    conn =
      if origem in origens_permitidas() do
        conn
        |> put_resp_header("access-control-allow-origin", origem)
        |> put_resp_header("vary", "origin")
      else
        conn
      end

    encerrar_preflight(conn)
  end

  # O preflight é respondido AQUI, inclusive para origem desconhecida: deixá-lo
  # seguir para o router daria 404, que é uma pista errada sobre a causa. Sem o
  # `allow-origin` acima, o navegador barra de qualquer forma.
  defp encerrar_preflight(%Plug.Conn{method: "OPTIONS"} = conn) do
    conn
    |> put_resp_header("access-control-allow-methods", @metodos)
    |> put_resp_header("access-control-allow-headers", @cabecalhos)
    # 10 minutos. Sem isto o navegador refaria o preflight a cada chamada, e a
    # `StatusPage` consulta de 5 em 5 segundos.
    |> put_resp_header("access-control-max-age", "600")
    |> send_resp(:no_content, "")
    |> halt()
  end

  defp encerrar_preflight(conn), do: conn

  @doc """
  Origens aceitas. Lê a config, não o ambiente: quem traduz `WEB_ORIGIN` é o
  `runtime.exs`, num lugar só.
  """
  def origens_permitidas, do: Application.get_env(:engine, :web_origins, [])
end
