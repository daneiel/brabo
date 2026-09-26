/**
 * Tipos de `./links-do-locale.mjs`, para o spec (`tsc --noEmit` do CI) e para
 * `website/docusaurus.config.ts`, que importa `reescreverLinkDeGap`.
 */

export declare const LOCALES_COM_PREFIXO: string[];

export declare function reescreverLinkDeGap(args: {
  sourceFilePath: string;
  url: string;
}): string;

export declare function hrefsComLocaleDuplicado(html: string): string[];

export declare function acharLocaleDuplicado(dirBuild: string): {
  arquivos: number;
  ofensores: Map<string, string[]>;
};
