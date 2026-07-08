import type { DataApi } from './data';

export type ExplicitPatientProfile = {
  name?: string;
  cpf?: string;
  birthDate?: string;
};

export type PatientCaptureResult =
  | { captured: false; fields: string[] }
  | { captured: true; patientId: string; fields: string[] };

const NAME_PATTERN = /\b(?:meu nome [ée]|me chamo|sou a?|paciente se chama)\s+([A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+){1,5})/iu;
const CPF_PATTERN = /\b(?:meu\s+)?cpf\s*(?:[ée]|:)?\s*(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b/iu;
const BIRTH_PATTERN = /\b(?:nasci em|nascimento\s*(?:[ée]|:)?|data de nascimento\s*(?:[ée]|:)?)\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\b/iu;

const cleanName = (name: string): string =>
  name.replace(/[,.!?].*$/u, '').trim().replace(/\s+/g, ' ');

const isoBirthDate = (day: string, month: string, year: string): string | undefined => {
  const d = Number.parseInt(day, 10);
  const m = Number.parseInt(month, 10);
  const y = Number.parseInt(year, 10);
  if (d < 1 || d > 31 || m < 1 || m > 12 || y < 1900 || y > 2100) return undefined;
  const date = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  if (date.getUTCDate() !== d || date.getUTCMonth() !== m - 1 || date.getUTCFullYear() !== y) return undefined;
  return date.toISOString();
};

export const extractExplicitPatientProfile = (text: string): ExplicitPatientProfile => {
  const profile: ExplicitPatientProfile = {};
  const name = text.match(NAME_PATTERN)?.[1];
  if (name) profile.name = cleanName(name);
  const cpf = text.match(CPF_PATTERN)?.[1];
  if (cpf) profile.cpf = cpf.replace(/\D/gu, '');
  const birth = text.match(BIRTH_PATTERN);
  if (birth) {
    const iso = isoBirthDate(birth[1], birth[2], birth[3]);
    if (iso) profile.birthDate = iso;
  }
  return profile;
};

export const captureExplicitPatientProfile = async (
  params: { conversationId: string; text: string },
  data: DataApi,
): Promise<PatientCaptureResult> => {
  const profile = extractExplicitPatientProfile(params.text);
  const fields = Object.keys(profile);
  if (fields.length === 0) return { captured: false, fields: [] };

  const conversation = await data.get('conversation', params.conversationId, {
    id: true,
    leadId: true,
    patientId: true,
  });
  if (!conversation) return { captured: false, fields: [] };

  const patientId = typeof conversation.patientId === 'string' ? conversation.patientId : '';
  if (patientId) {
    await data.update('patient', patientId, profile);
    return { captured: true, patientId, fields };
  }

  const leadId = typeof conversation.leadId === 'string' ? conversation.leadId : null;
  const created = await data.create('patient', {
    leadId,
    name: profile.name ?? 'Paciente',
    ...profile,
  });
  const createdId = typeof created.id === 'string' ? created.id : '';
  if (createdId) await data.update('conversation', params.conversationId, { patientId: createdId });
  return { captured: true, patientId: createdId, fields };
};
