/**
 * O barril do pacote — a superfície que `apps/runner` e `apps/broker` veem.
 *
 * Existe por um motivo estreito: `main`/`types` do `package.json` apontam para
 * UM arquivo, e os dois consumidores precisam da porta, do adaptador de CLI e
 * da composição de especificação. Sem o barril, cada um importaria caminho
 * interno do outro pacote (`@brabo/docker-port/src/docker-cli.ts`), que é
 * exatamente o tipo de acoplamento que mover o arquivo para cá foi feito para
 * evitar.
 *
 * `export *` e não uma lista curada: a lista curada seria uma segunda
 * declaração do que é público, e ela envelheceria em silêncio. O que é
 * privado neste pacote já não é exportado dos arquivos.
 */
export * from './docker-port.ts';
export * from './docker-cli.ts';
export * from './spec-de-container.ts';
