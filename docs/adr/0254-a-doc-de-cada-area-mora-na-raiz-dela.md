# ADR 0254 — A doc de cada área mora na raiz dela

- **Status:** aceito
- **Data:** 2026-11-04
- **Tema:** `docs`
- **Referencia:** os ADRs [0216](0216-quatro-idiomas-com-pt-br-como-fonte.md), [0252](0252-o-brabo-vira-um-conjunto-de-repositorios.md) e [0253](0253-o-site-de-docs-deixa-o-docusaurus.md). Nenhum deles é editado.

## Contexto

O 0252 separa o Brabo em repositórios por área, e o 0253 deu ao site um gerador próprio. Com a doc toda em `docs/`, cada repositório novo nasceria sem a documentação do próprio código, e as regras de negócio (RN) moram em três arquivos grandes que misturam áreas (decisão do dono de 02/11/2026, AT-688 pergunta 11, confirmada em 04/11, AT-693).

## Decisão

1. **A doc de cada área mora em `<raiz>/docs/`.** A lista de raízes está em `scripts/docs/raizes-de-doc.mjs`; `docs/` continua sendo o agregador (o "produto").
2. **O site é a ÁRVORE DE UNIÃO** das raízes: cada arquivo mantém o MESMO caminho relativo que tinha em `docs/` (`reference/permissions.md` passa a `apps/api/docs/reference/permissions.md`), a URL pública não muda e os links entre páginas são escritos em coordenadas da UNIÃO, não do disco. Slug repetido entre raízes reprova.
3. **RN por área.** Cada RN mora em `<raiz>/docs/business-rules/<raiz>.md`, na raiz que hospeda a PRIMEIRA ref `caminho:N` do corpo (sem ref, o primeiro caminho citado; sem nenhum, o produto). A numeração é GLOBAL e única (a próxima é o máximo somando todas as raízes) e a âncora `{#rn-NNN}` não muda.
4. **`docs/business-rules.md` vira ÍNDICE GERADO** (uma linha por RN ligando à página hospedeira, para `business-rules.html#rn-NNN` continuar resolvendo). `custo.md` e `autenticacao.md` viram stubs CONGELADOS, escritos uma vez. Há check novo: o mesmo número de RN em dois arquivos reprova.
5. **Fontes e checks.** `scripts/docs/fontes.yml` (ou o arquivo apontado por `BRABO_FONTES`) mapeia nome lógico para raiz. Os checks ganham `--raiz <nome>`: rodam POR raiz o que só depende dela (âncoras de RN, refs `caminho:N` internas, glob do docmap, drift) e SÓ no agregador o que cruza raízes (contagens, unicidade e índice de RN, refs externas, paridade, links entre locales, procedimentos do runbook). No monorepo `pnpm docs:check` roda tudo.
6. **Traduções** em `<raiz>/docs/i18n/<locale>/<mesmo-caminho>`; `traducao.json` continua UM, no agregador. A mudança que move arquivos deixa todas as traduções "defasadas" por construção, então entra em DOIS commits: o da mudança e um segundo que recarimba `traducao_de` com o SHA do primeiro, só nas que estavam em dia.
7. **O corpus do golden-set do RAG fica CONGELADO** (ADR 0132): a mudança de lugar da doc não pode reescrever a linha de base.

## Consequências

- Cada repositório futuro leva a própria doc e as próprias RNs; o site continua um só e nenhuma URL muda.
- **Preço:** link entre raízes funciona no site e dá 404 na visualização do GitHub (o caminho do link é o da união, não o do disco).
- Quem escreve RN precisa saber a área dona do código; o `docs:check` aponta RN duplicada, âncora ausente e ref que não bate.
- A migração dos arquivos e das ~13 mil ligações entre páginas é um script único, idempotente, na mesma PR logo depois deste ADR.
