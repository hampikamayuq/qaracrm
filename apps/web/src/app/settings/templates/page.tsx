'use client';

// Templates HSM do WhatsApp oficial: criar → aprovação da Meta → usar fora
// da janela de 24h. Status vem direto da Meta (fonte da verdade).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { api, type WhatsAppTemplate } from '@/lib/api';

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

const countPlaceholders = (body: string): number => {
  let max = 0;
  for (const match of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    max = Math.max(max, Number(match[1]));
  }
  return max;
};

export default function TemplatesSettingsPage() {
  const [configured, setConfigured] = useState(true);
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [feedback, setFeedback] = useState('');

  const [name, setName] = useState('');
  const [category, setCategory] = useState('UTILITY');
  const [body, setBody] = useState('');
  const [footer, setFooter] = useState('');
  const [examples, setExamples] = useState<string[]>([]);
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
    setSaving(true);
    try {
      const res = await api.createTemplate({
        name: slug,
        category,
        body: body.trim(),
        ...(footer.trim() ? { footer: footer.trim() } : {}),
        examples: filled,
      });
      if (res.success && res.data) {
        flash(`Template "${res.data.name}" enviado pra aprovação da Meta (status: ${STATUS_LABEL[res.data.status] ?? res.data.status}). A análise costuma levar de minutos a 24h.`);
        setName('');
        setBody('');
        setFooter('');
        setExamples([]);
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
          <section className="card" style={{ display: 'grid', gap: '10px' }}>
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
              <input className="input" placeholder="Ex.: Clínica QARA — dermatologia" value={footer} onChange={(e) => setFooter(e.target.value)} />
            </div>
            {formError ? <p className="error">{formError}</p> : null}
            <div>
              <button className="btn btn-primary" type="button" disabled={saving} onClick={submit}>
                <Plus size={14} />{saving ? 'Enviando…' : 'Enviar pra aprovação'}
              </button>
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
                <div style={{ alignItems: 'center', display: 'flex', gap: '8px' }}>
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
                <div style={{ whiteSpace: 'pre-wrap' }}>{template.body}</div>
                {template.footer ? <div className="faint">{template.footer}</div> : null}
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
