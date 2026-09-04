import { defineConfig } from 'tsup';

/**
 * Empacota o broker num único `dist/index.cjs`, como o runner (ADR 0106) e
 * pelo MESMO motivo estrutural, não por gosto: `@brabo/docker-port` é um
 * pacote de workspace cujo `main` aponta para `.ts` cru, e o Node se recusa a
 * fazer type stripping dentro de `node_modules` — uma imagem que resolvesse o
 * pacote em runtime morreria no boot com
 * `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. Empacotado, o pacote entra no
 * arquivo e não há o que resolver.
 *
 * Ele é `devDependency` (não `dependencies`) justamente porque o `tsup` deixa
 * `dependencies` como `require` externo e EMBUTE devDependency — a mesma
 * prateleira em que `phoenix` está no runner.
 *
 * Sem `external`: este pacote não tem binding nativo nenhum. A única coisa que
 * ele exige de fora é o BINÁRIO `docker` no PATH da imagem, que não é
 * dependência de npm nem entra em bundle (ver `docker/broker/Dockerfile.prod`).
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  shims: true,
  dts: false,
  sourcemap: false,
});
