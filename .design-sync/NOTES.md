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
- **Ordem importa: feche a config ANTES de graduar.** As grades são keyadas por
  fonte + config que afeta preview. Trocar `provider`, `overrides` ou `docsDir`
  depois de graduar limpa TODAS as grades e obriga a reler os 57 sheets. Isto
  aconteceu uma vez nesta sessão; custou uma rodada inteira de releitura.
  Reagrupar (grupo/categoria) NÃO limpa — a grade é keyada pelo nome.

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
