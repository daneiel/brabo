# ADR 0117 — `website/` ganha lockfile próprio, fora do `pnpm audit` do produto

- **Status:** aceito
- **Data:** 2026-08-28

## Contexto

`website/` (o site Docusaurus que publica `docs/`) é membro do
`pnpm-workspace.yaml` da raiz desde que foi criado, compartilhando o único
`pnpm-lock.yaml` com `apps/api`, `apps/web`, `apps/runner`, `packages/*` e
`scripts`. Nada em `website/` chega a uma imagem de produção — o site é
construído e publicado pelo próprio workflow
(`docs-deploy.yml`/`docs-check.yml`), nunca empacotado nos artefatos da api,
do web ou do runner.

Compartilhar o lockfile cobrava dois preços que nada tinham a ver com o
produto:

1. **O `pnpm audit` deixou de responder "o produto está seguro?"** e passou a
   responder "o produto **e** um gerador de documentação estão seguros?".
   Docusaurus, `docusaurus-theme-openapi-docs` e a árvore transitiva deles
   (webpack, postman-collection, oas-validator, `@redocly/*`…) são uma
   superfície grande e que muda rápido, que nunca é entregue, e todo advisory
   nela aparecia no mesmo portão de `pnpm audit` de que o produto depende
   (`ci.yml`, job "Auditoria de dependências").
2. **A maioria dos overrides de segurança em `pnpm-workspace.yaml` existia só
   para corrigir uma dependência transitiva do site.** Das 13 entradas
   auditadas para esta decisão, `serialize-javascript` e a faixa `yaml@1.x`
   eram usadas **exclusivamente** pela árvore de dependências de `website/`
   (confirmado com `pnpm why <pkg> -r` contra o lockfile compartilhado, não
   relendo os comentários — ver "O que a auditoria achou" abaixo). Mantê-los
   na raiz significava carregar a superfície de vulnerabilidade de `website/`
   como se fosse do produto.

## O que a auditoria achou {#what-the-audit-found}

A entrada do backlog que propôs isto supunha que a separação seria limpa: "os
overrides do website saem, os do produto ficam". Rodar `pnpm why <pkg> -r`
contra o lockfile de antes da separação para os 13 overrides mostrou uma
realidade mais bagunçada: vários pacotes que os comentários atribuíam só a
`website/` são **também** puxados por `apps/api` ou `apps/web`, por uma cadeia
diferente da que o comentário descrevia:

| pacote | cadeia do próprio website | também exigido por |
|---|---|---|
| `js-yaml` (`<4.3.1`) | `openapi-to-postmanv2` / `@11ty/gray-matter` | `apps/api`, via `eslint` → `@eslint/eslintrc` |
| `js-yaml` (`<5.2.2`) | `@redocly/openapi-core` | `apps/api`, via `@nestjs/swagger` (já conhecido) |
| `mermaid` | `@docusaurus/theme-mermaid` | `apps/web`, dependência direta de runtime (ADR 0068) |
| `dompurify` | via `mermaid` | `apps/web`, via o mesmo `mermaid` |
| `uuid` | `postman-collection`, `sockjs` | `apps/web`, via `mermaid` |
| `postcss` | `postcss-preset-env` (transitiva de `docusaurus-theme-openapi-docs`) | `apps/web`, via a dependência própria do `vite`, `postcss: ^8.5.17` |
| `nanoid` | via a própria cadeia de `postcss` | `apps/web`, via a mesma cadeia de `postcss` sob o `vite` |
| `fast-uri` | `@redocly/ajv` | `apps/api`, via `ajv` → `@angular-devkit/core` → `@nestjs/schematics` |
| `lodash` | `@docusaurus/core`, direta | `apps/api`, via `@nestjs/swagger` (já conhecido) |
| `undici` | `cheerio` (busca local) | `apps/web`, devDependency `jsdom` (já conhecido — o único caso que a entrada do backlog marcara como misto) |

Só dois overrides se revelaram de fato exclusivos do website
(`serialize-javascript`, `yaml@1.x`), e um se revelou exclusivo do produto, sem
presença nenhuma na árvore de `website/` (`esbuild`, via `drizzle-kit`).

Isso importa para a decisão abaixo: separar o lockfile **não** significa que a
maioria dos overrides simplesmente "se muda". Um override antes compartilhado
que corrige um pacote presente nos dois lados tem de continuar protegendo **as
duas** árvores quando elas deixam de compartilhar uma resolução — tirá-lo de um
lado porque o comentário nomeava o outro reabriria em silêncio o CVE no lado
que o perdeu.

## Decisão

### 1. `website` sai da lista `packages:` do `pnpm-workspace.yaml`

Ele deixa de ser membro do workspace. `pnpm install` na raiz do repositório
para de tocar qualquer coisa sob `website/`, e
`apps/api`/`apps/web`/`apps/runner`/`packages/*`/`scripts` continuam instalando
exatamente como antes.

### 2. `website/` ganha o próprio `pnpm-lock.yaml`, instalado de forma independente

