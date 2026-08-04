# Notas do design-sync

- 2026-07-23: Projeto `368b0431-c98f-4b29-9cb3-b633c058e3df` ("Brabo Design
  System") criado vazio, sem sync ainda — este repo não tem nenhum código
  de design system (`design/` é só um placeholder, sem `package.json`,
  `dist/` ou Storybook). Quando o design system real for implementado
  (em `design/` ou em outro repo), rode `/design-sync` de novo para
  fazer o import de verdade.
- O projeto `1c960ca8-5e00-4558-8ced-80dfbdf01027` ("Brabo Design
  System", mesmo nome) é do tipo `PROJECT_TYPE_PROJECT` (projeto comum),
  não `PROJECT_TYPE_DESIGN_SYSTEM` — não pode ser usado como alvo de
  sync (o tipo é definido na criação e não muda depois). Não confundir
  os dois.
- 2026-07-26: primeiro import de verdade. O design system **não** está em
  `design/` (que segue sendo só docs em markdown) — ele é `apps/web`, shape
  `package`, `srcDir: src/components`. Os `design/*.md` entram como
  `guidelinesGlob`.
- O `projectId` já estava pinado no config antes desta run, então o roteador
  do §1 manda no **caminho atômico** (upload único no fim), mesmo o projeto
  estando vazio. Não abra `finalize_plan` incremental aqui.
- **`.design-sync/preview-surface.tsx` é obrigatório.** O template de card do
  conversor fixa `body{background:#fff}` num `<style>` inline *depois* dos
  stylesheets, e este DS é dark-primário — sem o wrapper via `cfg.provider`,
  todos os 57 cards renderizam claro-sobre-claro e o render check marca
  ícones e textos como `blank`/`thin`. O arquivo explica por que a correção
  é provider e não CSS. Não é componente do DS: fica em
  `componentSrcMap` como `null`.
- **Fontes**: entram por `@import` de CDN em `.design-sync/fonts.css`, puxado
  pelo `styles-entry.ts` (que também importa `apps/web/src/index.css`, nesta
  ordem, para os tokens entrarem no grafo do esbuild). `cssEntry` não serve:
  é limitado ao PKG_DIR e é concatenado no FIM do `_ds_bundle.css`, onde um
  `@import` é ignorado.
- **`typescript` em `.ds-sync/node_modules` precisa ser 6.x.** `npm i
  typescript` traz a 7.x, cujo export raiz é só `lib/version.cjs` — sem
  `createSourceFile`, o check `[DTS_PARSE]` cai no catch e é reportado como
  "skipped" em vez de falhar. `npm i -E typescript@6.0.2` (a mesma que o
  `apps/web` usa) faz o check rodar.

- **`--node-modules` é o `node_modules` da RAIZ, não o de `apps/web`.** O pnpm
  só cria o self-link do workspace (`node_modules/web -> ../apps/web`) na raiz;
  `apps/web/node_modules` tem o `react` mas não tem `web/`, e o
  `projectFor` do `lib/dts.mjs` morre com
  `ENOENT ... apps/web/node_modules/web/package.json`. A raiz tem as duas
  coisas (react 19.2.8, @types/react e o self-link), então é ela:

  ```bash
  node .ds-sync/resync.mjs --config .design-sync/config.json \
    --node-modules node_modules --out ./ds-bundle \
    --remote .design-sync/.cache/remote-sync.json
  ```

  Isto custou uma run inteira do driver em 2026-07-29.
- **Os `.d.ts` do bundle vêm de declarações emitidas na hora.** `apps/web` é
  app, não lib: não tem `dist/` com `.d.ts`, e sem isso o conversor sintetiza
  `[key: string]: unknown` para os 57 componentes — contrato inútil para o
  agente de design. Regenerar antes de qualquer build:

  ```bash
  cd apps/web && pnpm exec tsc -p tsconfig.app.json --noEmit false \
    --declaration --emitDeclarationOnly --outDir types --rootDir src \
    --noUnusedLocals false --noUnusedParameters false
  ```

  `findTypesRoot` acha `apps/web/types/` sozinho (é um dos candidatos), então
  não precisa mexer no `package.json`. A pasta é gerada e está no `.gitignore`.
  Efeito colateral bom: com props reais, 4 componentes que caíam no floor card
  passaram a renderizar com defaults sintetizados.
- **Os 37 ícones precisam de `dtsPropsFor`.** A heurística de extração cobre
  `export function X(props: P)` mas não `export const X: (props: P) => JSX`,
  que é a forma de `icons.tsx` — todos caíam no catch-all. O corpo é idêntico
  para o set inteiro (eles compartilham uma assinatura), gerado por script.
- **Ordem importa: feche a config ANTES de graduar** — mas só o que entra na
  chave. Lido de `lib/sync-hashes.mjs` (`configSlicesFor`/`sourceKeyFor`,
  `keyRecipe: 7`), a grade é keyada por: `provider`, `storyImports`,
  `extraEntries`, os bytes dos forks em `.design-sync/overrides/`, o
  `overrides.<Nome>` do componente **menos** `cardMode`/`primaryStory`, o
  `titleMap` e os bytes de `.design-sync/previews/<Nome>.tsx`. Trocar
  `provider` ou `extraEntries` limpa TODAS as 57 grades (aconteceu uma vez, no
  primeiro import, e custou uma releitura inteira).
  **NÃO limpam**: `dtsPropsFor`, `docsDir`/`docsMap`, `cardMode`,
  `primaryStory`, reagrupar por categoria. A nota antiga acusava `docsDir` —
  estava errada, e o medo dela desencoraja corrigir doc à toa.

## 2026-07-29 — re-sync da Fase 7a

O que mudou no DS desde o primeiro import (`f340416`): **um** componente, o
`Input`, no commit `8ee0270` das telas de auth. Ele ganhou `label`, `error` e
`hint` (+35 linhas em `Input.module.css`), e é isso que explica todo o churn do
build: `styleSha`, `bundleSha12` e os 57 `.jsx`/`.d.ts` se moveram — estes
últimos só por causa do selo de versão, que virou `web@0.1.0` quando o
`apps/web/package.json` saiu de `0.0.0` (o mesmo commit tirou o `keycloak-js`).
`renderHashes` e `sourceKeys` **não** se moveram: nada re-renderizou diferente.

Três coisas foram corrigidas junto:

1. **`docs/Input.md` mentia.** A prosa dizia "o componente não renderiza rótulo
   nem mensagem de erro — isso é do formulário que o contém". Virou falso com a
   Fase 7a. Reescrito, e com o motivo do `useId()` (é o que faz `<label for>`
   funcionar) explicado, porque é a única razão pra não montar o rótulo à mão.
2. **`previews/Input.tsx` não exercitava a API nova** — daí o `renderHashes`
   parado. Ganhou o export `ComRotulo`, portado de `LoginPage`/`SetPasswordPage`
   (label + hint + error com borda `.invalid`). Regraduado do sheet: 5/5 `good`.
3. **`ToastProvider` tinha contrato vazio** (`[key: string]: unknown`) desde o
   primeiro import — a extração não pega props declaradas como type literal
   inline (`({ children }: { children: ReactNode })`), mesma classe de falha dos
   37 ícones. Resolvido com `dtsPropsFor.ToastProvider`. O `useToast` **está** no
   bundle (o synth entry faz `export *` do módulo), então a doc dele já estava
   certa; só o `.d.ts` estava pobre.

## Previews: o que descobri autorando

- **Nada de valor inventado.** Os previews saem de
  `apps/web/src/components/*.test.tsx` (fábricas `makeAction`, `makeEvent`) e do
  uso real em `src/routes/`. O comando `rm -rf /tmp/build` do ApprovalCard, por
  exemplo, é o do teste.
- **Use chaves de agente reais** (`dev-backend`, `qa`, `anamnese`…, ver
  `src/lib/agents.ts`). `ApprovalCard` faz `AGENTS[action.actor.id]`: um id de
  modelo (`llama3.1:8b`, que é o que o teste usa) não resolve, e o card perde
  nome e ícone.
- **`AGENTS` e `AGENT_LIST` NÃO estão exportados no bundle.** Importar de
  `'web'` quebra. Os previews que precisam de `AgentDef` repetem os valores
  reais inline.
- **Tempo relativo exige offset a partir de `Date.now()`.**
  `formatRelativeTime` compara com o presente, então data fixa faz o texto
  derivar ("há 8 h" → "há 30 d") e isso limpa a grade em todo sync futuro.
  Afeta `ActivityFeed`, `EventItem`, `NotificationBell` e `CredentialStep`.
- **Quatro componentes escondem o que interessa atrás de estado interno.**
  `NotificationBell` (painel), `ModelPicker` (dropdown com o catálogo inteiro),
  `CredentialStep` (`error` e `registering` só existem com o formulário aberto)
  e `PrGateTimeline` (a `coverageMatrix` só aparece expandindo o parecer). Sem
  abrir, a prop principal não produz saída visível nenhuma e as células ficam
  quase idênticas. Os previews clicam no trigger num `useEffect` — síncrono,
  determinístico, sem depender de animação.
- **`ActivityFeed` esconde ruído de máquina**: um preview com `agent.response`
  ou `tool.result` renderiza só "Nenhuma atividade por aqui ainda".
- **`ToastProvider` precisa de `durationMs` enorme**: o default de 5000 remove
  o toast sozinho e a captura passa a ser sorteio.
- **Overlay `fixed` exige `cardMode: single`** (`Modal`, `ToastProvider`,
  `ModelPicker`); componente largo exige `column` (`Table`, `Tabs`,
  `ProjectCard`). O validate diz exatamente qual, com `[GRID_OVERFLOW]`.

## Incoerência encontrada no produto (não corrigida aqui)

`ProjectCard` (apps/web/src/components/ProjectCard.tsx:103) passa
`used={tokensUsed} limit={tokensLimit}` para o `TokenMeter` junto de
`unitLabel="USD"` — ou seja, rotula contagem de TOKENS como dólar. O preview
mostra o comportamento real, sem contornar. Corrigir é mudança de produto, fora
do escopo de um sync de design system.

## Riscos de um re-sync

O que pode quebrar quando alguém rodar `/design-sync` de novo:

0. **O driver NÃO detecta mudança de código do componente nesta shape — você
   detecta.** No shape `package`, `sourceKeyFor` só recebe `srcSha` quando a
   shape é `storybook` (veja a linha `...(shape === 'storybook' ? …)` em
   `package-build.mjs`). Consequência: um componente cujo `.tsx` mudou é
   reportado como `unchanged`, com a grade antiga carregada para a frente, e
   nada pede recaptura. Em 2026-07-29 foi exatamente isso com o `Input` — o
   `renderHashes` dele nem se moveu, porque o preview antigo não exercitava as
   props novas. **Antes de confiar no veredito, faça o diff à mão** contra o
   commit do último sync:

   ```bash
   git diff --stat <ultimo-sync>..HEAD -- apps/web/src/components
   ```

   E não passe esse diff por `| tail -N`: com 20+ arquivos o `--stat` corta as
   PRIMEIRAS linhas, que é justo onde `components/` aparece em ordem
   alfabética. Foi assim que o `Input` quase passou batido.
1. **Esquecer de reemitir `apps/web/types/`.** A pasta é gitignorada, então em
   máquina nova ela não existe — e sem ela os 57 `.d.ts` voltam a ser
   `[key: string]: unknown` em silêncio. O build não falha; só entrega contrato
   vazio. Rode o `tsc` acima ANTES do build, sempre.
2. **`typescript` em `.ds-sync/node_modules` também não é versionado.** Sem ele
   o check `[DTS_PARSE]` é reportado como "skipped" em vez de falhar, e a 7.x
   (o que `npm i typescript` instala) não serve.
3. **Componente novo em `apps/web/src/components/` entra sem doc e sem
   preview**: cai no grupo `general` (não em `Icones`/`Primitivas`/`Dominio`) e
   renderiza o floor card. O caminho é acrescentar
   `.design-sync/docs/<Nome>.md` com `category:` e
   `.design-sync/previews/<Nome>.tsx`.
4. **Ícone novo precisa de três coisas**: entrada em `dtsPropsFor` (o corpo é
   igual ao dos outros 37), preview e doc. Os dois scripts que geraram isso em
   lote estão descritos aqui, mas não foram versionados — regerar é trivial a
   partir do template de qualquer ícone existente.
5. **Mudar a paleta de `design/tokens.css` invalida os previews** que dependem
   de contraste (todos). Rode o validate e olhe os contact sheets.
6. **Se alguém trocar `formatRelativeTime`** por data absoluta, os previews que
   usam offset a partir de `Date.now()` passam a mostrar a mesma data sempre —
   correto, mas as grades limpam uma vez.

## Known render warns

Ambos verificados e legítimos — um warn fora desta lista é novidade:

- `[TOKENS_MISSING] --item-color, --agent-color, --status-color,
  --urgency-color, --decided-color` — os cinco são setados em runtime por
  `style={{ ['--agent-color']: … }}` em `AgentCard`, `ApprovalCard`,
  `ProjectCard` e afins. Não existem em stylesheet nenhum de propósito.
- `[FONT_REMOTE] Archivo, Space Grotesk, IBM Plex Mono` — servidas por CDN,
  não empacotadas. Consequência aceita: preview sem rede cai na fonte de
  fallback.

## 2026-08-04 — re-sync pós-Fases 9–12

**O build quebrou por FONTE, e a causa é produto.** O commit `2404d0eb` (ADR
0036) trocou as três famílias de CDN para auto-hospedadas, com `@font-face`
usando `url('/fonts/…')` dentro de `apps/web/src/index.css`. Esse caminho é
absoluto — só existe quando a app serve o `public/` — e o esbuild não o resolve:
8 erros, build inteiro no chão. Não há knob de config para isso, e
`lib/bundle.mjs` é contrato (não se forka).

Solução, em duas partes:

1. **As `@font-face` saíram para `apps/web/src/fonts.css`**, importado pelo
   `main.tsx` junto do `index.css`. A app recebe exatamente as mesmas regras; o
   `index.css` (tokens + reset + os cinco `@keyframes` que 6 componentes usam)
   volta a ser importável pelo esbuild. **Isto é mudança de produto** — pequena
   e sem efeito no browser, mas mudança. O teste `apps/web/test/fontes.test.ts`
   foi repontado para o arquivo novo e ganhou uma asserção de que o `main.tsx`
   importa a folha (sem ela, separar os arquivos reintroduziria o ADR 0036 por
   outra porta).
2. **`.design-sync/fonts.css` parou de usar `@import` remoto** do Google Fonts —
   que virou mentira com o ADR 0036 — e passou a declarar as MESMAS regras
   apontando para os `.woff2` do disco. O esbuild os inlina como data-URI, então
   o bundle sai auto-contido. Ao acrescentar peso/subset na app, replique aqui:
   são dois arquivos de propósito (a app precisa da url servida, o bundle da url
   de disco) e nada os casa automaticamente.

**O risco #0 se confirmou.** O driver reportou `changed: 0` com 38 arquivos de
componente alterados desde o último sync. Só o partition `added` (9) veio certo.
O `ProjectCard` estava `bad` — `agents` virou `rosterGroups` (agrupamento por
área do ADR 0038) e o preview antigo passava a prop velha: `Cannot read
properties of undefined (reading 'length')`. Preview portado, mais um export
novo (`SemOrcamento`) para exercitar `noBudget`/`onDefineBudget`, que era a
mesma armadilha do `Input` em julho: sem exercitar a prop nova, o `renderHashes`
não se move e a mudança fica invisível.

**Componentes novos (9).** `Alert`, `Skeleton`, `ProjectCardSkeleton`,
`Textarea` e os ícones `AlertCircleIcon`/`EyeIcon`/`EyeOffIcon`/`LogoMark`
ganharam doc + preview e graduaram `good`. Os quatro ícones saíram do molde do
`CheckIcon` (mesma assinatura), e os quatro entraram em `dtsPropsFor` — a
extração continua sem pegar `export const X = (props: P) =>`.

**`ModelCatalogSection` fica no floor card, de propósito.** Ele busca dados
(`useQuery`/`useMutation`) e precisaria de um `QueryClientProvider` acima. Pôr
isso em `cfg.provider` envolveria os 57 componentes e **limparia todas as
grades** — caro demais por um componente. Está em `overrides.ModelCatalogSection.skip`
e o motivo está escrito na doc dele, para quem abrir o card não achar que é
defeito.

### Validação do conventions.md (2026-08-04)

Rodada contra o build novo: **nenhum nome deixou de verificar** — todos os
tokens `var(--*)` citados existem nas folhas do bundle, e as afirmações de
ausência (`Tooltip`, `Popover`, `DatePicker`, "não há layout/grid/stack") seguem
verdadeiras. `DatePicker` aparece na varredura automática como suspeito porque é
citado justamente como algo que NÃO existe; não é drift.

**O que ficou incompleto, e é proposta, não correção:** o header não menciona as
quatro primitivas novas — `Alert`, `Skeleton`, `ProjectCardSkeleton` e
`Textarea`. O agente de design não vai usá-las sem saber que existem. O arquivo
é de autoria humana e não foi reescrito; a sugestão é uma linha em "As
primitivas" para cada uma, e uma menção ao par `Skeleton`/`ProjectCardSkeleton`
na seção de estados de carregamento.

**`overrides.<Nome>.skip` é LISTA de exports, não booleano.** Pus `skip: true`
para o `ModelCatalogSection` e o build morreu em
`emit.mjs:368 — boolean true is not iterable` (`new Set(skip ?? [])`). E era
desnecessário: componente sem `.design-sync/previews/<Nome>.tsx` já cai no floor
card por construção. `skip` serve para calar UMA story de um preview que existe.

### Resultado do re-sync (2026-08-04)

66 componentes no projeto (eram 57): **+9**. Render check 66/66 limpo, `bad: []`.
Um único floor card, o `ModelCatalogSection`, deliberado e explicado na doc dele.
341 arquivos enviados, `deletePaths` vazio (nada foi removido).

**`fonts/` não existe mais no bundle, e isso é correto.** As três famílias agora
entram como data-URI dentro do `_ds_bundle.css` (8 `@font-face`), porque o
`.design-sync/fonts.css` passou a apontar para os `.woff2` do disco em vez de
fazer `@import` remoto. `tokens/` também está vazio: os tokens são compilados
para dentro do `_ds_bundle.css` pelo grafo do `styles-entry.ts`. O que garante
que designs recebem tudo é o `styles.css` abrir com
`@import "./_ds_bundle.css"` — não a existência das pastas.

### Riscos para o próximo re-sync

- **O risco #0 continua vivo e me pegou de novo**: o driver reportou
  `changed: 0` com 38 arquivos de componente alterados. Só o `ProjectCard`
  denunciou (quebrou), porque a prop virou `rosterGroups`. Faça o `git diff`
  contra o commit do último sync SEMPRE, e force com
  `package-capture.mjs --components <lista> --spot-check-components <lista>` —
  sem o segundo flag, tudo volta `carried forward`.
- **Não leia `.render-check.json` logo após o driver.** O estágio de validate
  dele pode correr contra um bundle ainda incompleto; eu li um json velho e
  concluí que dois componentes seguiam quebrados. Rode
  `package-validate.mjs ./ds-bundle` isolado quando o veredito parecer estranho.
- **`overrides.<Nome>.skip` é LISTA**, não booleano (ver acima).
- O `conventions.md` não menciona as quatro primitivas novas (`Alert`,
  `Skeleton`, `ProjectCardSkeleton`, `Textarea`). É proposta pendente, não drift.
