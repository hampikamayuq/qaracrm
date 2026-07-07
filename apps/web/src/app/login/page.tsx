'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogIn } from 'lucide-react';
import { api } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    const res = await api.login(email, password);
    if (res.success && res.data?.token) {
      sessionStorage.setItem('auth_token', res.data.token);
      router.push('/inbox');
      return;
    }
    setError(res.error ?? 'Login falhou');
  };

  return (
    <main className="login">
      <div className="login-panel">
        <div className="login-brand">
          <span className="brand-mark" aria-hidden="true">Q</span>
          <div>
            <strong>QARA CRM</strong>
            <small>Acesso da operação</small>
          </div>
        </div>
        <form className="form" onSubmit={submit}>
          <label className="field">
            <span>E-mail</span>
            <input
              className="input"
              type="email"
              autoComplete="email"
              placeholder="nome@clinicaqara.com.br"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>Senha</span>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              placeholder="Sua senha"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error ? <p className="error" role="alert">{error}</p> : null}
          <button className="btn btn-primary btn-block" type="submit"><LogIn size={16} />Entrar</button>
        </form>
        <p className="login-foot">Acesso restrito à equipe da Clínica QARA.</p>
      </div>
    </main>
  );
}
