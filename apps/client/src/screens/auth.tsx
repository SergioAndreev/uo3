import { Button, Notice, Panel, TextField } from '@duskmarch/ui-kit';
import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { ApiError } from '../api/client.js';
import { DEFAULT_AUTHED, safeReturnTo } from '../app/return-to.js';
import { consumeSensitive } from '../app/sensitive.js';
import { tokenOf } from '../session/browser.js';
import { useServices } from '../services.js';
import {
  PASSWORD_MIN,
  formatLeft,
  messageOf,
  useCountdown,
  type AuthBody,
  type Documents,
} from './auth-common.js';

const MFA_ATTEMPTS = 5;
const PROVIDER_NAMES: Record<string, string> = { discord: 'Discord', google: 'Google' };

/** Документы и провайдеры OAuth. */
function useDocuments(): Documents | null {
  const { api } = useServices();
  const [docs, setDocs] = useState<Documents | null>(null);
  useEffect(() => {
    void api.get<Documents>('/api/v1/auth/documents', { auth: false }).then(
      (r) => setDocs(r.data),
      () => setDocs(null),
    );
  }, [api]);
  return docs;
}

interface Ban {
  reason: string;
  expiresAt: string | null;
}

/** Вход: email и пароль, шаг второго фактора, OAuth. */
export function LoginScreen() {
  const { api, store, apiBaseUrl } = useServices();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const location = useLocation();
  const docs = useDocuments();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ban, setBan] = useState<Ban | null>(null);
  const [lock, setLock] = useCountdown();
  const initialChallenge =
    (location.state as { mfaChallengeToken?: string } | null)?.mfaChallengeToken ?? null;
  const [challenge, setChallenge] = useState<string | null>(initialChallenge);
  const [challengeUntil, setChallengeUntil] = useState(Date.now() + 300_000);
  const [code, setCode] = useState('');
  const [backup, setBackup] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const returnTo = safeReturnTo(params.get('returnTo')) ?? DEFAULT_AUTHED;

  const finish = (body: AuthBody) => {
    const token = tokenOf(body);
    if (!token) return;
    store.accept(token);
    void navigate(token.kind === 'staff_setup' ? '/2fa-setup' : returnTo, { replace: true });
  };

  const fail = (e: unknown) => {
    if (e instanceof ApiError && e.code === 'SEC_ACCOUNT_BANNED') {
      setBan({
        reason: String(e.details['reason'] ?? ''),
        expiresAt: (e.details['expiresAt'] as string | null) ?? null,
      });
      return;
    }
    if (e instanceof ApiError && e.status === 429) setLock(e.retryAfterS ?? 60);
    setError(messageOf(e));
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy || lock > 0) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<AuthBody>(
        '/api/v1/auth/login',
        { email, password },
        { auth: false },
      );
      if (r.data.status === 'mfa_required' && r.data.mfaChallengeToken) {
        setChallenge(r.data.mfaChallengeToken);
        setChallengeUntil(Date.now() + (r.data.expiresIn ?? 300) * 1000);
        setAttempts(0);
      } else finish(r.data);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!challenge || busy) return;
    if (Date.now() > challengeUntil) {
      setChallenge(null);
      setError('Время подтверждения истекло: войдите снова');
      return;
    }
    setBusy(true);
    try {
      const r = await api.post<AuthBody>(
        '/api/v1/auth/mfa/verify',
        { challengeToken: challenge, code: code.trim() },
        { auth: false },
      );
      finish(r.data);
    } catch (e) {
      const next = attempts + 1;
      setAttempts(next);
      if (
        next >= MFA_ATTEMPTS ||
        (e instanceof ApiError && e.status === 401 && e.code !== 'TFA_INVALID_CODE')
      ) {
        setChallenge(null);
        setError('Попытки подтверждения исчерпаны: войдите снова');
      } else setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  if (ban) {
    return (
      <Panel title="Аккаунт заблокирован">
        <Notice tone="error">
          <p data-testid="ban-reason">{ban.reason}</p>
          <p data-testid="ban-until">
            {ban.expiresAt ? `До ${new Date(ban.expiresAt).toLocaleString('ru-RU')}` : 'Бессрочно'}
          </p>
        </Notice>
      </Panel>
    );
  }

  if (challenge) {
    const valid = backup
      ? /^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$/.test(code.trim())
      : /^\d{6}$/.test(code.trim());
    return (
      <Panel title="Подтверждение входа">
        <form onSubmit={verify}>
          <TextField
            label={backup ? 'Резервный код' : 'Код из приложения'}
            value={code}
            onChange={setCode}
            autoComplete="one-time-code"
            maxLength={backup ? 9 : 6}
            error={error}
          />
          <Button type="submit" busy={busy} disabled={!valid}>
            Подтвердить
          </Button>
          <Button variant="ghost" onClick={() => setBackup((v) => !v)}>
            {backup ? 'Ввести код из приложения' : 'Использовать резервный код'}
          </Button>
        </form>
      </Panel>
    );
  }

  return (
    <Panel title="Вход">
      {params.get('reason') && <Notice tone="warning">Сессия завершена: войдите снова</Notice>}
      <form onSubmit={submit}>
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
        />
        <TextField
          label="Пароль"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          error={error}
        />
        {lock > 0 && <Notice tone="warning">Повторить можно через {formatLeft(lock)}</Notice>}
        <Button type="submit" busy={busy} disabled={lock > 0 || !email || !password}>
          Войти
        </Button>
      </form>
      <nav>
        {docs?.oauthProviders.map((p) => (
          <a
            key={p}
            className="dm-button"
            data-variant="ghost"
            href={`${apiBaseUrl}/api/v1/auth/oauth/${p}/start`}
          >
            Войти через {PROVIDER_NAMES[p] ?? p}
          </a>
        ))}
        <a href="/register">Регистрация</a> <a href="/reset-password">Забыли пароль?</a>
      </nav>
    </Panel>
  );
}

