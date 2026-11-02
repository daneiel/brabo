/** Tipos de `./openapi-por-locale.mjs`, para o spec e o `website/docusaurus.config.ts`. */
type Catalogo = Record<string, { fonte: string; traducao: string }>;
export declare const LOCALES_DA_API: string[];
export declare function hashDoTexto(t: string): string;
export declare function estaEmPortugues(t: string): boolean;
export declare function textosDaFonte(spec: unknown): Map<string, string>;
export declare function entradaInvalida(hash: string, e: unknown): boolean;
export declare function precisaDeTraducao(locale: string, texto: string): boolean;
export declare function aplicar(
  spec: any,
  catalogo: Catalogo,
): { spec: any; faltando: string[]; orfas: string[]; invalidas: string[] };
export declare function medirApi(
  spec: unknown,
  catalogos: Record<string, Catalogo>,
): Record<string, { traduzidos: number; total: number }>;
export declare const ROTULOS_DO_REDOC: Record<string, Record<string, string>>;
export declare function rotulosFaltando(rotulos: Record<string, Record<string, string>>): string[];
export declare function caminhoDoCatalogo(raiz: string, locale: string): string;
export declare function lerCatalogo(raiz: string, locale: string): Catalogo;