`pnpm install` rodado **dentro** de `website/` (não `pnpm --filter website` da
raiz — esse verbo exige ser membro do workspace) resolve e trava as
dependências de `website/` sozinhas, contra `website/package.json` apenas.

### 3. Overrides separados por onde o pacote vulnerável de fato resolve, não por qual comentário o nomeava

- **Exclusivos do website** (`serialize-javascript`, `yaml@1.x`): removidos do
  `pnpm-workspace.yaml` da raiz, acrescentados a um bloco novo
  `pnpm.overrides` em `website/package.json` (a sintaxe de projeto avulso — não
  há `pnpm-workspace.yaml` dentro de `website/`, então a chave `overrides:` de
  nível de workspace não vale ali).
- **Mistos** (`js-yaml` nas duas faixas, `mermaid`, `dompurify`, `uuid`,
  `postcss`, `nanoid`, `fast-uri`, `lodash`, `undici`): mantidos na raiz **e**
  duplicados em `website/package.json`. Dois lockfiles agora resolvem esses
  pacotes de forma independente, então cada um precisa do próprio piso.
- **Exclusivos do produto** (`esbuild`): ficam só na raiz. `website/` nunca o
  resolve, então uma entrada ali seria peso morto.

Os comentários nos dois arquivos dizem em que categoria cada entrada cai e
apontam para este ADR, para que a próxima pessoa que tocar uma das entradas
mistas não tenha de rodar `pnpm why` do zero para saber que o outro lado
precisa da mesma correção.

### 4. Scripts e workflows passam de `--filter website` para `--dir website`

`pnpm --filter <name>` seleciona um pacote **por pertencer ao workspace** —
com `website` fora do workspace, todo script `docs:*` do `package.json` da raiz
(`start`, `build`, `serve`, `clear`) passa a `pnpm --dir website <script>`, que
roda o pnpm como se tivesse sido iniciado dentro daquele diretório, membro ou
não. Os nomes de script que as pessoas já digitam (`pnpm docs:build`,
`pnpm docs:start`) não mudam.

`docs-deploy.yml` e `docs-check.yml` ganham cada um um segundo passo separado
`pnpm install --frozen-lockfile` escopado a `website/`
(`working-directory: website`), logo depois da instalação da raiz que já
existe. A instalação da raiz não alcança mais as dependências de `website/`, e
sem esse segundo passo o passo de build falharia por falta de `node_modules`.

## Consequências

- **O `pnpm audit` na raiz agora relata só a árvore de dependências do
  produto.** Docusaurus, o tema dele, o plugin de OpenAPI e os pacotes
  transitivos deles somem do portão que o job "Auditoria de dependências" do
  `ci.yml` roda — a superfície de CVE que ele relata encolhe para o que de fato
  é entregue.
- **A conveniência da instalação única acabou.** Uma mudança que toca um
  pacote do produto e `website/` (rara, mas a saída do `docs:generate` toca os
  dois) agora precisa de duas execuções de `pnpm install`, uma na raiz e uma
  dentro de `website/`, em vez de uma. `docs-deploy.yml`/`docs-check.yml`
  pagam esse mesmo preço com um segundo passo de CI.
- **Um override misto tem duas casas a manter em sincronia.** Se `apps/web`
  largar o `mermaid` (ou o `vite` subir o `postcss` para além da faixa
  vulnerável por conta própria), a entrada da raiz fica removível do jeito
  normal (o `pnpm audit` para de reclamar), mas a cópia em
  `website/package.json` não vai perceber até alguém rodar `pnpm audit`
  **dentro** de `website/` também — ainda não há um comando único que audite
  as duas árvores de uma vez.
- A regra `site-e-publicacao` do `docs/.docmap.yml` já observa `website/**` e
  `.github/workflows/docs-deploy.yml` em `warn`, então uma mudança futura em
  qualquer um continua pedindo uma olhada em
  `docs/explanation/documentation-workflow.md`, que agora também registra o
  arranjo de dois lockfiles.

## Alternativas descartadas

- **Deixar `website/` no workspace e só tolerar os CVEs dele no
  `pnpm audit`**: o status quo. Rejeitada porque o objetivo inteiro do portão
  de auditoria é avisar o time quando um pacote que é entregue tem
  vulnerabilidade conhecida, e um pacote de tema do Docusaurus afoga esse sinal
  em ruído sobre o qual ninguém pode agir, a não ser subindo uma dependência de
  ferramenta de documentação.
- **Mover `website/` para um repositório separado**: resolve o mesmo problema
  e mais, mas perde a fonte da doc (`docs/` fica neste repositório) morando ao
  lado do site que a renderiza, e o pipeline `docs:generate`, que lê o código
  de `apps/api` direto para montar a referência OpenAPI, precisaria de um passo
  entre repositórios. Fora do escopo do que a entrada do backlog pediu.
- **Manter todo override na raiz "por via das dúvidas"**: mais simples de
  escrever, e errado do mesmo jeito que os comentários originais de atribuição
  mista eram — esconde qual pacote de fato precisa de proteção em qual lado, e
  a próxima separação (ou a próxima auditoria destas entradas) começa do zero
  outra vez.
