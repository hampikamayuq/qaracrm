// Normalização de telefone BR para dedupe de Lead entre canais. Os webhooks
// de WhatsApp (meta-webhook, evolution-webhook) gravam Lead.phone como dígitos
// com DDI e sem "+" (ex.: 5511999998888); o webhook de leads legado grava com
// "+". Para casar um telefone vindo de fora (ex.: Kommo) com qualquer um dos
// dois formatos, gere os candidatos com candidatePhonesBR e busque por todos.

export const normalizePhoneBRDigits = (phone: string): string | null => {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
};

export const candidatePhonesBR = (phone: string): string[] => {
  const digits = normalizePhoneBRDigits(phone);
  if (!digits) return [];
  return [digits, `+${digits}`];
};
