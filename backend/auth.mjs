import * as oidc from 'openid-client';
const issuer = 'https://school.example';
export const callback = 'https://apps.school.example/klassentools/oidc/callback';
export function rolesOf(info) {
  const roles = info['iserv:roles'];
  if (!Array.isArray(roles)) return [];
  return roles
    .filter((r) => r && typeof r.uuid === 'string' && typeof r.displayName === 'string')
    .map((r) => ({ uuid: r.uuid, name: r.displayName }));
}
export function teacherAllowed(info, uuid) {
  return typeof uuid === 'string' && uuid.length > 0 && rolesOf(info).some((r) => r.uuid === uuid);
}
export function groupsOf(info) {
  return Array.isArray(info['iserv:groups'])
    ? info['iserv:groups']
        .filter(
          (g) =>
            g &&
            typeof g.id === 'string' &&
            typeof g.act === 'string' &&
            typeof g.name === 'string',
        )
        .map((g) => ({ id: g.id, account: g.act, name: g.name }))
    : [];
}
export async function provider(clientId, secret, fetchImplementation = fetch) {
  const safeFetch = async (input, options) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.origin !== issuer) throw new Error('Unexpected OIDC origin');
    return fetchImplementation(input, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
  };
  const config = await oidc.discovery(
    new URL(issuer),
    clientId,
    { client_secret: secret, id_token_signed_response_alg: 'RS256' },
    oidc.ClientSecretPost(secret),
    { [oidc.customFetch]: safeFetch, execute: [oidc.enableNonRepudiationChecks], timeout: 8 },
  );
  return {
    async begin() {
      const verifier = oidc.randomPKCECodeVerifier(),
        state = oidc.randomState(),
        nonce = oidc.randomNonce();
      const url = oidc.buildAuthorizationUrl(config, {
        redirect_uri: callback,
        scope: 'openid profile iserv:uuid iserv:roles iserv:groups',
        response_type: 'code',
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method: 'S256',
        state,
        nonce,
      });
      return { verifier, state, nonce, url: url.href };
    },
    async complete(url, transaction) {
      const tokens = await oidc.authorizationCodeGrant(config, url, {
        pkceCodeVerifier: transaction.verifier,
        expectedState: transaction.state,
        expectedNonce: transaction.nonce,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims?.sub) throw new Error('Missing identity');
      const info = await oidc.fetchUserInfo(config, tokens.access_token, claims.sub);
      return {
        subject: claims.sub,
        info,
        accessToken: tokens.access_token,
        expires: Math.min(
          claims.exp * 1000,
          Date.now() + Math.max(0, Number(tokens.expires_in || 300)) * 1000,
          Date.now() + 3600000,
        ),
      };
    },
    async refresh(session) {
      return oidc.fetchUserInfo(config, session.accessToken, session.subject);
    },
  };
}
