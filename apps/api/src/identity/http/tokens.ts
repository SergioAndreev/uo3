/** Токены DI модуля identity. */
export const IDENTITY = Symbol('identity');
export const IDENTITY_HTTP = Symbol('identity-http');

export interface IdentityHttpOptions {
  secureCookies: boolean;
}
