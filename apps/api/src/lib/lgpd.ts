import { randomUUID } from 'node:crypto';
import type { DataApi } from './data';

export type ExportedConversation = Record<string, unknown> & {
  messages: Record<string, unknown>[];
  aiSuggestions: Record<string, unknown>[];
};

export type ExportedLeadData = {
  exportedAt: string;
  lead: Record<string, unknown>;
  conversations: ExportedConversation[];
};

export type AnonymizeResult = {
  leadUpdated: boolean;
  conversationsAnonymized: number;
  messagesAnonymized: number;
  suggestionsAnonymized: number;
  appointmentsAnonymized: number;
  patientsAnonymized: number;
};

const asId = (record: Record<string, unknown>): string =>
  typeof record.id === 'string' ? record.id : '';

export const exportLeadData = async (leadId: string, data: DataApi): Promise<ExportedLeadData> => {
  const lead = await data.get('lead', leadId);
  if (!lead) throw new Error('Lead not found');

  const conversations = await data.list('conversation', {
    filter: { leadId: { eq: leadId } },
  });

  const exportedConversations: ExportedConversation[] = [];
  for (const conversation of conversations) {
    const conversationId = asId(conversation);
    if (!conversationId) continue;

    const messages = await data.list('chatMessage', {
      filter: { conversationId: { eq: conversationId } },
      orderBy: { sentAt: 'ASC' },
    });
    const aiSuggestions = await data.list('aiSuggestion', {
      filter: { conversationId: { eq: conversationId } },
      orderBy: { createdAt: 'ASC' },
    });

    exportedConversations.push({ ...conversation, messages, aiSuggestions });
  }

  return {
    exportedAt: new Date().toISOString(),
    lead,
    conversations: exportedConversations,
  };
};

export const anonymizeLead = async (leadId: string, data: DataApi): Promise<AnonymizeResult> => {
  const lead = await data.get('lead', leadId);
  if (!lead) throw new Error('Lead not found');

  await data.update('lead', leadId, {
    name: `ANON-${randomUUID()}`,
    phone: null,
    email: null,
    source: null,
    intent: null,
    tags: [],
    scoreReasons: [],
    optedOut: true,
    optedOutAt: new Date().toISOString(),
  });

  const conversations = await data.list('conversation', {
    filter: { leadId: { eq: leadId } },
    select: { id: true },
  });

  let messagesAnonymized = 0;
  let suggestionsAnonymized = 0;
  for (const conversation of conversations) {
    const conversationId = asId(conversation);
    if (!conversationId) continue;

    await data.update('conversation', conversationId, {
      status: 'CLOSED',
      needsHuman: false,
      metaContactId: null,
      metaThreadId: null,
      externalId: null,
    });

    const messages = await data.list('chatMessage', {
      filter: { conversationId: { eq: conversationId } },
      select: { id: true },
    });
    for (const message of messages) {
      const messageId = asId(message);
      if (!messageId) continue;
      await data.update('chatMessage', messageId, { body: '[anonimizado]', mediaUrl: null });
      messagesAnonymized++;
    }

    const suggestions = await data.list('aiSuggestion', {
      filter: { conversationId: { eq: conversationId } },
      select: { id: true },
    });
    for (const suggestion of suggestions) {
      const suggestionId = asId(suggestion);
      if (!suggestionId) continue;
      await data.update('aiSuggestion', suggestionId, { body: '[anonimizado]', originalBody: null });
      suggestionsAnonymized++;
    }
  }

  const appointments = await data.list('appointment', {
    filter: { leadId: { eq: leadId } },
    select: { id: true },
  });
  for (const appointment of appointments) {
    const appointmentId = asId(appointment);
    if (!appointmentId) continue;
    await data.update('appointment', appointmentId, { notes: null });
  }

  const patients = await data.list('patient', {
    filter: { leadId: { eq: leadId } },
    select: { id: true },
  });
  for (const patient of patients) {
    const patientId = asId(patient);
    if (!patientId) continue;
    await data.update('patient', patientId, {
      name: `ANON-${randomUUID()}`,
      phone: null,
      email: null,
    });
  }

  return {
    leadUpdated: true,
    conversationsAnonymized: conversations.length,
    messagesAnonymized,
    suggestionsAnonymized,
    appointmentsAnonymized: appointments.length,
    patientsAnonymized: patients.length,
  };
};
