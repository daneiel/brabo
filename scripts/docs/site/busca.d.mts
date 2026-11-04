type Pagina = { slug: string; titulo: string; texto: string };
export const TETO_DE_TEXTO: number;
export function normalizar(s: string): string;
export function indiceDoLocale(paginas: Pagina[]): { json: string; bytes: number };
export function gravarIndice(dir: string, locale: string, paginas: Pagina[]): Promise<number>;
export function tagDeBusca(o: { locale: string; base: string }): string;
