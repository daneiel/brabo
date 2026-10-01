/**
 * A política do roteador MORA NA API (AT-238, ADR 0179, RN-625):
 * `apps/api/src/domain/llm/tool-router.ts`. Este arquivo só a reexporta para o
 * teste ao vivo da AT-239 rodar a MESMA régua que o produto roda — o recorte do
 * `state`, o pedido ao Jev, a leitura da resposta e o menu P3 —, nunca uma
 * cópia que diverge no primeiro ajuste. Mesmo desenho de
 * `scripts/idioma/heuristica.ts`: o arquivo da api só importa TIPOS, então o
 * Node o executa daqui por type stripping.
 */
export {
  AGENTES_FORA_DO_ROTEAMENTO,
  ENDPOINT_DO_JEV,
  MODELO_DO_JEV,
  ORIGEM_DA_QUEDA,
  RESPONDER_SEM_FERRAMENTA,
  TETO_DO_ESTADO_EM_TOKENS,
  lerRespostaDoJev,
  menuP3,
  montarPedidoAoJev,
  recortarEstado,
  temColisaoDeNome,
} from '../../../apps/api/src/domain/llm/tool-router.ts';
export type {
  EstadoParaOJev,
  MotivoDaQueda,
  OrigemDaQueda,
  PedidoAoJev,
} from '../../../apps/api/src/domain/llm/tool-router.ts';
