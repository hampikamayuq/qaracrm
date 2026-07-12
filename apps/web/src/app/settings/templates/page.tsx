'use client';

// Templates HSM do WhatsApp oficial: criar (com cabeçalho, corpo, rodapé e
// botões) → aprovação da Meta → usar fora da janela de 24h. Prévia ao vivo
// mostra como a mensagem chega no WhatsApp. Status vem direto da Meta.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, FileText, Plus, RefreshCw, Reply, Trash2 } from 'lucide-react';
import { api, type TemplateButton, type WhatsAppTemplate } from '@/lib/api';

const STATUS_CHIP: Record<string, string> = {
  APPROVED: 'chip-ok',
  PENDING: 'chip-warning',
  REJECTED: 'chip-danger',
};

const STATUS_LABEL: Record<string, string> = {
  APPROVED: 'aprovado',
  PENDING: 'em análise',
  REJECTED: 'rejeitado',
};

const CATEGORIES = [
  { value: 'UTILITY', label: 'Utilidade (lembretes, confirmações)' },
  { value: 'MARKETING', label: 'Marketing (ofertas, novidades)' },
  { value: 'AUTHENTICATION', label: 'Autenticação (códigos)' },
];

const MAX_BUTTONS = 3;

const countPlaceholders = (body: string): number => {
  let max = 0;
  for (const match of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    max = Math.max(max, Number(match[1]));
  }
  return max;
};

type DraftButton = { type: 'QUICK_REPLY' | 'URL'; text: string; url: string };

// Substitui {{n}} pelos exemplos na prévia (placeholder sem exemplo fica visível).
const fillVars = (text: string, examples: string[]): string =>
  text.replace(/\{\{\s*(\d+)\s*\}\}/g, (whole, n) => examples[Number(n) - 1]?.trim() || whole);

