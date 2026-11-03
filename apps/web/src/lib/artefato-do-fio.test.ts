import { describe, expect, it } from 'vitest';
import { camposDoArtefato } from './artefato-do-fio';

describe('camposDoArtefato (RN-977)', () => {
  it.each([
    ['artifact.decision_record', { choice: 'Postgres', context: 'Qual banco?' }, { titulo: 'Postgres', descricao: 'Qual banco?' }],
    ['artifact.module_map', { modules: [{ name: 'api' }, { name: 'web' }] }, { descricao: 'api, web' }],
    ['artifact.c4_diagram', { systemName: 'Brabo', systemDescription: 'Plataforma' }, { titulo: 'Brabo', descricao: 'Plataforma' }],
    ['artifact.project_image', { image: 'node:22-slim', rationale: 'leve' }, { titulo: 'node:22-slim', descricao: 'leve' }],
    ['artifact.qa_verdict', { veredito: 'approved', resumo: 'tudo coberto' }, { veredito: 'approved', descricao: 'tudo coberto' }],
    ['artifact.secops_verdict', { veredito: 'changes_requested', resumo: 'achado' }, { veredito: 'changes_requested', descricao: 'achado' }],
  ])('%s lê os campos reais', (tipo, payload, esperado) => {
    expect(camposDoArtefato(tipo, payload)).toMatchObject(esperado);
  });

  it.each([
    'artifact.decision_record',
    'artifact.module_map',
    'artifact.c4_diagram',
    'artifact.project_image',
    'artifact.qa_verdict',
  ])('%s sem campo opcional não quebra nem inventa', (tipo) => {
    for (const payload of [{}, null, { modules: 'x', choice: 3 }]) {
      expect(camposDoArtefato(tipo, payload)).toEqual({
        titulo: undefined,
        descricao: undefined,
        veredito: undefined,
      });
    }
  });

  it('corta a descrição longa em 200 caracteres', () => {
    const d = camposDoArtefato('artifact.c4_diagram', { systemDescription: 'a'.repeat(300) }).descricao!;
    expect(d).toHaveLength(201);
  });
});
