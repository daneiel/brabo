# 0037 — O CORS que o engine não tinha, e a porta como parte do contrato

## Contexto

Um relato de "problema de CORS entre o web e a api" levou a uma verificação dos
**três pares** de comunicação do sistema. O resultado foi um par quebrado, um
par que nunca esteve em risco, e uma causa raiz que não estava em CORS nenhum.

Tudo abaixo foi medido, com `curl -H "Origin: …"` e com Chrome headless lendo o
console — não deduzido da leitura do código.

### O que está certo

| par | mecanismo | veredito |
|---|---|---|
| web → api (HTTP) | CORS do Nest, `WEB_ORIGIN` | **ok** — preflight devolve `allow-origin`, `allow-headers` com os quatro cabeçalhos, `allow-credentials` |
| web → engine (WebSocket) | `check_origin` do Phoenix | **ok** — handshake responde `101`; WebSocket não passa por CORS, e o `check_origin` já lia `WEB_ORIGIN` desde a Fase 4a |
| api → engine (`/internal/*`) | service token (RN-035) | **ok, e CORS não se aplica** — `401` sem token, `400` de validação com token, e resposta IDÊNTICA com e sem `Origin` |
| engine → api (`/internal/*`) | service token | **ok, e CORS não se aplica** — `403` sem token, `400` com token, idem `Origin` |

Os dois últimos merecem ser ditos por extenso, porque a pergunta é natural e a
resposta é estrutural: **CORS é um mecanismo de navegador.** Quem chama nesses
dois sentidos é um cliente HTTP de servidor (o `fetch` do Node na api, o Finch no
engine), que não implementa a same-origin policy e ignora esses cabeçalhos por
completo. Não há o que configurar, e configurar seria pior — ver a decisão 2.

### O que está quebrado: web → engine por HTTP

O endpoint do engine **não tinha CORS nenhum**. `GET /health` respondia `200`
com o corpo correto e sem um único cabeçalho `Access-Control-*`, então o
navegador descartava a resposta:

```
Access to fetch at 'http://localhost:4000/health' from origin
'http://localhost:5173' has been blocked by CORS policy: No
'Access-Control-Allow-Origin' header is present on the requested resource.
```

O efeito visível: a `StatusPage` mostrava **`engine: error`** com o engine
perfeitamente saudável. Nenhum teste pegava isso, e não por descuido — do lado do
servidor a resposta estava correta. O que faltava era um cabeçalho, e teste de
controller não afirma cabeçalho de CORS.

O defeito é anterior a esta sessão, mas ficou mais visível agora: o
[ADR 0036](0036-telas-de-auth-fieis-ao-design-e-fontes-auto-hospedadas.md) tornou
`/status` pública e a ligou no rodapé das telas de auth, então a linha errada
passou a ser alcançável antes do login.

### A causa raiz do relato original, que não era CORS

O `vite.config.ts` fixava `port: 5173` **sem `strictPort`**. Com 5173 ocupada — um
`pnpm dev` esquecido em outro terminal, o compose de dev no mesmo host — o Vite
sobe em **5174** e avisa numa linha do log de boot. A api aceita exatamente
`http://localhost:5173`, então a aplicação abre normal e **tudo** é barrado:

```
blocked by CORS policy: … 'http://localhost:3000/health'      (origin 5174)
blocked by CORS policy: … 'http://localhost:3000/auth/refresh' (origin 5174)
blocked by CORS policy: … 'http://localhost:4000/health'      (origin 5174)
```

O `/auth/refresh` bloqueado é o que faz a tela parecer deslogada. E a mensagem
fala de CORS, não de porta — então o tempo vai todo para o lugar errado. Pior: a
"correção" natural é afrouxar o CORS da api, o que conserta 5174 e quebra 5173.

## Decisão

### 1. Um plug de CORS próprio no engine, em vez do Corsica

`EngineWeb.Plugs.Cors`, ~40 linhas de lógica. O `Corsica` é a escolha óbvia e
resolve muito mais do que se precisa: este plug atende `GET`/`HEAD`, sem
credencial, em três caminhos fixos, com dois cabeçalhos na lista. O `CLAUDE.md`
pede justificativa para lib nova, e "40 linhas" é a justificativa.

Se um dia o engine expuser API de navegador de verdade — `POST`, cookie,
cabeçalho próprio — a troca por Corsica passa a se pagar. O moduledoc registra
isso, para a próxima pessoa saber que a alternativa foi considerada.

### 2. O plug fica no ENDPOINT, e filtra por caminho

Não num pipeline do router, e a razão é mensurável: pipeline de router só roda
depois de uma rota casar. Não existe rota `OPTIONS`, então um preflight morre com
`404` antes de qualquer plug do pipeline — verificado antes da correção
(`OPTIONS /health` → `404`). Um plug de CORS que não vê preflight é meio plug, e
a metade que falta é a que quebra no dia em que a web acrescentar um cabeçalho.

No endpoint ele vê tudo, e o preço é dizer explicitamente onde se aplica. É o
mesmo desenho do `EngineWeb.Plugs.AccessLog`, que também filtra por prefixo de
caminho por não poder depender do router.

**A allowlist é `/health`, `/live` e `/ready`.** Duas exclusões deliberadas, e as
duas são de segurança:

