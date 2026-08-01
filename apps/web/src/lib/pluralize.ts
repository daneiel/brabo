/** Pluralização pt-BR simples: singular pra 1, plural pro resto (incl. 0). */
export function pluralizar(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}

export function contagemProjetos(n: number): string {
  return `${n} ${pluralizar(n, 'projeto ativo', 'projetos ativos')}`;
}

export function contagemAgentes(n: number): string {
  return `${n} ${pluralizar(n, 'agente', 'agentes')}`;
}
