import { Button, Notice, Panel, TextField } from '@duskmarch/ui-kit';
import QRCode from 'qrcode';
import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { ApiError } from '../api/client.js';
import { DEFAULT_AUTHED } from '../app/return-to.js';
import { consumeSensitive } from '../app/sensitive.js';
import { tokenOf } from '../session/browser.js';
import { useServices } from '../services.js';
import { messageOf, type AuthBody } from './auth-common.js';

/** Возврат от провайдера: код и state уже изъяты из адреса и передаются в API. */
export function OAuthCallbackScreen() {
  const { api, store } = useServices();
  const navigate = useNavigate();
  const { provider = '' } = useParams();
  const [state, setState] = useState<'pending' | 'link_required' | 'failed'>('pending');
  useEffect(() => {
    const code = consumeSensitive('code');
    const st = consumeSensitive('state');
    if (!code || !st) {
      setState('failed');
      return;
    }
    const q = new URLSearchParams({ code, state: st });
    void api
      .get<AuthBody>(`/api/v1/auth/oauth/${encodeURIComponent(provider)}/callback?${q}`, {
        auth: false,
      })
      .then(
        ({ data }) => {
          if (data.status === 'tos_acceptance_required') {
            void navigate('/oauth/onboarding', {
              replace: true,
              state: {
                token: data.oauthOnboardingToken,
                tosVersion: data.tosVersion,
                privacyVersion: data.privacyVersion,
              },
            });
          } else if (data.status === 'mfa_required') {
            void navigate('/login', {
              replace: true,
              state: { mfaChallengeToken: data.mfaChallengeToken },
            });
          } else {
            const token = tokenOf(data);
            if (!token) return setState('failed');
            store.accept(token);
            void navigate(token.kind === 'staff_setup' ? '/2fa-setup' : DEFAULT_AUTHED, {
              replace: true,
            });
          }
        },
        (e: unknown) =>
          setState(
            e instanceof ApiError && e.code === 'AUTH_OAUTH_ACCOUNT_LINK_REQUIRED'
              ? 'link_required'
              : 'failed',
          ),
      );
  }, [api, store, navigate, provider]);
  if (state === 'link_required') {
    return (
      <Notice tone="warning">
        <span data-testid="link-required">
          Аккаунт с этим email уже есть. Войдите паролем и привяжите провайдера в настройках
          безопасности.
        </span>
      </Notice>
    );
  }
  if (state === 'failed')
    return (
      <Notice tone="error">
        Вход через провайдера не удался. <a href="/login">Попробовать снова</a>
      </Notice>
    );
  return <p>Завершаем вход…</p>;
}

/** Принятие документов при первой регистрации через OAuth (токен — только в памяти маршрута). */
export function OAuthOnboardingScreen() {
  const { api, store } = useServices();
  const navigate = useNavigate();
  const st = useLocation().state as {
    token?: string;
    tosVersion?: string;
    privacyVersion?: string;
  } | null;
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!st?.token)
    return (
      <Notice tone="warning">
        Сессия регистрации истекла. <a href="/login">Войти</a>
      </Notice>
    );
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    try {
      const r = await api.post<AuthBody>(
        '/api/v1/auth/oauth/onboard',
        {
          onboardingToken: st.token,
          tosAccepted: true,
          tosVersion: st.tosVersion,
          privacyVersion: st.privacyVersion,
        },
        { auth: false },
      );
      const token = tokenOf(r.data);
      if (token) {
        store.accept(token);
        void navigate(token.kind === 'staff_setup' ? '/2fa-setup' : DEFAULT_AUTHED, {
          replace: true,
        });
      }
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Почти готово">
      <form onSubmit={submit}>
        <label>
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />{' '}
          Принимаю условия ({st.tosVersion}) и политику конфиденциальности ({st.privacyVersion})
        </label>
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" busy={busy} disabled={!agreed}>
          Продолжить
        </Button>
      </form>
    </Panel>
  );
}

/** Обязательная настройка второго фактора персоналом: QR и ключ, код, резервные коды. */
export function TwoFactorSetupScreen() {
  const { api, store } = useServices();
  const navigate = useNavigate();
  const [setup, setSetup] = useState<{
    setupToken: string;
    otpauthUri: string;
    manualKey: string;
  } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [session, setSession] = useState<AuthBody | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .post<{ setupToken: string; otpauthUri: string; manualKey: string }>(
        '/api/v1/account/2fa/setup',
        {},
      )
      .then(
        async ({ data }) => {
          setSetup(data);
          setQr(
            await QRCode.toDataURL(data.otpauthUri, { margin: 1, width: 192 }).catch(() => null),
          );
        },
        (e: unknown) => setError(messageOf(e)),
      );
  }, [api]);

  const confirm = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!setup) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ backupCodes: string[]; session: AuthBody }>(
        '/api/v1/account/2fa/confirm',
        { setupToken: setup.setupToken, code: code.trim() },
      );
      setCodes(r.data.backupCodes);
      setSession(r.data.session);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const done = () => {
    const token = session ? tokenOf({ ...session, status: 'authenticated' }) : null;
    if (token) store.accept(token);
    void navigate(DEFAULT_AUTHED, { replace: true });
  };

  if (codes) {
    const text = codes.join('\n');
    return (
      <Panel title="Резервные коды">
        <Notice tone="warning">
          Коды показываются один раз. Сохраните их — каждый можно использовать вместо кода
          приложения.
        </Notice>
        <pre data-testid="backup-codes">{text}</pre>
        <Button variant="ghost" onClick={() => void navigator.clipboard?.writeText(text)}>
          Копировать
        </Button>
        <a
          className="dm-button"
          data-variant="ghost"
          download="duskmarch-backup-codes.txt"
          href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}
        >
          Скачать
        </a>
        <label>
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> Я
          сохранил резервные коды
        </label>
        <Button disabled={!saved} onClick={done}>
          Продолжить
        </Button>
      </Panel>
    );
  }
  return (
    <Panel title="Настройка второго фактора">
      <p>
        Для персонала второй фактор обязателен. Отсканируйте код в приложении-аутентификаторе или
        введите ключ вручную.
      </p>
      {qr && <img src={qr} alt="QR-код для приложения-аутентификатора" width={192} height={192} />}
      {setup && <code data-testid="manual-key">{setup.manualKey}</code>}
      <form onSubmit={confirm}>
        <TextField
          label="Код из приложения"
          value={code}
          onChange={setCode}
          maxLength={6}
          autoComplete="one-time-code"
          error={error}
        />
        <Button type="submit" busy={busy} disabled={!/^\d{6}$/.test(code.trim()) || !setup}>
          Подтвердить
        </Button>
      </form>
    </Panel>
  );
}
