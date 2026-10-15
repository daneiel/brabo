# 0033 — A referência de API sai do código, e o teste de tabela cobra os metadados

## Contexto

A api expõe **118 rotas em 23 controllers**, e até aqui a única documentação de
contrato era `docs/security-surface.md`. Ela responde *quem pode chamar* cada
rota — e nada sobre o que a rota faz, o que aceita ou o que devolve. Quem
integrava lia o controller.

A 7.1 abriu a exceção: os dois controllers de auth nasceram com
`@ApiTags`/`@ApiOperation`/`@ApiProperty`, e o cabeçalho de `auth/dto/auth.dto.ts`
registrou a intenção — *"os decorators entram AGORA, junto com as rotas, e não
numa varredura retroativa"*. Esta entrega é a varredura retroativa que aquele
comentário prometeu não precisar de novo, e o mecanismo que a torna a última.

O `@nestjs/swagger` já era dependência desde a 7.1, mas o `SwaggerModule` não
estava ligado em lugar nenhum: o documento não existia.

Três achados da exploração redesenharam a entrega antes de uma linha ser
escrita:

1. **O `@nestjs/swagger` SINTETIZA uma resposta quando não há decorator
   nenhum.** `api-response.explorer.js` devolve `{ '<status>': { description: '' } }`
   para todo handler sem `@ApiResponse`. Antes desta fase, **111 das 118 rotas**
   estavam exatamente nesse estado. A asserção óbvia — *"toda rota tem uma
   resposta 2xx"* — nasceria verde sem verificar coisa alguma.
2. **`@HttpCode` é ignorado assim que existe qualquer `@ApiResponse`.** O
   status documentado passa a vir só do decorator. O defeito já existia no
   repositório: `POST /auth/register` e `POST /auth/request-password-reset`
   tinham `@HttpCode(202)` com `@ApiOkResponse`, e o documento afirmava 200.
3. **Fora do auth, nenhum handler declara tipo de retorno.** O padrão é
   `return this.useCase.execute(...)`, que resolve para *interfaces* e *type
   aliases* de `src/domain/**` — dos quais o `@nestjs/swagger` não deriva
   schema, e sobre os quais ele emite `{}` **sem avisar**.

## Decisão

**A referência é gerada do OpenAPI e nunca escrita à mão**, e o teste de tabela
da Fase 5 passa a cobrar os metadados que a alimentam.

### Os DTOs de resposta espelham a entidade por TIPO

Existem ~55 formas de resposta distintas (não 118: `ProposedAction` serve 6
rotas, `Session` 5). Cada uma virou uma classe em
`interfaces/http/<domínio>/dto/*.response.dto.ts`. Nada em `src/domain/**` foi
tocado — pôr `@ApiProperty` numa entidade fere a pureza do domínio.

Escrever os DTOs é o fácil. O risco é o dia em que a entidade ganha um campo e
o DTO não: a referência passa a mentir **em silêncio**. Contra isso, duas
travas de tipo, e as duas são necessárias:

```ts
export class SessionResponseDto implements Wire<Session> { … }
export const _chavesSession: MesmasChaves<SessionResponseDto, Session> = true;
```

`implements Session` direto não serve: a entidade diz `createdAt: Date` e o
corpo JSON diz `string`. `Wire<T>` é a entidade **como ela sai no fio**, e aí o
`implements` é honesto. Mas `implements` é unidirecional — ele é **cego a campo
sobrando**, e um DTO que descreve um campo já removido compilaria para sempre.
`MesmasChaves` fecha esse lado.

Os quatro modos de falha foram verificados por execução antes de qualquer DTO
ser escrito em cima disso:

| erro | pego por |
|---|---|
| entidade ganhou campo | `implements` — TS2420 |
| DTO tipou `Date` onde o fio tem `string` | `implements` — TS2416 |
| DTO tem campo que a entidade não tem mais | `MesmasChaves` — TS2322, e **só** ele |
| DTO correto | compila limpo |

Quem executa as travas é o `tsc`, não o vitest — que transpila por SWC e não
verifica tipo nenhum. Daí o `pnpm --filter api typecheck` novo no CI: sem ele a
prova só rodaria no job de imagens, vinte minutos depois.

### O teste de tabela cobra o DOCUMENTO, não os decorators

`route-surface.spec.ts` ganhou sete asserções, todas sobre o documento montado
por `SwaggerModule.createDocument` — o mesmo que vai para o site. Refletir
`DECORATORS.API_RESPONSE` handler a handler testaria um passo intermediário: um
`type:` apontando para uma interface passaria na checagem de decorator e
produziria `{}` no documento.

A asserção de resposta exige **conteúdo resolvido ou descrição não vazia**, e
não a mera presença de uma chave 2xx — é o achado 1 acima que obriga a isso.
A de status recomputa o valor real a partir de `HTTP_CODE_METADATA`, o que
fecha o achado 2. E a última amarra o documento aos **guards de verdade**: rota
`@Public()` não pode declarar `security`, rota autenticada tem de declarar. Sem
ela a referência poderia afirmar que uma rota é aberta quando o guard a fecha —
errar justamente onde errar é caro.