// Prévia da mensagem num balão estilo WhatsApp.
function TemplatePreview({ header, body, footer, buttons, examples }: {
  header: string;
  body: string;
  footer: string;
  buttons: Array<{ type: string; text: string }>;
  examples: string[];
}) {
  const filledButtons = buttons.filter((b) => b.text.trim());
  return (
    <div className="wa-preview" aria-label="Prévia da mensagem">
      <div className="wa-bubble">
        {header.trim() ? <div className="wa-header">{fillVars(header, examples)}</div> : null}
        <div className="wa-body">{body.trim() ? fillVars(body, examples) : 'Prévia da mensagem aparece aqui…'}</div>
        {footer.trim() ? <div className="wa-footer">{footer}</div> : null}
      </div>
      {filledButtons.length > 0 ? (
        <div className="wa-buttons">
          {filledButtons.map((b, i) => (
            <div className="wa-button" key={i}>
              {b.type === 'URL' ? <ExternalLink size={13} /> : <Reply size={13} />}
              {b.text}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function TemplatesSettingsPage() {
  const [configured, setConfigured] = useState(true);
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [feedback, setFeedback] = useState('');

  const [name, setName] = useState('');
  const [category, setCategory] = useState('UTILITY');
  const [header, setHeader] = useState('');
  const [body, setBody] = useState('');
  const [footer, setFooter] = useState('');
  const [examples, setExamples] = useState<string[]>([]);
  const [buttons, setButtons] = useState<DraftButton[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const placeholders = useMemo(() => countPlaceholders(body), [body]);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await api.getTemplates();
      if (data) {
        setConfigured(data.configured);
        setTemplates(data.templates);
      } else {
        setLoadError('Falha ao consultar os templates na Meta.');
      }
    } catch {
      setLoadError('Falha ao consultar os templates na Meta.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const flash = (message: string) => {
    setFeedback(message);
    window.setTimeout(() => setFeedback(''), 5000);
  };

  const submit = async () => {
    setFormError('');
    const slug = name.trim();
    if (!/^[a-z0-9_]{1,120}$/.test(slug)) {
      setFormError('Nome: use minúsculas, números e underscore (ex.: qara_confirmacao_consulta).');
      return;
    }
    if (!body.trim()) {
      setFormError('Escreva o corpo do template.');
      return;
    }
    const filled = examples.slice(0, placeholders).map((e) => e.trim());
    if (placeholders > 0 && filled.filter(Boolean).length < placeholders) {
      setFormError(`A Meta exige um exemplo para cada variável ({{1}}..{{${placeholders}}}).`);
      return;
    }
    const cleanButtons: TemplateButton[] = [];
    for (const b of buttons) {
      const text = b.text.trim();
      if (!text) continue;
      if (b.type === 'URL') {
        if (!/^https?:\/\/.+/.test(b.url.trim())) {
          setFormError('Botão de link: informe uma URL válida (https://…).');
          return;
        }
        cleanButtons.push({ type: 'URL', text, url: b.url.trim() });
      } else {
        cleanButtons.push({ type: 'QUICK_REPLY', text });
      }
    }
    setSaving(true);
    try {
      const res = await api.createTemplate({
        name: slug,
        category,
        body: body.trim(),
        ...(header.trim() ? { header: header.trim() } : {}),
        ...(footer.trim() ? { footer: footer.trim() } : {}),
        examples: filled,
        ...(cleanButtons.length > 0 ? { buttons: cleanButtons } : {}),
      });
      if (res.success && res.data) {
        flash(`Template "${res.data.name}" enviado pra aprovação da Meta (status: ${STATUS_LABEL[res.data.status] ?? res.data.status}). A análise costuma levar de minutos a 24h.`);
        setName('');
        setHeader('');
        setBody('');
        setFooter('');
        setExamples([]);
        setButtons([]);
        await reload();
      } else {
        setFormError(res.error ?? 'Falha ao enviar o template.');
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = async (template: WhatsAppTemplate) => {
    if (!window.confirm(`Excluir o template "${template.name}" da conta Meta? Automations que o usam vão falhar.`)) return;
    const res = await api.deleteTemplate(template.name);
    if (res.success) {
      flash(`Template "${template.name}" excluído.`);
      await reload();
    } else {
      flash(res.error ?? 'Falha ao excluir.');
    }
  };

  return (
    <main className="page">
      <div className="toolbar">
        <div>
          <h1 className="title-large">Templates do WhatsApp</h1>
          <div className="muted">
            Mensagens pré-aprovadas pela Meta — únicas permitidas para iniciar conversa fora da janela de 24h no número oficial.
          </div>
        </div>
        <button type="button" className="btn" onClick={reload} disabled={loading} aria-label="Atualizar status">
          <RefreshCw size={14} />Atualizar
        </button>
      </div>

      {feedback ? <div className="flash" role="status">{feedback}</div> : null}
      {loadError ? <p className="error">{loadError}</p> : null}

      {!configured ? (
        <div className="card muted">
          Gestão de templates não configurada: defina <code>META_WABA_ID</code> (WhatsApp Business Account ID) no
          ambiente da API — o token precisa da permissão <code>whatsapp_business_management</code>.
        </div>
      ) : (
        <>
          <section className="template-editor">
            <div className="card" style={{ display: 'grid', gap: '10px' }}>
              <h2 className="section-title"><Plus size={15} />Novo template</h2>
              <div className="field">
                <span className="muted">Nome (minúsculas e underscore — vira o identificador na Meta)</span>
                <input className="input" placeholder="Ex.: qara_confirmacao_consulta" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="field">
                <span className="muted">Categoria</span>
                <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
                  {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div className="field">
                <span className="muted">Cabeçalho (opcional — título curto no topo)</span>
                <input className="input" maxLength={60} placeholder="Ex.: Confirmação de consulta" value={header} onChange={(e) => setHeader(e.target.value)} />
              </div>
              <div className="field">
                <span className="muted">{'Corpo — use {{1}}, {{2}}… para variáveis (ex.: nome, horário)'}</span>
                <textarea
                  className="textarea"
                  rows={3}
                  placeholder={'Olá {{1}}! Sua consulta na Clínica QARA está agendada para {{2}}. Podemos confirmar?'}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
              </div>
              {placeholders > 0 ? (
                <div className="field">
                  <span className="muted">Exemplos das variáveis (a Meta exige para aprovar)</span>
                  {Array.from({ length: placeholders }, (_, i) => (
                    <input
                      key={i}
                      className="input"
                      placeholder={`Exemplo para {{${i + 1}}}${i === 0 ? ' — ex.: Maria' : ''}`}
                      value={examples[i] ?? ''}
                      onChange={(e) => setExamples((cur) => {
                        const next = [...cur];
                        next[i] = e.target.value;
                        return next;
                      })}
                    />
                  ))}
                </div>
              ) : null}
              <div className="field">
                <span className="muted">Rodapé (opcional)</span>
                <input className="input" maxLength={60} placeholder="Ex.: Clínica QARA — dermatologia" value={footer} onChange={(e) => setFooter(e.target.value)} />
              </div>

              <div className="field">
                <span className="muted">Botões (opcional — resposta rápida ou link, até {MAX_BUTTONS})</span>
                {buttons.map((b, i) => (
                  <div className="template-button-row" key={i}>
                    <select
                      className="select"
                      value={b.type}
                      onChange={(e) => setButtons((cur) => cur.map((x, j) => j === i ? { ...x, type: e.target.value as DraftButton['type'] } : x))}
                    >
                      <option value="QUICK_REPLY">Resposta rápida</option>
                      <option value="URL">Link</option>
                    </select>
                    <input
                      className="input"
                      maxLength={25}
                      placeholder="Texto do botão (ex.: Confirmar)"
                      value={b.text}
                      onChange={(e) => setButtons((cur) => cur.map((x, j) => j === i ? { ...x, text: e.target.value } : x))}
                    />
                    {b.type === 'URL' ? (
                      <input
                        className="input"
                        placeholder="https://…"
                        value={b.url}
                        onChange={(e) => setButtons((cur) => cur.map((x, j) => j === i ? { ...x, url: e.target.value } : x))}
                      />
                    ) : null}
                    <button className="icon-btn" type="button" aria-label={`Remover botão ${i + 1}`} onClick={() => setButtons((cur) => cur.filter((_, j) => j !== i))}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                {buttons.length < MAX_BUTTONS ? (
                  <button
                    className="btn"
                    type="button"
                    style={{ justifySelf: 'start' }}
                    onClick={() => setButtons((cur) => [...cur, { type: 'QUICK_REPLY', text: '', url: '' }])}
                  >
                    <Plus size={14} />Adicionar botão
                  </button>
                ) : null}
              </div>

              {formError ? <p className="error">{formError}</p> : null}
              <div>
                <button className="btn btn-primary" type="button" disabled={saving} onClick={submit}>
                  <Plus size={14} />{saving ? 'Enviando…' : 'Enviar pra aprovação'}
                </button>
              </div>
            </div>

            <div className="template-preview-col">
              <span className="muted" style={{ fontSize: '12px' }}>Prévia</span>
              <TemplatePreview header={header} body={body} footer={footer} buttons={buttons} examples={examples} />
            </div>
          </section>

          <section style={{ marginTop: '16px', display: 'grid', gap: '10px' }}>
            <h2 className="section-title"><FileText size={15} />Templates na conta ({templates.length})</h2>
            {loading ? <div className="card muted">Consultando a Meta…</div> : null}
            {!loading && templates.length === 0 ? (
              <div className="card muted">Nenhum template ainda — crie o primeiro acima.</div>
            ) : null}
            {templates.map((template) => (
              <article className="card" key={template.id || template.name} style={{ display: 'grid', gap: '8px' }}>
                <div style={{ alignItems: 'center', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <strong>{template.name}</strong>
                  <span className={`chip ${STATUS_CHIP[template.status] ?? ''}`}>{STATUS_LABEL[template.status] ?? template.status.toLowerCase()}</span>
                  <span className="chip">{template.category.toLowerCase()}</span>
                  <span className="chip">{template.language}</span>
                  <button
                    className="btn btn-danger"
                    type="button"
                    style={{ marginLeft: 'auto' }}
                    onClick={() => remove(template)}
                  >
                    <Trash2 size={14} />Excluir
                  </button>
                </div>
                {template.header ? <div style={{ fontWeight: 600 }}>{template.header}</div> : null}
                <div style={{ whiteSpace: 'pre-wrap' }}>{template.body}</div>
                {template.footer ? <div className="faint">{template.footer}</div> : null}
                {template.buttons.length > 0 ? (
                  <div className="chips">
                    {template.buttons.map((b, i) => (
                      <span className="chip chip-accent" key={i}>
                        {b.type === 'URL' ? <ExternalLink size={11} /> : <Reply size={11} />}{b.text}
                      </span>
                    ))}
                  </div>
                ) : null}
                {template.status === 'REJECTED' && template.rejectedReason ? (
                  <p className="error">Motivo da rejeição: {template.rejectedReason}</p>
                ) : null}
              </article>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
