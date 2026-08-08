import type { Project } from './api-types';

/**
 * Desempate visual de projetos com o MESMO nome.
 *
 * Nome de projeto não é único — nada no domínio impede, e uma execução de
 * validação criou vinte projetos chamados `validacao-real`. Na sidebar eles
 * viravam vinte linhas idênticas: impossível saber qual está aberto, qual é o
 * de ontem, qual tem o dot vermelho.
 *
 * Nenhum campo novo: o id e a data de criação já vêm no payload do projeto.
 */

const QUANDO = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * Os nomes que aparecem mais de uma vez na lista.
 *
 * O desempate só vale para eles, de propósito: num workspace de nomes
 * distintos a legenda seria ruído em toda linha, e a sidebar é o lugar com
 * menos espaço da tela.
 */
export function nomesRepetidos(projects: Project[] | undefined): Set<string> {
  const vistos = new Set<string>();
  const repetidos = new Set<string>();
  for (const p of projects ?? []) {
    if (vistos.has(p.name)) repetidos.add(p.name);
    vistos.add(p.name);
  }
  return repetidos;
}

/**
 * `#a1b2c3d4 · 07/08 14:32` — o prefixo do id (mesma forma que a lista de
 * sessões já usa) e quando o projeto nasceu.
 *
 * Os dois juntos porque servem a perguntas diferentes: o id é o que se cola
 * numa URL ou num comando, a data é o que a pessoa lembra ("o de agora há
 * pouco").
 */
export function desempateDoProjeto(project: Project): string {
  return `#${project.id.slice(0, 8)} · ${QUANDO.format(new Date(project.createdAt))}`;
}