/** Регистрация: документы, правила пароля, ожидание письма с повторной отправкой. */
export function RegisterScreen() {
  const { api } = useServices();
  const docs = useDocuments();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useCountdown();
  const weak = password.length > 0 && [...password].length < PASSWORD_MIN;

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!docs) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(
        '/api/v1/auth/register',
        {
          email,
          password,
          tosAccepted: agreed,
          tosVersion: docs.tosVersion,
          privacyVersion: docs.privacyVersion,
        },
        { auth: false },
      );
      setSent(true);
      setResendIn(60);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Panel title="Проверьте почту">
        <p data-testid="register-sent">
          Если адрес свободен, мы отправили на него письмо со ссылкой подтверждения.
        </p>
        <Button
          variant="ghost"
          disabled={resendIn > 0}
          onClick={() => {
            void api
              .post('/api/v1/auth/verify-email/resend', { email }, { auth: false })
              .catch(() => undefined);
            setResendIn(60);
          }}
        >
          {resendIn > 0 ? `Отправить ещё раз через ${resendIn} с` : 'Отправить ещё раз'}
        </Button>
      </Panel>
    );
  }
  return (
    <Panel title="Регистрация">
      <form onSubmit={submit}>
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
        />
        <TextField
          label="Пароль"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          hint={`Не короче ${PASSWORD_MIN} символов`}
          error={weak ? `Не короче ${PASSWORD_MIN} символов` : error}
        />
        <label>
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />{' '}
          Принимаю условия ({docs?.tosVersion ?? '…'}) и политику конфиденциальности (
          {docs?.privacyVersion ?? '…'})
        </label>
        <Button
          type="submit"
          busy={busy}
          disabled={!docs || !agreed || weak || !email || !password}
        >
          Создать аккаунт
        </Button>
      </form>
    </Panel>
  );
}

/** Подтверждение email по одноразовой ссылке (токен уже изъят из адреса). */
export function VerifyEmailScreen() {
  const { api } = useServices();
  const [state, setState] = useState<'pending' | 'ok' | 'failed' | 'missing'>('pending');
  useEffect(() => {
    const token = consumeSensitive('token');
    if (!token) {
      setState('missing');
      return;
    }
    void api.post('/api/v1/auth/verify-email', { token }, { auth: false }).then(
      () => setState('ok'),
      () => setState('failed'),
    );
  }, [api]);
  return (
    <Panel title="Подтверждение email">
      {state === 'pending' && <p>Проверяем ссылку…</p>}
      {state === 'ok' && (
        <Notice tone="success">
          Email подтверждён. <a href="/login">Войти</a>
        </Notice>
      )}
      {(state === 'failed' || state === 'missing') && (
        <Notice tone="warning">
          Ссылка недействительна или устарела: запросите новое письмо на экране входа.
        </Notice>
      )}
    </Panel>
  );
}

/** Сброс пароля: запрос письма или новый пароль по одноразовой ссылке. */
export function ResetPasswordScreen() {
  const { api } = useServices();
  const [token] = useState(() => consumeSensitive('token'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<'form' | 'requested' | 'done' | 'expired'>(
    token ? 'form' : 'form',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = async (ev: FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    await api
      .post('/api/v1/auth/password-reset/request', { email }, { auth: false })
      .catch(() => undefined);
    setBusy(false);
    setState('requested');
  };

  const confirm = async (ev: FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(
        '/api/v1/auth/password-reset/confirm',
        { token, newPassword: password },
        { auth: false },
      );
      setState('done');
    } catch (e) {
      if (e instanceof ApiError && (e.status === 400 || e.status === 410 || /TOKEN/.test(e.code)))
        setState('expired');
      else setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  if (state === 'done')
    return (
      <Notice tone="success">
        Пароль изменён. <a href="/login">Войти</a>
      </Notice>
    );
  if (state === 'requested')
    return <Notice>Если аккаунт существует, мы отправили письмо со ссылкой сброса.</Notice>;
  if (token && state === 'form') {
    return (
      <Panel title="Новый пароль">
        <form onSubmit={confirm}>
          <TextField
            label="Новый пароль"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            error={error}
          />
          <Button type="submit" busy={busy} disabled={[...password].length < PASSWORD_MIN}>
            Сохранить
          </Button>
        </form>
      </Panel>
    );
  }
  return (
    <Panel title="Сброс пароля">
      {state === 'expired' && (
        <Notice tone="warning">Ссылка истекла или уже использована: запросите новую.</Notice>
      )}
      <form onSubmit={request}>
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
        />
        <Button type="submit" busy={busy} disabled={!email}>
          Отправить ссылку
        </Button>
      </form>
    </Panel>
  );
}
