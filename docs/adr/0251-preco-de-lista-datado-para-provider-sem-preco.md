# ADR 0251 — Preço de lista datado no código para provider que não informa preço

- **Status:** aceito
- **Data:** 2026-11-03
- **Referencia:** o ADR [0042](0042-catalogo-vivo-ciclo-de-vida-do-modelo-e-preco-auditavel.md) (curadoria manual, preço congelado no metering). Nenhum ADR é editado.

## Contexto

A `/v1/models` da Anthropic não traz preço nem sinaliza raciocínio no Brabo: 13 de 14 modelos sincronizados chegaram com preço 0 e `supports_reasoning = false`. Gasto custo zero sem aviso, e a AT-676 nunca ligava o raciocínio.

## Decisão

1. Provider cuja API não informa preço guarda uma tabela de preço de LISTA no código, com a data da fonte (`PRECO_DE_LISTA_ANTHROPIC`, 2026-10-06), casada pelo ID sem sufixo de data. ID fora da tabela segue sem preço.
2. O sync não muda: `manual_pricing` continua vencendo o catálogo remoto; o preço de lista só entra em linha não manual.
3. `supportsReasoning` vem de `capabilities.thinking` do SDK, com a família como reserva.

## Consequências

- A tabela envelhece: atualizar é editar a constante e a data, e o preço de modelo novo é curadoria até lá.
- A tela de sugestão (`precos-do-fabricante.ts`, RN-965) segue independente.
