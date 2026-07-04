import { useEffect, useState } from 'react';
import { defineFrontComponent } from 'twenty-sdk/define';
import { createDataApi } from 'src/lib/data';
import { TAWANY_PANEL_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

const rowStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '14px',
};

export const TawanyPanel = () => {
  const [needsHuman, setNeedsHuman] = useState(0);
  const [open, setOpen] = useState(0);

  useEffect(() => {
    void (async () => {
      try {
        const c = (await createDataApi().list('conversation', {
          select: { id: true, needsHuman: true, status: true },
        })) as Array<{ needsHuman: boolean; status: string }>;
        setNeedsHuman(c.filter((x) => x.needsHuman).length);
        setOpen(c.filter((x) => x.status === 'OPEN').length);
      } catch (err) {
        console.error('TawanyPanel: failed to load counts', err);
      }
    })();
  }, []);

  return (
    <aside style={{ padding: '16px', fontFamily: 'sans-serif' }}>
      <h3 style={{ margin: '0 0 8px' }}>🤖 Tawany</h3>
      <div style={rowStyle}><span>Aguardando humano</span><strong>{needsHuman}</strong></div>
      <div style={rowStyle}><span>Conversas abertas</span><strong>{open}</strong></div>
    </aside>
  );
};

export default defineFrontComponent({
  universalIdentifier: TAWANY_PANEL_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  name: 'tawany-panel',
  description: 'Painel de status da Tawany: fila de handoff e conversas abertas',
  component: TawanyPanel,
});