Excluir uma rota da referência exige uma entrada em `EXCLUIDAS_DA_REFERENCIA`,
e uma rota sem corpo JSON exige uma em `SEM_CORPO_JSON` **com obrigação
própria** (SSE declara `text/event-stream`, redirect declara o header
`Location`, 204 declara 204). Sem isso, `@ApiExcludeEndpoint()` seria a saída
fácil para escapar de tudo, e "é um stream" viraria licença para não documentar
nada.

### O `--check` usa um manifesto, não regera

`pnpm docs:check` promete não escrever. Rodar `gen-api-docs` para comparar
quebraria a promessa. A trava é um manifesto com o sha256 de cada arquivo
gerado mais o do `openapi.json` que os produziu, escrito pelo mesmo
`escrever()` de todos os outros gerados — e portanto com o mesmo comportamento
em check.

Ele pega as quatro derivas que importam: MDX editado à mão, MDX velho para
spec nova, arquivo gerado ausente e arquivo órfão. Três foram verificadas por
execução.

A ordenação do `openapi.json` é fixada (paths, verbos, schemas, tags, status)
porque a ordem que o Nest entrega vem da ordem de registro dos módulos: sem
normalizar, mover uma linha de `import` no `AppModule` produziria milhares de
linhas de diff, e o passo seguinte previsível seria alguém desligar o check.

### Swagger UI fora de produção

`/docs` e `/docs-json` só existem com `NODE_ENV !== 'production'`. A referência
de produção é o site de docs, gerado do mesmo documento; servir a superfície
inteira num ambiente real não acrescenta nada e dá mapa de graça a quem sondar.

## Consequências

A referência tem 118 páginas, uma por rota, agrupadas por tag. A visão geral —
autenticação, convenção de erros, rate limit — sai do `info.description`, então
é gerada de fonte única em vez de escrita num `.md` que divergiria.

**Rota nova sem metadados não entra.** É o mecanismo anti-drift que o docmap
não tem: o docmap dispara quando um arquivo muda, mas não enxerga rota nova que
nasceu sem documentação.

### O que a varredura corrigiu no caminho

Não foi só documentação:

- `PUT /projects/:id/agent-autonomy` e `DELETE /projects/:id/members/:userId`
  devolviam **200 com corpo vazio**. O `api-client.ts` da web só trata 204 como
  "sem corpo" e caía em `res.json()`, lançando `SyntaxError`. Os dois viraram
  `@HttpCode(204)`.
- `UpdateWorkspaceDto` e `UpdateProjectDto` usavam `PartialType` do
  `@nestjs/mapped-types`, que copia só a validação: os dois sairiam **sem
  propriedade nenhuma** no documento.
- O `@ApiBearerAuth` de classe no `GitController` vazava para o callback de
  OAuth, que é `@Public()` — a referência afirmava que o browser precisa de
  token para voltar do provider. Nenhum decorator do `@nestjs/swagger` limpa
  exigência herdada, então a declaração passou a ser por rota.
- Os dois `@HttpCode(202)` do auth documentados como 200.

### Custos aceitos

- **2,7 MB de gerado versionado** (117 MDX mais 352 JSON que eles `require()`).
  Sem isso o docmap teria uma regra morta e o `git ls-files` não veria nada.
- **Sem snippets por linguagem.** O `postman-code-generators` roda um
  `npm install` aninhado no postinstall — rede no meio do nosso install, que é
  o que a disciplina da Fase 5 recusa. Entrou em `allowBuilds` como `false`.
- **O `outputDir` é apagado inteiro** pelo `clean-api-docs`, então a spec mora
  um nível acima. Um gerador que apaga a própria entrada funciona na primeira
  execução e falha na segunda.
- **Os ids do sidebar gerado vêm um nível fundo demais**, porque o plugin supõe
  que o `outputDir` esteja dentro do site. A correção vive na `sidebars.ts`
  escrita à mão, não numa reescrita do arquivo gerado — mutá-lo faria o
  `docs:check` acusar deriva a cada rodada.

### O que continua aberto

O `engine_api_client.ex` segue **sem checagem automática** de que bate com as
rotas da api. A referência dá às duas pontas a mesma fonte para conferir, e o
`TODO(humano)` de `internal-api.md` continua válido: o que fecharia de verdade
é gerar o cliente Elixir a partir do `openapi.json`, ou um teste de contrato
entre as pontas.

Fica também fora: cliente TS gerado para a web (`api-client.ts` continua à
mão), versionamento da api, e a remoção do `GET /` do scaffold — que ganhou
`@ApiExcludeEndpoint()` com justificativa em vez de sumir, porque removê-lo é
decisão de produto.

Referencia [ADR 0027](0027-fase5-backup-hardening-release.md), que criou o
teste de tabela, e [ADR 0031](0031-auth-first-party-argon2id-e-rotacao-de-refresh.md),
onde os primeiros decorators entraram.
