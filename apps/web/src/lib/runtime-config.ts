/**
 * Configuração de runtime da web (Fase 5).
 *
 * ## O problema que isto resolve
 *
 * O Vite **inlina** `import.meta.env.VITE_*` no bundle em tempo de build. Com
 * as URLs de api e engine vindo dali, a imagem do web fica assada
 * para um ambiente: mudar o endereço da api exige rebuild, não restart, e cada
 * ambiente precisa da sua própria imagem. Isso quebra a premissa básica de
 * qualquer deploy sério — promover o MESMO artefato que passou no CI de
 * staging para produção. O ADR 0024 registrou a dívida como pré-requisito da
 * sessão de Kubernetes.
 *
 * ## Como funciona
 *
 * O entrypoint do nginx gera `/config.js` a partir de variáveis de ambiente do
 * container, e `index.html` o carrega ANTES do bundle. O arquivo é servido com
 * `no-store` (a política de cache vive no `map $uri` do nginx, nunca num
 * `add_header` de bloco filho — ver ADR 0024, decisão 7).
 *
 * A precedência é `window.__BRABO_CONFIG__` > `VITE_*` > default. Manter os
 * dois níveis de fallback não é indecisão: `pnpm dev:web` roda sem nginx e
 * sem `/config.js`, e continua funcionando pelas `VITE_*` de sempre.
 */

export interface RuntimeConfig {
  apiUrl: string;
  engineUrl: string;
  /** Nível mínimo do logger JSON (Fase 5, item 6). */
  logLevel: string;
  /**
   * Versão do artefato, mostrada no rodapé das telas de auth (ADR 0036).
   *
   * ## Por que esta é build-time e as URLs não são
   *
   * O ADR 0024 escolheu runtime para as URLs justamente para poder promover a
   * MESMA imagem entre ambientes — e URL é propriedade do ambiente. Versão é
   * propriedade do **artefato**: a imagem `brabo-web:1.1.2` não deve poder
   * reportar outra coisa, ou o rodapé passa a ser um campo editável em vez de
   * uma identidade. Então o valor real vem de `VITE_BRABO_VERSION`, inlinado no
   * bundle pelo `Dockerfile.prod` a partir da tag do release.
   *
   * A precedência por `window` continua existindo porque a interface é uma só,
   * mas ninguém a escreve para esta chave — nem o entrypoint do nginx.
   *
   * `'dev'` cobre `pnpm dev:web` e `docker compose`, que não passam pelo
   * workflow de release e portanto não têm tag alguma para reportar.
   */
  version: string;
}

declare global {
  interface Window {
    __BRABO_CONFIG__?: Partial<RuntimeConfig>;
  }
}

/**
 * Um valor só conta se for string não-vazia: o `envsubst` do entrypoint
 * escreve `""` para variável não definida, e `"" ?? default` é `""` — a app
 * apontaria para a origem vazia e falharia com um erro de CORS que não diz
 * nada sobre a causa.
 */
function pick(
  fromWindow: string | undefined,
  fromBuild: string | undefined,
  fallback: string,
): string {
  if (typeof fromWindow === 'string' && fromWindow.trim() !== '') {
    return fromWindow;
  }
  if (typeof fromBuild === 'string' && fromBuild.trim() !== '') {
    return fromBuild;
  }
  return fallback;
}

export function readRuntimeConfig(
  source: Partial<RuntimeConfig> = typeof window === 'undefined'
    ? {}
    : (window.__BRABO_CONFIG__ ?? {}),
): RuntimeConfig {
  return {
    apiUrl: pick(
      source.apiUrl,
      import.meta.env.VITE_API_URL,
      'http://localhost:3000',
    ),
    engineUrl: pick(
      source.engineUrl,
      import.meta.env.VITE_ENGINE_URL,
      'http://localhost:4000',
    ),
    logLevel: pick(source.logLevel, import.meta.env.VITE_LOG_LEVEL, 'info'),
    version: pick(source.version, import.meta.env.VITE_BRABO_VERSION, 'dev'),
  };
}

/**
 * Resolvido uma vez, na carga do módulo. `/config.js` é síncrono e vem antes
 * do bundle, então já está no `window` aqui; reavaliar por chamada só criaria
 * a possibilidade de dois módulos enxergarem configurações diferentes.
 */
export const runtimeConfig: RuntimeConfig = readRuntimeConfig();
