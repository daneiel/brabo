# ADR 0218 — Todo ADR se chama "ADR NNNN — título"

## Status

**Accepted.** 2026-10-15 (AT-559, decisão do dono de 15/10): padronizar a
nomenclatura dos ADRs só no título.

Tema: `docs`. Complementa, sem editar, a convenção do índice
([0202](0202-o-indice-de-adr-por-tema.md)).

## Contexto

Dos 213 ADRs em `docs/adr/`, 82 abriam com `# ADR NNNN — …` e 131 com
`# NNNN — …`. As duas formas conviviam sem regra, e quem escrevia um ADR novo
copiava a do vizinho. O título é o que aparece na aba do navegador, na busca
local do site e na sidebar; o número sozinho não diz que a página é um ADR.

## Decisão

1. O título (H1) de todo ADR é `ADR NNNN — <título>`: o prefixo `ADR`, o
   número com 4 dígitos e o travessão `—`.
2. O nome do arquivo continua `NNNN-<slug>.md`, e os slugs existentes ficam
   como estão, em qualquer idioma: o nome do arquivo é a URL publicada, e
   renomeá-lo quebraria links de fora.
3. Trocar `# NNNN —` por `# ADR NNNN —` nos ADRs aceitos é normalização
   mecânica do RÓTULO, não edição de decisão. A regra "ADR aceito nunca é
   editado" segue valendo para o conteúdo: Contexto, Decisão, Consequências e
   o texto do título ficam intactos.
4. As traduções em `website/i18n/<locale>/` recebem o mesmo prefixo; o texto
   traduzido do título fica.
5. O `docs:check` (`scripts/docs/temas-de-adr.mjs`) reprova ADR cujo H1 não
   comece por `# ADR NNNN — `, com o número igual ao do arquivo.

## Consequências

- Uma forma só, conferida: o próximo ADR não volta a escolher entre duas.
- A troca mexe em 131 arquivos de fonte e nas cópias traduzidas no mesmo
  commit; o `traducao_de:` das cópias que estavam em dia é atualizado no
  commit seguinte, para a paridade não acusar defasagem que não existe.
- Os slugs seguem misturando idiomas (`short-title` em inglês nos antigos,
  pt-BR nos novos). Isso é aceito: a URL vale mais que a uniformidade.
