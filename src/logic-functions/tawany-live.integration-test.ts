import { describe, it, expect } from 'vitest';
import { runTawany } from './tawany-handler';
import { createAiClient } from 'src/lib/ai-client';
import { createDataApi } from 'src/lib/data';
import { seed } from 'src/seed/seed';

// Roda contra o workspace local + LLM real (OpenAI-compatible).
// ATENÇÃO: o global-setup de integração desinstala/reinstala o app (dados zerados),
// então este teste cria os próprios fixtures.
// Exige OPENROUTER_API_KEY / OPENROUTER_BASE_URL / DEFAULT_MODEL_PATIENT no env.
describe('runTawany (live LLM + live workspace)', () => {
  it.skipIf(!process.env.OPENROUTER_API_KEY)(
    'answers an inbound patient message end-to-end',
    async () => {
      const data = createDataApi();
      await seed(data);

      const lead = await data.create('lead', {
        name: { firstName: 'Maria', lastName: 'LiveTest' },
        stage: 'NOVO',
        score: 50,
      });
      const conv = await data.create('conversation', {
        externalId: `+55219${Date.now() % 100000000}`,
        channel: 'WHATSAPP',
        status: 'OPEN',
        leadId: lead.id,
      });
      // agentHandled=true para o tawany-handler do servidor NÃO competir com este teste
      await data.create('chatMessage', {
        body: 'Oi, meu cabelo está caindo muito, queria agendar uma consulta',
        direction: 'IN',
        sentAt: new Date().toISOString(),
        conversationId: conv.id,
        messageType: 'TEXT',
        agentHandled: true,
      });

      const r = await runTawany(
        { messageId: 'live-test', conversationId: conv.id as string },
        { ai: createAiClient(), data },
      );
      console.log('[live] status:', r.status, '| toolCalls:', r.toolCalls);
      console.log('[live] reply:', r.content);
      if (r.status === 'handoff') {
        const after = await data.get('conversation', conv.id as string, { id: true, handoffReason: true });
        console.log('[live] handoffReason:', after?.handoffReason);
      }

      expect(r.status).toBe('replied');
      expect(r.content.length).toBeGreaterThan(0);
      expect(r.content.length).toBeLessThanOrEqual(1024);
    },
    90_000,
  );
});
