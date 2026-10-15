# ADR 0116 — `ActionType` (e tipos futuros) gerados do contrato OpenAPI, não copiados à mão

- **Status:** Aceito
- **Data:** 2026-08-28
- **Contexto:** paga a dívida técnica nomeada em `docs/architecture.md` ("The
  `ActionType` union is a copy, and a copy ages") e acompanhada em
  `docs/explanation/backlog.md`; a união já divergiu do backend duas vezes em
  produção
- **Não substitui:** `apps/web/src/lib/api-types.ts` — a maior parte dele
  continua escrita à mão; ver Decisão, item 3

## Contexto

`apps/web/src/lib/api-types.ts` (~1600 linhas) espelha entidades de
`apps/api/src/domain/**` à mão, de propósito: `apps/web` não depende de código
do servidor, e o próprio cabeçalho do arquivo diz isso. Essa foi a escolha
certa para a maior parte do arquivo — são tipos pequenos, estáveis, no formato
da UI. Foi a escolha ERRADA para um tipo em particular: `ActionType`.

`ActionType` (`apps/api/src/domain/actions/decide.ts`, `ACTION_TYPES`) não tem
formato de UI — é a lista exaustiva sobre a qual `decide()` faz o `switch`, e
todo consumidor adiante (`ApprovalCard`, os registros
`VERBO_DA_ACAO`/`FRASE_DA_ACAO` de `lib/aprovacoes.ts`) precisa dela completa,
senão degrada em silêncio. Ela divergiu da união copiada à mão em
`api-types.ts` DUAS vezes em produção, nas duas sem o compilador perceber,
porque `apps/api` não é dependência de `apps/web`:

1. Os três tipos do bootstrap do Gitflow (`git_repo_create`,
   `git_branch_create`, `git_branch_protect`) faltavam na união do web. O
   `ACTION_ICON[actionType]` do `ApprovalCard` devolvia `undefined` para eles e
   derrubava a tela de sessão inteira — todo projeto bootstrapado contra um
   provider real tinha uma sessão que não abria.
2. `parallelize`/`raise_max_parallel` saíram na FASE 14d e ninguém lembrou de
   acrescentá-los à cópia do web.

A única coisa que pega isso hoje é `apps/web/src/lib/aprovacoes.test.ts`, que
lê o texto-fonte de `decide.ts` em tempo de teste e reprova tipo sem frase. É
uma rede de segurança real, mas de runtime, descoberta no `pnpm test`, não uma
estrutural que o compilador impõe a cada edição.

À parte, `apps/api/src/scripts/export-openapi.ts` já exporta o documento
OpenAPI inteiro, e `docs/reference/openapi.json` já é artefato gerado e com
checagem de deriva (`docs/.docmap.yml`, regra `referencia-openapi`;
`docs:generate`/`docs:check`). `ACTION_TYPES` já está exposto ali como um
`enum` de JSON Schema de verdade — três DTOs (`ProposeActionDto`,
`CreateActionInternalDto`, `ProposedActionResponseDto`) declaram
`@ApiProperty({ enum: ACTION_TYPES })` no campo `actionType`, então os 17
valores já fazem a volta pelo contrato em que o web já precisa confiar para
todo o resto.

## Decisão

### 1. `openapi-typescript` (`^7.13.0`) gera `apps/web/src/lib/api-types.generated.ts` a partir de `docs/reference/openapi.json`

Escolhido em vez de um gerador feito à mão porque transformar um `enum` de
JSON Schema (e, se o arquivo crescer, formatos inteiros de request/response)
numa união TypeScript é exatamente o problema que a biblioteca resolve, e ela é
o padrão de fato para isso — esta é a "dependência pesada" que a regra do
`CLAUDE.md` pede para justificar, e a justificativa são os dois incidentes de
produção acima, não conveniência.

A entrada é o `docs/reference/openapi.json` COMMITADO, não uma execução nova de
`export-openapi.ts` encadeada. Esse arquivo já tem uma invariante de frescor
imposta (`docs:generate --check`, rodado no job `guardiao` de
`.github/workflows/docs-check.yml`) — ler o export vivo a partir de `apps/web`
significaria subir o `AppModule` inteiro de um pacote que não tem dependência
de NestJS nem motivo para ganhar uma, para re-derivar uma garantia que já
existe uma porta ao lado.

Dois scripts npm, em `apps/web/package.json` (não em `apps/api`): o CONSUMIDOR
decide quando regenerar, e a fonte é um arquivo que já está no repositório, não
um processo vivo da api — `apps/web` precisar do servidor de dev da api de pé
para obter os próprios tipos seria uma dependência pior do que a que este ADR
remove.

- `openapi:types` — escreve `src/lib/api-types.generated.ts`.
- `openapi:types:check` — o modo `--check` nativo da biblioteca: recalcula e
  compara, nunca escreve. Ligado no `docs-check.yml` logo depois do passo de
  frescor do `openapi.json` que já existe, e dependendo de ele rodar antes —
  o `--check` aqui só é confiável quando já se sabe que o `openapi.json` está
  em dia.

### 2. Portão de frescor do `docs/reference/openapi.json`: reusado, não duplicado

A regra `referencia-openapi` do `docs/.docmap.yml` já observa todo DTO e
controller e exige que o `openapi.json`/o manifesto MDX se movam com eles.
`apps/web/src/lib/api-types.generated.ts` entrou na lista `docs:` da MESMA
regra em vez de uma regra nova com uma cópia do mesmo `watch:` — ele é gerado A
PARTIR do `openapi.json`, pelo mesmo gatilho, e uma segunda regra só derivaria
da lista de globs da primeira.

### 3. Só `ActionType` migra nesta mudança — não as outras ~1600 linhas

O próprio cabeçalho de `api-types.ts` já traça a linha real: tipos de fato
compartilhados entre api e web (`HealthStatus`, `GitProviderName`) moram em
`packages/shared`, não aqui; todo o resto do arquivo é espelho de entidade de
domínio mantido à mão. Regenerar o arquivo inteiro de uma vez, sem ir
consumidor por consumidor, seria exatamente o tipo de mudança contra a qual o
`CLAUDE.md` adverte ("Não refatorar código de fase concluída sem pedido
explícito"), aplicada a 1600 linhas que ninguém releu para esta PR.
`ActionType` é o único tipo com custo de produção demonstrado e repetido por
ser copiado à mão; ele se move. As linhas restantes de `api-types.ts` ficam
intocadas e continuam escritas à mão, reavaliadas tipo a tipo em PRs futuras do
mesmo jeito que esta.

`api-types.ts` agora faz:

```ts
import type { components } from './api-types.generated';

export type ActionType =
  components['schemas']['ProposedActionResponseDto']['actionType'];
```

`ProposedActionResponseDto` foi escolhido em vez de `ProposeActionDto` /
`CreateActionInternalDto` (que declaram o mesmo enum de 17 valores) porque é o
formato de resposta que o web de fato lê em toda tela de aprovações; os três
são a mesma união hoje, e o NestJS Swagger não emite um schema nomeado único
`ActionType` para apontar no lugar — ele embute o enum por DTO, já que nenhum
dos três usa `@ApiExtraModels`/um nome de enum compartilhado. Nomear o enum
globalmente no documento OpenAPI é trabalho futuro, não necessário para esta
correção: o `actionType` de `ProposedActionResponseDto` é uma união simples de
literais de string, estruturalmente idêntica ao tipo que substitui.

### 4. `aprovacoes.test.ts` (FASE 19) fica — o trabalho dele mudou, não sumiu

O teste fazia duas coisas: provar que todo `ActionType` do backend tem entrada
de verbo/frase (EXISTÊNCIA), e provar que essa entrada não é vazia, está em
português e tem pontuação correta (CONTEÚDO). A existência agora também é
pega pelo compilador — `Record<ActionType, string>` em `lib/aprovacoes.ts`
deixa de compilar no instante em que um valor de `api-types.generated.ts` fica
sem chave, antes de o `pnpm test` rodar. Isso torna a checagem de existência
do teste REDUNDANTE com uma garantia mais forte e mais cedo — mas as asserções
de conteúdo dele (tamanho da frase, ponto final, nenhum `snake_case` cru
vazando para a prosa em português) não são algo que um sistema de tipos
confere, e continuam tão valiosas quanto antes. Remover o teste trocaria cinto
e suspensório por nenhum suspensório; ele fica, documentado aqui como
parcialmente superado em vez de mantido em silêncio por inércia.

## Consequências

**A favor**

- A classe de defeito que atingiu produção duas vezes (`ApprovalCard` caindo
  num `ActionType` que o web não conhecia) agora é pega pelo `tsc`, em toda PR
  que toca `decide.ts` e regenera `openapi.json` — não descoberta ao vivo.
- `docs-check.yml` falha ALTO (`::error::`) com o comando exato a rodar, a
  mesma UX de todo outro artefato gerado do repositório.
- Nenhuma mudança em contrato HTTP, DTO ou comportamento de runtime — é uma
  mudança só de tipos, em tempo de desenvolvimento.

**Contra**

- Uma segunda superfície de devDependency para `apps/web`
  (`openapi-typescript`) só para geração de código; ela nunca vai para o bundle
  do navegador (`api-types.generated.ts` é fonte, não a biblioteca em si).
- `api-types.generated.ts` tem ~18 mil linhas (a superfície OpenAPI INTEIRA,
  todo caminho e DTO) mesmo que só um tipo seja consumido dele hoje —
  `--root-types`/filtragem de schema poderia encolhê-lo depois se virar custo
  real (ele não é carregado em runtime; é um arquivo-fonte em formato `.d.ts`
  que o `tsc` lê e o vite nunca empacota).
- `api-types.ts` agora é, para um tipo, um reexport em vez de uma definição —
  quem lê tem de seguir um salto a mais (`api-types.ts` →
  `api-types.generated.ts` → `openapi.json` → `decide.ts`) para achar a fonte
  de verdade. O comentário no ponto do import em `api-types.ts` nomeia cada elo
  dessa cadeia exatamente por isso.

## Alternativas consideradas

**Regenerar todo o `api-types.ts` a partir do documento OpenAPI numa PR só.**
Rejeitada — o arquivo não é um espelho puro de entidades (`packages/shared` já
separa o que é de fato compartilhado), e uma substituição em bloco sem rastrear
cada uma das ~1600 linhas até seus consumidores arriscaria mudanças de formato
silenciosas que ninguém revisou. Migrar tipo a tipo, começando pelo de custo
comprovado, é mais lento, mas cada passo é conferível.

**Gerar a partir de uma execução viva de `export-openapi.ts` em vez do
`openapi.json` commitado.** Rejeitada no item 1 — exigiria que `apps/web`
dependesse do runtime NestJS de `apps/api` ou o chamasse por shell, para
re-derivar uma garantia de frescor que o `docs:check` já dá de graça.

**Remover `aprovacoes.test.ts` agora que o compilador cobre a exaustividade.**
Rejeitada no item 4 — as asserções de conteúdo (qualidade da frase) não são
propriedades de nível de tipo, e remover o arquivo também removeria o
comentário que explica POR QUE existe a regra de uma frase por tipo (RN-096).

## Referências

- `apps/api/src/domain/actions/decide.ts` — `ACTION_TYPES`, a fonte canônica
- `apps/web/src/lib/api-types.ts` — o reexport, e o comentário que nomeia a
  cadeia inteira
- `apps/web/src/lib/aprovacoes.ts` / `aprovacoes.test.ts` — o consumidor cuja
  exaustividade agora é conferida pelo compilador
- `docs/.docmap.yml`, regra `referencia-openapi` — o portão de frescor
  compartilhado
- `.github/workflows/docs-check.yml` — `openapi:types:check`, ligado depois do
  passo de frescor do `openapi.json`
- `docs/architecture.md` — "The `ActionType` union is a copy, and a copy
  ages"
- [RN-096](../business-rules.md#rn-096) — todo `ActionType` precisa de uma
  frase em português
