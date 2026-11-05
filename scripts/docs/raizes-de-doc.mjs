/**
 * As raízes de documentação (AT-693, EP-033): cada área guarda a própria doc
 * em `<raiz>/docs/`, com o MESMO caminho relativo que o arquivo tinha em
 * `docs/` (a "árvore de união": o site monta todas na mesma URL). `produto` é o
 * agregador (`docs/`, o repo `brabo` depois da separação). A raiz mora no
 * caminho canônico do monorepo e é resolvida pelo `fontes.yml`, então
 * `BRABO_FONTES` a leva para o clone irmão sem mudar nada aqui.
 */
import { existsSync } from 'node:fs';
import { caminhoReal } from './fontes.mjs';

export const RAIZES_DE_DOC = {
  produto: 'docs',
  api: 'apps/api/docs',
  engine: 'apps/engine/docs',
  web: 'apps/web/docs',
  runner: 'apps/runner/docs',
  broker: 'apps/broker/docs',
  contracts: 'packages/docs',
  infra: 'deploy/docs',
  ci: 'scripts/ci/docs',
};

/**
 * As raízes que EXISTEM, na ordem acima (o agregador primeiro):
 * `[{ nome, raiz (canônica), dir (absoluto real) }]`. Raiz ausente é estado
 * normal (a área ainda não tem doc própria); a do agregador ausente não é.
 */
export function lerRaizesDeDoc() {
  const raizes = [];
  for (const [nome, raiz] of Object.entries(RAIZES_DE_DOC)) {
    const dir = caminhoReal(raiz);
    if (existsSync(dir)) raizes.push({ nome, raiz, dir });
  }
  if (!raizes.some((r) => r.nome === 'produto')) throw new Error('raiz de doc do produto (docs/) não encontrada');
  return raizes;
}