- **`/internal/*`** — as 13 rotas por onde a api comanda o engine. Como
  estabelecido no contexto, CORS não habilitaria nada ali; o que ele faria é
  **anunciar a um navegador que ele é um cliente esperado daquele canal**. É
  informação que não queremos dar, sobre uma superfície que não queremos que
  ninguém tente alcançar do browser.
- **`/metrics`** — scrape do Prometheus. Métrica interna não tem por que ser
  legível por JavaScript de página nenhuma.

### 3. Origem desconhecida recebe resposta, não `403`

O pedido é atendido normalmente e sai **sem** o cabeçalho; quem barra a leitura é
o navegador, que é de quem essa decisão é. Responder `403` transformaria toda
requisição legítima sem `Origin` — probe do kubelet, `curl`, o `docker/smoke.sh` —
num modo de falha novo, criado por acidente ao consertar outra coisa.

`vary: origin` acompanha o `allow-origin`. Não é enfeite: sem ele, um proxy que
guarde a resposta de uma origem pode entregá-la a outra com o cabeçalho errado
dentro.

### 4. `WEB_ORIGIN` é lido UMA vez, e alimenta os dois consumidores

O `check_origin` do socket já lia a variável; o plug novo precisava da mesma
lista. A leitura duplicada é **como o furo apareceu**: o socket tinha origem
configurada há duas fases, e o HTTP não tinha nada, porque nada obrigava os dois
a andarem juntos.

Agora `runtime.exs` calcula `:web_origins` uma vez, no topo, e o `check_origin`
passa a derivar dela.

**Em produção não há default de desenvolvimento.** A api levanta exceção no boot
quando `WEB_ORIGIN` falta (`cors-origins.ts`); o engine deixa a lista **vazia**, o
que fecha o acesso de navegador sem derrubar o processo. A assimetria é
deliberada: CORS é a razão de existir daquele trecho da api, mas no engine é
periférico — filas do Oban e canais Phoenix seguem funcionando. Um engine que não
sobe por causa de um painel de status troca um problema pequeno por um grande.

Lista vazia também **não** vira `check_origin: []`, que o Phoenix leria como
"nenhuma origem confere" e derrubaria o painel do time ao vivo. Nesse caso vale o
default estrito do Phoenix (`true`, comparando com `PHX_HOST`).

### 5. `strictPort: true` no Vite

A porta faz parte do contrato de CORS, então ela não pode ser escolhida em
silêncio. Com `strictPort`, o Vite recusa subir e diz `Port 5173 is already in
use` — que é a informação verdadeira, em vez de três erros de CORS que apontam
para o lugar errado.

O custo é real e aceito: quem quiser dois servidores de dev ao mesmo tempo passa
a precisar de `--port` explícito. Escolher explicitamente é exatamente o que se
quer, porque a outra porta precisa entrar em `WEB_ORIGIN` de qualquer forma.

### 6. `maxAge` no CORS da api e do engine

**Toda** chamada da web à api é preflighted: o `api-client` manda `Authorization`
e `traceparent`, que não são safelisted. Sem cache de preflight, cada requisição
são duas viagens. O cache do navegador é por URL+método, e com o
`refetchInterval` do TanStack Query batendo na mesma URL de novo e de novo, é
justamente aí que ele paga.

10 minutos nos dois. Curto o bastante para uma mudança em `allowedHeaders` não
ficar presa no cache de quem estava com a aba aberta.

## Consequências

- **A `StatusPage` passa a dizer a verdade.** Antes: `api: ok`, `engine: error`
  com o engine no ar. Depois: os dois `ok`, e zero erro de CORS no console.
- **Colisão de porta deixa de se disfarçar de problema de CORS.** É a troca de um
  modo de falha silencioso e enganoso por um barulhento e correto.
- **`/internal/*` continua sem CORS, e agora há teste afirmando isso.** A
  fronteira passou a ser uma asserção — inclusive uma sobre a lista de caminhos
  ter exatamente três entradas, para que mover a fronteira apareça no diff.
- **Uma dependência de menos do que a solução óbvia**, e um moduledoc explicando
  quando reverter a decisão.
- **O engine ganhou seu primeiro teste de cabeçalho HTTP.** Os 15 casos cobrem o
  que teste de controller estruturalmente não cobre: a resposta estava certa e o
  cabeçalho faltava.

### O que fica pendente

- **`exposedHeaders` não foi configurado em nenhum dos dois.** Hoje a web não lê
  cabeçalho de resposta nenhum — o `trace_id` do `ApiError` vem da trace que o
  próprio cliente gerou, não do servidor. Configurar agora seria habilitar uma
  capacidade sem uso.
- **O engine não tem CORS para `POST`**, de propósito: nada no navegador faz
  `POST` nele. Quando fizer, a lista de métodos e a de cabeçalhos precisam crescer
  junto — o teste de preflight é o lugar onde isso será notado.
- **`EngineWeb.RouteSurfaceTest` está vermelho em `origin/dev`** desde antes desta
  mudança (`ActionClauseError` em `SessionCommandController.create/2`, por corpo
  vazio no teste que afirma que as rotas internas aceitam o token válido).
  Verificado que falha igual sem nenhuma alteração desta entrega, e nenhum commit
  daqui toca `apps/engine` além do que está descrito acima. Fica registrado, não
  corrigido: é outro assunto.
