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
      <form className="login-card" onSubmit={submit}>
        <div>
          <h1 className="title">QARA CRM</h1>
          <p className="muted">Acesso da operacao</p>
        </div>
        <input
          className="input"
          type="email"
          autoComplete="email"
          placeholder="Email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <input
          className="input"
          type="password"
          autoComplete="current-password"
          placeholder="Senha"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        {error ? <p className="error">{error}</p> : null}
        <button className="btn btn-primary" type="submit"><LogIn size={17} />Entrar</button>
      </form>
    </main>
  );
}
