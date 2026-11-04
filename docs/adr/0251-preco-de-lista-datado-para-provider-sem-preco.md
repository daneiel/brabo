# ADR 0251 — Preço de lista datado no código para provider que não informa preço

- **Status:** aceito
- **Data:** 2026-11-03
- **Referencia:** o ADR [0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md) (curadoria manual, preço congelado no metering). Nenhum ADR é editado.

## Contexto

A `/v1/models` da Anthropic não traz preço nem sinaliza raciocínio no Brabo: 13 de 14 modelos sincronizados chegaram com preço 0 e `supports_reasoning = false`. Gasto custo zero sem aviso, e a AT-676 nunca ligava o raciocínio.

## Decisão

1. Provider cuja API não informa preço lê o preço de LISTA da tabela única do fabricante (`precos-do-fabricante.ts`, RN-965, com link e data da fonte por linha), a MESMA da tela de sugestão, e agora também usada pelo sync. O `listModels` casa pelo ID e, se não achar, pelo ID sem sufixo de data. ID fora da tabela segue sem preço.
2. O sync não muda: `manual_pricing` continua vencendo o catálogo remoto; o preço de lista só entra em linha não manual.
3. `supportsReasoning` vem de `capabilities.thinking` do SDK, com a família como reserva.

## Consequências

- A tabela envelhece: atualizar é editar `precos-do-fabricante.ts` e `conferidoEm`, e o preço de modelo novo é curadoria até lá.
- Há uma fonte só: tela de sugestão e sync não divergem.
