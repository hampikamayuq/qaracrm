import { defineFrontComponent } from 'twenty-sdk/define';
import {
  APP_DISPLAY_NAME,
  APP_DESCRIPTION,
  MAIN_PAGE_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

const TILES = [
  { name: 'Inbox WhatsApp', icon: '💬' },
  { name: 'Funil de Leads', icon: '🗂️' },
] as const;

const TILE_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  width: 200,
  height: 120,
  padding: 16,
  border: '1px solid #e5e5e5',
  borderRadius: 12,
  background: '#fff',
  fontSize: 14,
  fontWeight: 500,
  color: '#333',
  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
};

const MainPage = () => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      gap: 24,
      padding: 40,
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}
  >
    <h1 style={{ fontSize: 24, fontWeight: 600, color: '#222', margin: 0 }}>
      {APP_DISPLAY_NAME}
    </h1>
    <p style={{ fontSize: 14, color: '#666', margin: 0, textAlign: 'center' }}>
      {APP_DESCRIPTION}
    </p>
    <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
      {TILES.map((t) => (
        // Visual tiles — open via the left sidebar (Inbox WhatsApp / Funil de Leads).
        // Adding hrefs here requires knowing Twenty's runtime route slug; YAGNI.
        <div key={t.name} style={TILE_STYLE} aria-label={t.name}>
          <span style={{ fontSize: 28 }}>{t.icon}</span>
          <span>{t.name}</span>
        </div>
      ))}
    </div>
    <a
      href="/settings/applications#installed"
      style={{
        fontSize: 12,
        color: '#666',
        textDecoration: 'underline',
        marginTop: 8,
      }}
    >
      App settings
    </a>
  </div>
);

export default defineFrontComponent({
  universalIdentifier: MAIN_PAGE_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  name: APP_DISPLAY_NAME,
  description: `${APP_DISPLAY_NAME} landing — welcome + tiles for Inbox WhatsApp and Funil de Leads`,
  component: MainPage,
});
