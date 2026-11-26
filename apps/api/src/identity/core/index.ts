import { AuthService } from './auth.js';
import { Identity, type IdentityDeps } from './context.js';
import { OAuthService, type OAuthSettings } from './oauth.js';
import { RegistrationService } from './registration.js';
import { SecurityService } from './security.js';
import { StaffService } from './staff.js';
import { TwoFactorService } from './two-factor.js';

export * from './auth.js';
export * from './context.js';
export * from './errors.js';
export * from './oauth.js';
export * from './outbox.js';
export { RegistrationService } from './registration.js';
export { SecurityService } from './security.js';
export { StaffService } from './staff.js';
export { TwoFactorService } from './two-factor.js';

export interface IdentityServices {
  identity: Identity;
  registration: RegistrationService;
  auth: AuthService;
  tfa: TwoFactorService;
  security: SecurityService;
  staff: StaffService;
  oauth: OAuthService;
}

export function createIdentityServices(deps: IdentityDeps, oauth: OAuthSettings): IdentityServices {
  const identity = new Identity(deps);
  const registration = new RegistrationService(identity);
  const auth = new AuthService(identity);
  const tfa = new TwoFactorService(identity, auth);
  return {
    identity,
    registration,
    auth,
    tfa,
    security: new SecurityService(identity, auth, tfa),
    staff: new StaffService(identity, auth, tfa),
    oauth: new OAuthService(identity, auth, registration, oauth),
  };
}
