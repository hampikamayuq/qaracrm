// Substituição de variáveis em templates de respostas rápidas.
//
// Porta de substituteVars() em crm-clinica-qara-main/markdown.js (repo
// legado) — mesma semântica de {{nome}}/{{primeiro_nome}}, mais {{unidade}}
// (novo: nome da unidade da clínica, quando fizer sentido no template).
export type QuickReplyVars = {
  nome?: string | null;
  unidade?: string | null;
};

/**
 * Substitui `{{nome}}`, `{{primeiro_nome}}` e `{{unidade}}` (case-insensitive,
 * espaços internos tolerados, ex.: `{{ nome }}`) no texto de uma resposta
 * rápida. Placeholders sem valor correspondente viram string vazia — nunca
 * lança, para que o composer sempre tenha algo para inserir.
 */
export function substituteVars(text: string, vars: QuickReplyVars = {}): string {
  const nome = vars.nome?.trim() ?? '';
  const primeiroNome = nome.split(/\s+/)[0] ?? '';
  const unidade = vars.unidade?.trim() ?? '';

  return String(text)
    .replace(/\{\{\s*nome\s*\}\}/gi, nome)
    .replace(/\{\{\s*primeiro_nome\s*\}\}/gi, primeiroNome)
    .replace(/\{\{\s*unidade\s*\}\}/gi, unidade);
}
