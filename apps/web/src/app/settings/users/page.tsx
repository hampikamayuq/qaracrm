'use client';

import { useCallback, useEffect, useState } from 'react';
import { KeyRound, UserPlus, Users } from 'lucide-react';
import { api, type ManagedUser, type UserRole } from '@/lib/api';

const ROLE_OPTIONS: Array<{ value: UserRole; label: string }> = [
  { value: 'admin', label: 'Admin' },
  { value: 'recepcao', label: 'Recepção' },
  { value: 'medico', label: 'Médico' },
  { value: 'financeiro', label: 'Financeiro' },
  { value: 'marketing', label: 'Marketing' },
];

const roleLabel = (role: string) => ROLE_OPTIONS.find((r) => r.value === role)?.label ?? role;

const formatDate = (value: string | null | undefined) => (
  value ? new Date(value).toLocaleDateString('pt-BR') : '—'
);

const EMPTY_FORM = { name: '', email: '', password: '', role: 'recepcao' as UserRole };

export default function UsersSettingsPage() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [feedback, setFeedback] = useState('');
  // id do usuário com o form de troca de senha aberto
  const [pwUserId, setPwUserId] = useState<string | null>(null);
  const [pwDraft, setPwDraft] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await api.listUsers());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const flash = (message: string) => {
    setFeedback(message);
    window.setTimeout(() => setFeedback(''), 4000);
  };

  const createUser = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreating(true);
    try {
      const res = await api.createUser(form);
      if (!res.success) {
        flash(res.error ?? 'Falha ao criar usuário.');
        return;
      }
      setForm(EMPTY_FORM);
      flash(`Usuário ${res.data?.name ?? ''} criado.`);
      await reload();
    } finally {
      setCreating(false);
    }
  };

  const update = async (user: ManagedUser, input: Parameters<typeof api.updateUser>[1], okMessage: string) => {
    setSavingId(user.id);
    try {
      const res = await api.updateUser(user.id, input);
      if (!res.success) {
        flash(res.error ?? 'Falha ao atualizar usuário.');
        return;
      }
      flash(okMessage);
      await reload();
    } finally {
      setSavingId(null);
    }
  };

  const savePassword = async (event: React.FormEvent, user: ManagedUser) => {
    event.preventDefault();
    await update(user, { password: pwDraft }, `Senha de ${user.name} trocada. Sessões antigas foram encerradas.`);
    setPwUserId(null);
    setPwDraft('');
  };

  return (
    <main className="page">
      <div className="toolbar">
        <div>
          <h1 className="title-large">Usuários</h1>
          <div className="muted">
            Quem acessa o CRM: crie atendentes, troque papéis e senhas, desative quem saiu.
          </div>
        </div>
      </div>

      {feedback ? <div className="flash" role="status">{feedback}</div> : null}

      <form className="card example-form" onSubmit={createUser}>
        <h2 className="section-title"><UserPlus size={15} /> Novo usuário</h2>
        <label className="field">
          <span>Nome</span>
          <input
            className="input"
            value={form.name}
            onChange={(event) => setForm((cur) => ({ ...cur, name: event.target.value }))}
            required
            placeholder="Ex.: Ana Souza"
          />
        </label>
        <label className="field">
          <span>E-mail</span>
          <input
            className="input"
            type="email"
            value={form.email}
            onChange={(event) => setForm((cur) => ({ ...cur, email: event.target.value }))}
            required
            placeholder="ana@qara.com"
          />
        </label>
        <label className="field">
          <span>Senha (mín. 8 caracteres)</span>
          <input
            className="input"
            type="password"
            value={form.password}
            onChange={(event) => setForm((cur) => ({ ...cur, password: event.target.value }))}
            required
            minLength={8}
          />
        </label>
        <label className="field">
          <span>Papel</span>
          <select
            className="select"
            value={form.role}
            onChange={(event) => setForm((cur) => ({ ...cur, role: event.target.value as UserRole }))}
          >
            {ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>
        <div className="suggestion-actions">
          <button className="btn btn-primary" disabled={creating} type="submit">
            <UserPlus size={14} />{creating ? 'Criando…' : 'Criar usuário'}
          </button>
        </div>
      </form>

      <section aria-labelledby="users-list-title">
        <h2 className="section-title" id="users-list-title">
          <Users size={15} /> Equipe ({users.length})
        </h2>
        {loading ? <div className="card muted">Carregando usuários…</div> : null}
        {!loading && (
          <div className="card">
            <table className="report-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>E-mail</th>
                  <th>Papel</th>
                  <th>Ativo</th>
                  <th>Criado em</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.name}</td>
                    <td>{user.email}</td>
                    <td>
                      {user.role === 'agente_ia' ? (
                        <span className="chip chip-ai">Agente IA</span>
                      ) : (
                        <select
                          className="select"
                          value={user.role}
                          disabled={savingId === user.id}
                          aria-label={`Papel de ${user.name}`}
                          onChange={(event) =>
                            void update(user, { role: event.target.value as UserRole }, `Papel de ${user.name} atualizado.`)}
                        >
                          {ROLE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td>
                      {user.active
                        ? <span className="chip chip-ok">Ativo</span>
                        : <span className="chip chip-danger">Inativo</span>}
                    </td>
                    <td>{formatDate(user.createdAt)}</td>
                    <td>
                      <div className="suggestion-actions">
                        <button
                          className={user.active ? 'btn btn-danger' : 'btn'}
                          type="button"
                          disabled={savingId === user.id}
                          onClick={() =>
                            void update(
                              user,
                              { active: !user.active },
                              user.active
                                ? `${user.name} desativado. Sessões encerradas.`
                                : `${user.name} reativado.`,
                            )}
                        >
                          {user.active ? 'Desativar' : 'Reativar'}
                        </button>
                        <button
                          className="btn"
                          type="button"
                          onClick={() => {
                            setPwUserId((cur) => (cur === user.id ? null : user.id));
                            setPwDraft('');
                          }}
                        >
                          <KeyRound size={14} />Trocar senha
                        </button>
                      </div>
                      {pwUserId === user.id ? (
                        <form className="suggestion-actions" onSubmit={(event) => void savePassword(event, user)}>
                          <input
                            className="input"
                            type="password"
                            value={pwDraft}
                            onChange={(event) => setPwDraft(event.target.value)}
                            required
                            minLength={8}
                            placeholder="Nova senha (mín. 8)"
                            aria-label={`Nova senha de ${user.name}`}
                          />
                          <button className="btn btn-primary" disabled={savingId === user.id} type="submit">
                            Salvar
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {users.length === 0 ? <div className="muted">Nenhum usuário encontrado.</div> : null}
          </div>
        )}
      </section>
    </main>
  );
}
