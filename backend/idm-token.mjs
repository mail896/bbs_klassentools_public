// Machine credentials and tokens remain server-side. Coalesce concurrent renewals.
export function tokenSource(credentials, fetchImplementation = fetch, now = Date.now) {
  if (
    !credentials ||
    !['clientId', 'clientSecret'].every(
      (k) => typeof credentials[k] === 'string' && credentials[k].length > 0,
    )
  )
    throw new Error('Invalid IDM credentials');
  let cached = null,
    pending = null;
  return async () => {
    if (cached && cached.until > now()) return cached.token;
    if (pending) return pending;
    pending = (async () => {
      const r = await fetchImplementation('https://school.example/iserv/auth/public/token', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          scope: 'iserv:idm:api-read',
        }),
      });
      if (!r.ok) throw new Error('IDM token unavailable');
      const data = await r.json();
      const ttl = Number(data.expires_in);
      if (
        typeof data.access_token !== 'string' ||
        !data.access_token ||
        !Number.isFinite(ttl) ||
        ttl <= 60 ||
        ttl > 86400
      )
        throw new Error('Invalid IDM token response');
      if (
        data.scope !== undefined &&
        (typeof data.scope !== 'string' || data.scope.trim() !== 'iserv:idm:api-read')
      )
        throw new Error('Unexpected IDM token scope');
      cached = { token: data.access_token, until: now() + (ttl - 60) * 1000 };
      return cached.token;
    })();
    try {
      return await pending;
    } finally {
      pending = null;
    }
  };
}
