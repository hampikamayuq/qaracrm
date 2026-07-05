import type { DataApi } from './data';

export const recordConsent = async (conversationId: string, data: DataApi): Promise<void> => {
  const conversation = await data.get('conversation', conversationId, { id: true, leadId: true });
  if (!conversation) throw new Error('Conversation not found');

  const leadId = typeof conversation.leadId === 'string' ? conversation.leadId : '';
  await data.create('activity', {
    targetType: leadId ? 'lead' : 'conversation',
    targetId: leadId || conversationId,
    conversationId,
    body: 'lgpd.consent_recorded',
  });
};
