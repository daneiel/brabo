import { WebPreview } from './ai-elements/web-preview';
import { urlLocalSegura } from './RodarNaSuaMaquina';

/* Encaixe do Web preview: usa a primeira URL local declarada; sem ela, diz em texto (nunca iframe vazio). */
export function EntregavelPreview({ urls }: { urls: { label: string; url: string }[] }) {
  const alvo = urls.find((u) => urlLocalSegura(u.url));
  if (!alvo) return <p>Não há entregável publicado para visualizar.</p>;
  return <WebPreview url={alvo.url} />;
}
