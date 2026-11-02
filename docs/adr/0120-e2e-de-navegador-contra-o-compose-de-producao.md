# ADR 0120 — E2E de navegador contra o compose de produção, num pacote fora do workspace

- **Status:** aceito
- **Data:** 2026-08-29
- **Referências (sem editar):** [ADR 0032](0032-corte-do-keycloak-e-sessao-em-cookie.md)
  (a sessão em cookie que esta camada existe para provar),
  [ADR 0117](0117-lockfile-proprio-para-o-website.md) (o precedente de uma
  subárvore só de desenvolvimento com lockfile próprio),
  [ADR 0027](0027-fase5-backup-hardening-release.md) (o smoke de produção
  que esta camada reusa em vez de duplicar).

## Contexto

A pirâmide de testes era forte embaixo e tinha um buraco no topo. A api tem
142 specs, o engine 126, o web testa componente a componente sob jsdom, e o
`docker/smoke.sh` prova por HTTP que as quatro imagens de produção sobem e
conversam entre si.

Nenhum deles exercita um **navegador**. E os mecanismos que carregam a
sessão são mecanismos de navegador:

- o access token vive em memória e o refresh num cookie `httpOnly`, pareado
  com um `brabo_csrf` legível enviado como `X-CSRF-Token`;
- o web é servido em `:8088` e a api responde em `:3000`, então toda chamada
  autenticada é **de origem cruzada** — preflight, `SameSite`,
  `credentials: 'include'`;
