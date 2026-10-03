import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateKeyPair,
  exportJWK,
  SignJWT,
} from '../backend/node_modules/jose/dist/webapi/index.js';
import { provider, callback } from '../backend/auth.mjs';
const issuer = 'https://school.example';
test('OIDC code grant verifies signatures, nonce, issuer, audience and UserInfo subject', async () => {
  const keys = await generateKeyPair('RS256');
  const wrong = await generateKeyPair('RS256');
  const jwk = await exportJWK(keys.publicKey);
  jwk.kid = 'key';
  let scenario = 'valid',
    nonce = '';
  const asJson = (value) =>
    new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  const fake = async (input, options) => {
    const path = new URL(input).pathname;
    if (path === '/.well-known/openid-configuration')
      return asJson({
        issuer,
        authorization_endpoint: issuer + '/auth',
        token_endpoint: issuer + '/token',
        userinfo_endpoint: issuer + '/userinfo',
        jwks_uri: issuer + '/jwks',
        response_types_supported: ['code'],
        subject_types_supported: ['pairwise'],
        id_token_signing_alg_values_supported: ['RS256'],
      });
    if (path === '/jwks') return asJson({ keys: [jwk] });
    if (path === '/userinfo')
      return asJson({ sub: scenario === 'subject' ? 'different' : 'demo-sub', 'iserv:roles': [] });
    if (path === '/token') {
      const body = new URLSearchParams(options.body);
      assert.ok(body.get('code_verifier'));
      assert.equal(body.get('redirect_uri'), callback);
      assert.equal(body.get('client_secret'), 'fake-secret');
      const token = await new SignJWT({ nonce: scenario === 'nonce' ? 'bad' : nonce })
        .setProtectedHeader({ alg: 'RS256', kid: 'key' })
        .setSubject('demo-sub')
        .setIssuer(scenario === 'issuer' ? 'https://other.invalid' : issuer)
        .setAudience(scenario === 'audience' ? 'other' : 'client')
        .setIssuedAt()
        .setExpirationTime(scenario === 'expired' ? Math.floor(Date.now() / 1000) - 600 : '5m')
        .sign(scenario === 'signature' ? wrong.privateKey : keys.privateKey);
      return asJson({
        access_token: 'test-only',
        token_type: 'Bearer',
        expires_in: 300,
        id_token: token,
      });
    }
    throw new Error('Unexpected test URL');
  };
  const client = await provider('client', 'fake-secret', fake);
  for (scenario of ['valid', 'signature', 'nonce', 'issuer', 'audience', 'subject', 'expired']) {
    const tx = await client.begin();
    nonce = tx.nonce;
    const url = new URL(callback);
    url.searchParams.set('code', 'demo-code');
    url.searchParams.set('state', tx.state);
    if (scenario === 'valid') {
      const result = await client.complete(url, tx);
      assert.equal(result.subject, 'demo-sub');
    } else await assert.rejects(client.complete(url, tx), undefined, scenario);
  }
});
