import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// ADR 0250: o chat da Sessão ocupa a largura inteira, sem coluna de 780px.
describe('largura do chat da Sessão (ADR 0250)', () => {
  it.each(['SessionPage.module.css', '../components/PendenciasDeOutrasSessoes.module.css'])(
    '%s não tem max-width: 780px',
    (arquivo) => {
      const css = readFileSync(resolve(__dirname, arquivo), 'utf8');
      expect(css).not.toMatch(/max-width:\s*780px/);
    },
  );
});
