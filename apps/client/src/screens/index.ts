import type { ComponentType } from 'react';
import { SCREENS, type ScreenKey } from '../app/routes.js';

type Loader = () => Promise<{ default: ComponentType }>;

const auth =
  (name: 'LoginScreen' | 'RegisterScreen' | 'VerifyEmailScreen' | 'ResetPasswordScreen'): Loader =>
  () =>
    import('./auth.js').then((m) => ({ default: m[name] }));
const oauth =
  (name: 'OAuthCallbackScreen' | 'OAuthOnboardingScreen' | 'TwoFactorSetupScreen'): Loader =>
  () =>
    import('./oauth-2fa.js').then((m) => ({ default: m[name] }));

const READY: Partial<Record<ScreenKey, Loader>> = {
  login: auth('LoginScreen'),
  register: auth('RegisterScreen'),
  verifyEmail: auth('VerifyEmailScreen'),
  resetPassword: auth('ResetPasswordScreen'),
  oauthCallback: oauth('OAuthCallbackScreen'),
  oauthOnboarding: oauth('OAuthOnboardingScreen'),
  twoFactorSetup: oauth('TwoFactorSetupScreen'),
};

/** Ленивые модули экранов по ключу маршрута. */
export const SCREEN_MODULES = Object.fromEntries(
  SCREENS.map((key) => [
    key,
    READY[key] ?? (() => import('./stub.js').then((m) => ({ default: m.stub(key) }))),
  ]),
) as Record<ScreenKey, Loader>;
