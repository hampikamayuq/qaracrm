import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// Regressão: o preflight OPTIONS de /api/web-chat/* precisa ser respondido com a
// origin do widget (WEB_WIDGET_ORIGIN), não com a origin do CRM. O CORS do
// widget é registrado ANTES do CORS global no app; sem isso o browser bloqueia
// o widget em produção (o preflight volta com a origin do CRM).
describe('CORS do canal WEB (preflight)', () => {
  const WIDGET_ORIGIN = 'https://clinica.example';
  const CRM_ORIGIN = 'https://crm.example';

  beforeEach(() => {
    vi.resetModules();
    process.env.WEB_WIDGET_ORIGIN = WIDGET_ORIGIN;
    process.env.CORS_ORIGIN = CRM_ORIGIN;
    process.env.CORS_DOMAIN = CRM_ORIGIN;
  });

  afterEach(() => {
    delete process.env.WEB_WIDGET_ORIGIN;
    delete process.env.CORS_ORIGIN;
    delete process.env.CORS_DOMAIN;
  });

  it('responde o preflight de /api/web-chat/message com a origin do widget', async () => {
    const { default: app } = await import('../app');
    const res = await request(app)
      .options('/api/web-chat/message')
      .set('Origin', WIDGET_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'x-widget-token,content-type');

    expect(res.headers['access-control-allow-origin']).toBe(WIDGET_ORIGIN);
  });

  it('mantém a origin do CRM nas rotas do CRM (não é afetada pelo CORS do widget)', async () => {
    const { default: app } = await import('../app');
    const res = await request(app)
      .options('/api/inbox/x/reply')
      .set('Origin', CRM_ORIGIN)
      .set('Access-Control-Request-Method', 'POST');

    expect(res.headers['access-control-allow-origin']).toBe(CRM_ORIGIN);
  });
});
