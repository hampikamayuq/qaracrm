import type { DataApi } from 'src/lib/data';
import { handoff } from 'src/lib/handoff';
import { matchLeadsNovosRule } from 'src/lib/leads-novos/matcher';
import { createActivity } from 'src/lib/tools/createActivity';
import { sendWhatsApp } from 'src/lib/tools/sendWhatsApp';

export type LeadsNovosFlowInput = {
  messageId: string;
  conversationId: string;
  originalError?: string;
  messageBody?: string;
};

export type LeadsNovosFlowResult =
  | { status: 'replied'; rule: string; content: string }
  | { status: 'handoff'; reason: string };

export type LeadsNovosFlowDeps = { data: DataApi };

const handoffWith = async (
  conversationId: string,
  reason: string,
  data: DataApi,
): Promise<LeadsNovosFlowResult> => {
  await handoff(conversationId, reason.slice(0, 200), data);
  return { status: 'handoff', reason };
};

export const runLeadsNovosFlow = async (
  input: LeadsNovosFlowInput,
  deps: LeadsNovosFlowDeps,
): Promise<LeadsNovosFlowResult> => {
  const message = input.messageBody
    ? { body: input.messageBody }
    : await deps.data.get('chatMessage', input.messageId, { body: true });
  const body = typeof message?.body === 'string' ? message.body : '';
  const rule = matchLeadsNovosRule(body);

  if (!rule) {
    return handoffWith(
      input.conversationId,
      `leads_novos_no_match${input.originalError ? `: ${input.originalError}` : ''}`,
      deps.data,
    );
  }

  try {
    await sendWhatsApp.execute({ conversationId: input.conversationId, text: rule.reply }, deps.data);
    await createActivity.execute({
      targetType: 'conversation',
      targetId: input.conversationId,
      body: `leads-novos-flow: ${rule.name}`,
    }, deps.data);
    return { status: 'replied', rule: rule.name, content: rule.reply };
  } catch (e) {
    return handoffWith(
      input.conversationId,
      `leads_novos_error: ${(e as Error).message}`,
      deps.data,
    );
  }
};
