import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Alert } from './alert';
import { Badge } from './badge';
import { Card } from './card';
import { Dialog, DialogContent, DialogTitle } from './dialog';
import { Empty } from './empty';
import { Input } from './input';
import { Label } from './label';
import { NativeSelect } from './native-select';
import { Progress } from './progress';
import { Separator } from './separator';
import { Skeleton } from './skeleton';
import { Spinner } from './spinner';
import { Table } from './table';
import { Textarea } from './textarea';
import { Toggle } from './toggle';
import { Trace } from './trace';

// AT-646 Lane 0: fumaça dos componentes baixados do registry base-nova. Nada
// disto é usado em tela ainda; a prova é só que cada um monta sem lançar.
const simples = {
  alert: <Alert />,
  badge: <Badge>x</Badge>,
  card: <Card />,
  empty: <Empty />,
  input: <Input />,
  label: <Label>x</Label>,
  'native-select': <NativeSelect />,
  progress: <Progress value={30} />,
  separator: <Separator />,
  skeleton: <Skeleton />,
  spinner: <Spinner />,
  table: <Table />,
  textarea: <Textarea />,
  toggle: <Toggle>x</Toggle>,
  trace: <Trace />,
};

describe('shadcn (registry base-nova)', () => {
  it.each(Object.entries(simples))('%s renderiza com data-slot', (_nome, el) => {
    const { container } = render(el);
    expect(container.querySelector('[data-slot]')).not.toBeNull();
  });

  it('dialog aberto mostra o título e o ícone do lucide no fechar', () => {
    const { baseElement } = render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Título</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(baseElement.querySelector('[data-slot="dialog-title"]')).not.toBeNull();
    expect(baseElement.querySelector('[data-slot="dialog-close"] svg')).not.toBeNull();
  });

  it('todo módulo exporta algo e nenhum resta com resíduo do registry', () => {
    const mods = import.meta.glob('./*.tsx', { eager: true });
    const fontes = import.meta.glob('./*.tsx', { eager: true, query: '?raw', import: 'default' });
    for (const [caminho, fonte] of Object.entries(fontes)) {
      if (caminho.includes('.test.')) continue;
      expect(Object.keys(mods[caminho] as object).length, caminho).toBeGreaterThan(0);
      expect(fonte as string, caminho).not.toMatch(/registry\/base-nova|IconPlaceholder|from "cn"/);
    }
  });
});
