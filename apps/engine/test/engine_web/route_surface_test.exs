defmodule EngineWeb.RouteSurfaceTest do
  @moduledoc """
  Revisão da superfície exposta do engine (Fase 5, item 5).

  O par deste teste é o `route-surface.spec.ts` da api, e a garantia é a mesma:
  nenhuma rota entra no sistema sem alguém decidir conscientemente se ela é
  aberta ou autenticada.

  ## Por que ele testa COMPORTAMENTO, e não metadado

  A primeira versão lia o `pipe_through` de cada rota e conferia se as
  `/internal` estavam no pipeline certo. Duas coisas mataram essa abordagem:
  `EngineWeb.Router.__routes__/0` nesta versão do Phoenix não expõe pipeline
  nenhum, e — mais importante — mesmo que expusesse, ela afirmaria sobre a
  ANOTAÇÃO. Um pipeline `:internal` esvaziado por engano continuaria "correto"
  para um teste desses, com a proteção tendo sumido.

  Aqui cada rota registrada recebe uma requisição SEM token, e o que se afirma
  é o que o cliente veria: 401 para tudo que não está na lista de exceções.
  É a diferença entre verificar que a fechadura está documentada e verificar
  que a porta está trancada.

  ## As rotas sem autenticação

  Quatro, e todas chamadas por infraestrutura que não carrega token do
  Keycloak: as três probes (kubelet) e o `/metrics` (Prometheus). A exposição
  delas é contida por REDE — a NetworkPolicy só libera o namespace
  `monitoring`, e o Ingress de produção bloqueia `/metrics` e `/internal`.
  Justificativa completa em `docs/security-surface.md`.
  """
  use EngineWeb.ConnCase, async: false

  # As ÚNICAS rotas que respondem sem token. Acrescentar uma aqui é decisão de
  # segurança e exige mexer neste arquivo — que é exatamente o ponto.
  @sem_auth [
    {"GET", "/health"},
    {"GET", "/live"},
    {"GET", "/ready"},
    {"GET", "/metrics"}
  ]

  defp rotas do
    Enum.map(EngineWeb.Router.__routes__(), fn r ->
      {r.verb |> Atom.to_string() |> String.upcase(), r.path}
    end)
  end

  # Troca `:param` por um valor sintético. O valor não importa: a autenticação
  # roda ANTES do controller, então uma rota protegida devolve 401 sem nunca
  # olhar o parâmetro.
  defp concretizar(caminho) do
    caminho
    |> String.split("/")
    |> Enum.map_join("/", fn
      ":" <> _ -> "00000000-0000-0000-0000-000000000000"
      segmento -> segmento
    end)
  end

  defp requisitar(conn, "GET", caminho), do: get(conn, caminho)
  defp requisitar(conn, "POST", caminho), do: post(conn, caminho, %{})
  defp requisitar(conn, "PUT", caminho), do: put(conn, caminho, %{})
  defp requisitar(conn, "PATCH", caminho), do: patch(conn, caminho, %{})
  defp requisitar(conn, "DELETE", caminho), do: delete(conn, caminho)

  test "a aplicação registra rotas (guarda contra o teste passar vazio)" do
    # Sem isto, uma mudança que zerasse a enumeração faria as asserções abaixo
    # aprovarem conjuntos vazios — o modo de falha clássico de teste de tabela.
    assert length(rotas()) >= 10
  end

  test "TODA rota fora da lista recusa requisição sem token", %{conn: conn} do
    vazadas =
      rotas()
      |> Enum.reject(&(&1 in @sem_auth))
      |> Enum.filter(fn {verbo, caminho} ->
        resposta = requisitar(conn, verbo, concretizar(caminho))
        resposta.status != 401
      end)

    assert vazadas == [], """
    Rota(s) respondendo SEM autenticação que deveriam exigir token:

    #{Enum.map_join(vazadas, "\n", fn {v, c} -> "  #{v} #{c}" end)}

    Ou a rota entrou no escopo errado do router (fora do `scope "/internal"`,
    que é quem passa pelo VerifyApiToken), ou ela é intencionalmente pública —
    e nesse caso precisa de justificativa em docs/security-surface.md e de uma
    linha em @sem_auth.
    """
  end

  test "as rotas sem autenticação são exatamente as quatro justificadas", %{conn: conn} do
    abertas =
      rotas()
      |> Enum.filter(fn {verbo, caminho} ->
        requisitar(conn, verbo, concretizar(caminho)).status != 401
      end)
      |> Enum.sort()

    assert abertas == Enum.sort(@sem_auth), """
    A superfície SEM autenticação do engine mudou.

    Esperado: #{inspect(Enum.sort(@sem_auth))}
    Encontrado: #{inspect(abertas)}
    """
  end

  test "as rotas /internal continuam sob o VerifyApiToken", %{conn: conn} do
    # Redundante com o primeiro teste por construção, e de propósito: se um dia
    # alguém acrescentar `/internal/...` à lista de exceções, esta asserção
    # ainda reprova. É a superfície de comando api→engine; ela não tem caso de
    # uso legítimo sem token.
    internas = Enum.filter(rotas(), fn {_v, c} -> String.starts_with?(c, "/internal") end)
    assert internas != [], "nenhuma rota /internal encontrada — o router mudou de forma?"

    for {verbo, caminho} <- internas do
      resposta = requisitar(conn, verbo, concretizar(caminho))

      assert resposta.status == 401,
             "#{verbo} #{caminho} respondeu #{resposta.status} sem token; esperado 401"
    end
  end
end
