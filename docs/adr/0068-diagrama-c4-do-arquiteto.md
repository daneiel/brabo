# ADR 0068 — Diagrama C4 do Arquiteto

- **Status:** aceito
- **Data:** 2026-08-12
- **Contexto:** pedido do usuário — o Arquiteto ganha um entregável novo,
  renderizado na Visão Geral do projeto
- **Estende:** o mesmo padrão de artefato-sem-tabela do
  [ADR 0065](0065-container-por-projeto-a-fronteira-deixa-de-ser-politica.md)
  (`artifact.project_image`)

## Contexto

Os entregáveis do Arquiteto hoje são texto e dado estruturado — `module_map`
(grid de cards), ADRs (lista com link de PR), insights. Nenhum é uma imagem
da arquitetura. O pedido é um diagrama C4 (modelo de Simon Brown — pelo menos
Context e Container) renderizado de verdade na tela, não um link para fora.

Duas perguntas de arquitetura, antes de codar:

**Quem escreve o Container level — o modelo ou o repositório?** O
`module_map` já existe, validado sem ciclo (`create_module_map`). Deixar o
modelo REDIGITAR os módulos e dependências no tool call do diagrama arrisca
divergência silenciosa: o diagrama diria uma coisa, o `module_map` vigente
diria outra, e não haveria como saber qual mentiu. A alternativa — derivar o
Container level do `module_map` vigente, no caso de uso, e nunca do que o
modelo escreve de novo — fecha essa divergência por construção. O Context
level não tem essa fonte: quem são os atores externos (o usuário, um
provedor de Git) é julgamento do Arquiteto, sem um `module_map` de atores
para derivar. Só o Context, então, vem do tool call.

**Com o que renderizar?** `apps/web` não tinha nenhuma lib de diagrama
(zero ocorrência de "mermaid" no `package.json` antes desta mudança); o site
de docs usa Mermaid, mas em BUILD-TIME (Docusaurus). Mermaid é o motor
padrão de facto para diagramas-como-texto, incluindo suporte nativo a
`C4Context`/`C4Container` — não escrevemos um layout engine. Decisão do
usuário, confirmada antes desta mudança: `mermaid` entra como dependência de
RUNTIME nova do app React, a primeira do tipo.

## Decisão

**O diagrama C4 é artefato versionado no event log, sem tabela — mesmo
desenho do `artifact.project_image` (ADR 0065) — com o Container level
DERIVADO do `module_map` vigente, nunca redigitado pelo modelo.**

- `artifact.c4_diagram`: `CreateC4DiagramUseCase` busca o `module_map`
  vigente (`ModuleMapRepository.findCurrent`); sem ele, recusa com 400 — não
  há Container level sem módulos. Gera as duas sintaxes Mermaid
  (`gerarDiagramaContexto`/`gerarDiagramaContainer`, puras, em
  `domain/architecture/c4-diagram.ts`) e grava o evento com `version` =
  `GetC4DiagramUseCase.execute(projectId).version + 1` — igual à leitura
  "o vigente é o de maior `version`" de `ObterContainerDoProjetoUseCase`.
  Reemitir é gerar de novo; o histórico não é reescrito.
- Sem regex na geração da sintaxe: nome de módulo/ator vem do modelo (ou do
  que o modelo já escreveu em `create_module_map`), e um
  `js/polynomial-redos` aqui seria a mesma HIGH que `project-container.ts`
  já evita. Escape de label e geração de id Mermaid são caractere-a-caractere,
  mesmo estilo de `referenciaDeImagemValida`.
- Ferramenta `create_c4_diagram` no Arquiteto: `system_name`
  (obrigatório), `system_description` e `actors` (nome + `person`/
  `external_system` + descrição). Fina — só normaliza e repassa; quem
  valida e deriva é a api, mesmo padrão de `create_module_map`/
  `choose_project_image`.
- `mermaid` isolado atrás de `apps/web/src/lib/mermaid-render.ts`
  (`renderMermaid(id, sintaxe)`), com `import()` DINÂMICO — quem nunca abre
  a Visão Geral com diagrama gerado não paga o bundle. `vite build`
  confirma: só `index-*.js` (o entrypoint) carrega eager; os chunks de
  Mermaid (`mermaid.core`, `c4Diagram-*`, e as dependências pesadas dele —
  `cytoscape.esm` 435 KB, `katex` 258 KB — usadas só por OUTROS tipos de
  diagrama que este produto não gera) ficam sob demanda.
- `C4DiagramView.tsx` (apps/web) — três estados por diagrama (RN-088):
  `rendering` (Skeleton), `erro` (Alert com a mensagem do Mermaid + a
  sintaxe crua colapsada em `<details>`, NUNCA a tela quebrando) e `pronto`
  (o SVG, via `dangerouslySetInnerHTML` — conteúdo que NÓS geramos com
  `mermaid.render`, não HTML de terceiro repassado, com
  `securityLevel: 'strict'` no Mermaid). O quarto estado, "sem diagrama
  nenhum", é da seção que chama o componente (`ArchitectureSection`), igual
  ao que já existe para `moduleMap`/ADRs.
- Tema do Mermaid lido dos tokens do design system em runtime
  (`getComputedStyle` sobre `--surface-*`/`--text-*`/`--border*`), nunca cor
  fixa — não porque o app tenha toggle de tema hoje (não tem: dark é
  primário), mas para não hardcodear paleta que já existe em `tokens.css`.

### CSP — confirmado, sem mudança

O nginx da imagem web tem CSP fechado desde o ADR 0058
(`script-src 'self'`, sem `unsafe-eval`/`unsafe-inline`;
`style-src 'self' 'unsafe-inline'`). Checado nos assets de produção
(`grep -rl "new Function(\|eval(" dist/assets/*.js`): NENHUM chunk do
Mermaid usa `eval`/`new Function`. `style-src` já tinha `unsafe-inline`
antes desta mudança (por outro motivo — CSS inline do próprio app), e é o
que cobre o `<style>` que o SVG do Mermaid pode embutir. Nenhuma linha do
`nginx.conf` mudou.

## Consequências

- **Bundle maior, mas sob demanda.** `pnpm build` confirmou code-splitting
  correto: o entrypoint (`index-*.js`) não cresceu com o peso do Mermoid
  inteiro — só quem efetivamente renderiza um diagrama baixa os chunks dele.
  O custo real (não medido em bytes de rede, só confirmado como lazy) fica
  para a primeira vez que a Visão Geral mostra um diagrama gerado.
- **Só Context e Container.** Component e Code (níveis 3 e 4 do C4) ficam de
  fora — o `module_map` não tem granularidade de componente/código, e
  inventar essa granularidade não foi pedido.
- **Diagrama denso não tem tratamento especial.** Um `module_map` com
  dezenas de módulos produz um Container diagram grande; não há
  virtualização nem colapso — mesmo corte que a FASE 26 já fez para a aba
  Code ("a mais custosa do programa"), por ora aceito.
- **Divergência entre diagrama e module_map é só temporal, não de dado.**
  Como o Container é DERIVADO na hora da geração, um diagrama antigo pode
  ficar desatualizado se o `module_map` mudar depois — mas nunca vai
  MENTIR sobre o que existia no momento em que foi gerado, porque não foi
  o modelo quem descreveu os módulos.
