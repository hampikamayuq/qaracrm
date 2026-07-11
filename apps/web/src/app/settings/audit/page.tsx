'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ScrollText } from 'lucide-react';
import { api, type AuditLogPage } from '@/lib/api';

const formatDate = (value: string) =>
  new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

const formatJson = (value: unknown) => JSON.stringify(value, null, 2);

export default function AuditSettingsPage() {
  const [data, setData] = useState<AuditLogPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getAuditLog({
        entity: entity || undefined,
        action: action || undefined,
        from: from || undefined,
        // "até" inclusivo: fim do dia local.
        to: to ? `${to}T23:59:59` : undefined,
        page,
      });
      setData(result);
    } finally {
      setLoading(false);
    }
  }, [entity, action, from, to, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <main className="page">
      <div className="toolbar">
        <div>
          <h1 className="title-large">Auditoria</h1>
          <div className="muted">Quem fez o quê, quando — mudanças sensíveis do sistema ficam registradas aqui.</div>
        </div>
      </div>

      <div className="toolbar">
        <select
          className="select"
          value={entity}
          onChange={(event) => {
            setEntity(event.target.value);
            setPage(1);
          }}
          aria-label="Filtrar por entidade"
        >
          <option value="">Todas as entidades</option>
          {(data?.entities ?? []).map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <input
          className="input"
          type="search"
          placeholder="Buscar por ação (ex.: update)"
          value={action}
          onChange={(event) => {
            setAction(event.target.value);
            setPage(1);
          }}
          aria-label="Buscar por ação"
        />
        <input
          className="input"
          type="date"
          value={from}
          onChange={(event) => {
            setFrom(event.target.value);
            setPage(1);
          }}
          aria-label="Data inicial"
        />
        <input
          className="input"
          type="date"
          value={to}
          onChange={(event) => {
            setTo(event.target.value);
            setPage(1);
          }}
          aria-label="Data final"
        />
      </div>

      {loading && !data ? <div className="card muted">Carregando auditoria…</div> : null}

      {data && data.items.length === 0 ? (
        <div className="card">
          <strong><ScrollText size={15} /> Nenhum registro.</strong>
          <div className="muted">Nada foi auditado ainda com esses filtros.</div>
        </div>
      ) : null}

      {data && data.items.length > 0 ? (
        <div className="card">
          <table className="report-table">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Quem</th>
                <th>Ação</th>
                <th>Entidade</th>
                <th>ID</th>
                <th>Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.id}>
                  <td>{formatDate(item.createdAt)}</td>
                  <td>
                    {item.userName ?? (
                      <span className="muted">{item.userId ? 'usuário removido' : 'sistema'}</span>
                    )}
                  </td>
                  <td>{item.action}</td>
                  <td>{item.entity}</td>
                  <td className="muted">{item.entityId}</td>
                  <td>
                    {item.before != null || item.after != null ? (
                      <details>
                        <summary className="muted">before/after</summary>
                        <pre style={{ fontSize: 11, maxWidth: 420, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                          {item.before != null ? `before: ${formatJson(item.before)}\n` : ''}
                          {item.after != null ? `after: ${formatJson(item.after)}` : ''}
                        </pre>
                      </details>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {data ? (
        <div className="toolbar">
          <button
            className="btn"
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((cur) => Math.max(1, cur - 1))}
          >
            <ChevronLeft size={15} /> Anterior
          </button>
          <span className="muted">
            Página {data.page} de {totalPages} · {data.total} registros
          </span>
          <button
            className="btn"
            type="button"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((cur) => cur + 1)}
          >
            Próxima <ChevronRight size={15} />
          </button>
        </div>
      ) : null}
    </main>
  );
}