- o canal da sessão precisa de um ticket de uso único ([RN-108](../business-rules/autenticacao.md#rn-108))
  e de um handshake de WebSocket de verdade contra o engine, numa **terceira**
  origem.

O jsdom não tem nada disso. Ele não tem origem real, não faz preflight, e
`httpOnly` não é algo que ele consiga impor — um teste afirmando que o
refresh é ilegível passaria ali sem provar nada. `apps/api/src/main.ts` já
traz o comentário que diz isso com todas as letras: "teste não faz
preflight."

Não é uma lacuna hipotética. Foi ali que os últimos defeitos de cookie, CORS
e socket de fato apareceram, e cada um foi achado à mão.

## Decisão

**Uma camada de E2E de navegador, em `e2e/`, rodando contra o compose de
produção que a CI já sobe.**

Três partes na decisão, cada uma com o seu motivo.

### Roda contra o `docker-compose.prod.yml`, não contra o `vite dev`

A separação de origens (`:8088` → `:3000` → `:4000`) só existe no compose de
produção. Rodar contra o servidor de dev exercitaria uma topologia que
ninguém implanta e deixaria, em silêncio, de provar a única coisa para a qual
esta camada existe. Por isso o job reusa o `docker/smoke.sh` com
`SMOKE_KEEP_UP=1`: mesmas imagens, mesmo compose, um build.

Ele também roda no **mesmo job de CI** das imagens. As quatro imagens são a
maior parte do tempo desse job; um job separado as reconstruiria para
exercitar a mesma pilha.

### `e2e/` não é membro do workspace pnpm

Mesma forma do `website/` ([ADR 0117](0117-lockfile-proprio-para-o-website.md)):
`pnpm-workspace.yaml` e `pnpm-lock.yaml` próprios, instalado com
`pnpm install` de **dentro** da pasta, acionado da raiz por
`pnpm --dir e2e`.

O motivo é o mesmo: a árvore do Playwright nunca chega a imagem nenhuma do
produto, e deixá-la no lockfile da raiz faria o `pnpm audit` do produto
relatar ferramenta de teste como se fosse superfície entregue. A diferença em
relação ao website — este pacote *testa* o produto — não muda o argumento,
porque o que decide é para onde a dependência **vai**, não sobre o que ela
fala.

### Prova mecanismos, não telas

Os specs afirmam sobre mecanismo observável: a flag `httpOnly` como o
navegador a relata, `document.cookie` como a página o vê, a sobrevivência a
um reload, a URL do WebSocket carregando `ticket=`. Seletores são estruturais
(`input[type="email"]`), nunca texto — o idioma da interface é decidido pelo
servidor, e um teste preso a "Sign in" quebraria numa troca de idioma, uma
falha que não diz nada sobre o produto.

A semeadura (workspace → projeto → sessão) vai por HTTP, espelhando o
`smoke.sh`. O navegador é caro e o assistente de projeto não é o que esta
camada existe para provar; preparação lenta é preparação que acaba
desligada.

## Consequências

- A lacuna fecha para os caminhos que só um navegador alcança. Os dois specs
  foram **provados por mutação**: uma senha errada deixa os specs de auth
  vermelhos, e apontar a asserção do socket para um caminho que não existe
  falha com "nenhum WebSocket foi aberto contra o engine."
- O job `images` cresce: setup de pnpm/Node, download do chromium e a própria
  execução. Em troca, continua sendo um job e um build de imagens.
- Só Chromium. Um navegador prova o mecanismo; os outros dois custariam
  download e tempo para provar a mesma coisa de novo. Diferenças entre
  navegadores são um risco real que esta decisão **declara que não cobre**.
- O binário do navegador é baixado na hora da CI pela CDN do Playwright. A
  versão dele é presa pela versão exata de `@playwright/test` no lockfile,
  que é como este download se encaixa na disciplina de pin do repositório —
  ver [cadeia-de-suprimentos-do-ci.md](../explanation/cadeia-de-suprimentos-do-ci.md).
- **Uma nova tentativa na CI, nenhuma local.** E2E contra uma pilha viva tem
  instabilidade com causa externa (um container ainda subindo, um socket
  lento). Zero novas tentativas transformaria isso em ruído que ensina as
  pessoas a ignorar o vermelho.
- Dois specs são piso, não suíte. Aprovação inline e streaming — nomeados no
  achado original — **ainda não** são cobertos.
- **A suíte tem um orçamento de login, e ele veio de rodá-la de verdade.** A
  api defende `/auth/login` com um bloqueio progressivo por IP que responde
  com o *mesmo 401 uniforme* de uma senha errada — distingui-los diria a um
  atacante quando ele acertou o e-mail. Rodar a suíte repetidas vezes dentro
  da janela de 15 minutos o dispara, e a falha então acusa o login, que não é
  onde o defeito está. Duas consequências foram tiradas: o navegador faz login
  **uma** vez por execução (um projeto `setup` salva o estado; só
  `autenticacao.spec.ts` fica de fora, porque provar o login precisa de uma
  origem limpa), e `suporte/api.ts` reconhece esse 401 e diz o que ele
  provavelmente é. A alternativa — pedir ao compose um limiar mais frouxo para
  a suíte poder logar à vontade — foi recusada: enfraqueceria o que está sendo
  testado para tornar o teste conveniente.

## Alternativas consideradas

**`e2e/` dentro do workspace pnpm.** Uma instalação, sem segundo lockfile.
Recusada pelo motivo que o ADR 0117 acabara de pagar: a auditoria do produto
carregaria a árvore do Playwright.

**Rodar contra o `vite dev`.** Mais rápido, sem imagens para construir.
Recusada porque testaria uma topologia que não é implantada, e o servidor de
dev de mesma origem torna vazia toda asserção de `autenticacao.spec.ts`.

**Um job dedicado de E2E.** Separação mais limpa, e uma falha ali não seria
relatada sob "images". Recusada pelo custo: reconstruiria as quatro imagens
para chegar ao mesmo compose.

**Conduzir a criação do projeto pelo assistente em vez de semear por HTTP.**
Mais realista, e cobriria o assistente. Recusada por ora — tornaria a
execução várias vezes mais longa e acoplaria esta camada a um provedor de
git, por uma cobertura que pertence a um spec próprio do assistente, se um
dia for desejado.
