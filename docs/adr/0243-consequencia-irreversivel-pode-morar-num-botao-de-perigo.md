# ADR 0243 — Consequência irreversível pode morar num botão de perigo

- **Status:** aceito
- **Data:** 2026-11-03
- **Revisa:** a régua do "?" em `design/COMPONENTS.md` ("a consequência irreversível fica sempre visível"), só para o aviso de conversão de modo de execução, e estende o molde do [ADR 0240](0240-o-motivo-de-controle-inerte-mora-num-ponto-de-interrogacao-nos-containers.md).

## Contexto

O aviso de conversão de `execution_mode` (RN-560, AT-144) diz o que a conversão
deixa para trás, o que se perde, o que é recusado e o que é levado. Era um
`Alert` de várias linhas sempre na tela. O dono (AT-719, 02/11) pediu a seção
curta e o aviso num botão de legenda com ícone de perigo. O que a régua protege
é a consequência ser ANUNCIADA antes do clique em Converter, não que o texto
ocupe a seção.

## Decisão

1. Cria-se `components/ui/Perigo.tsx`, irmão do `Ajuda`: o mesmo Popover com
   `openOnHover` (abre no clique, no teclado e no hover; fecha com Esc), com o
   ícone `TriangleAlert` (`aria-hidden`) na cor do token `--danger`. O nome
   acessível é "Atenção: {assunto}" (`ui:perigo.rotulo`).
2. O botão fica ao lado do seletor de modo, nas MESMAS condições em que o aviso
   aparecia, e o popover leva o aviso inteiro, sem mudar conteúdo nem condição
   (RN-560, AT-144, AT-372). O risco é anunciado pelo ícone sempre visível; o
   texto fica no popover.
3. A exceção vale SÓ para o aviso de conversão de modo. Outro uso do `Perigo`
   exige outro ADR.

## Consequências

- `design/COMPONENTS.md` registra o `Perigo` e o limite da exceção.
- A régua do "?" segue valendo em todo o resto: consequência irreversível e
  teto absoluto ficam em texto visível.
