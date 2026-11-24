(() => {
  const cfg = window.RUANG_ARUS_BACKEND;
  const SESSION_KEY = 'ruang-arus-session-v1';
  const headers = token => ({ apikey: cfg.publishableKey, authorization: `Bearer ${token || cfg.publishableKey}`, 'content-type': 'application/json' });
  const session = () => { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } };
  const saveSession = value => value ? localStorage.setItem(SESSION_KEY, JSON.stringify(value)) : localStorage.removeItem(SESSION_KEY);
  const callback = new URLSearchParams(location.hash.slice(1));
  if (callback.get('access_token')) {
    saveSession({ access_token: callback.get('access_token'), refresh_token: callback.get('refresh_token'), expires_at: Math.floor(Date.now() / 1000) + Number(callback.get('expires_in') || 3600), user: { email: 'Akun terverifikasi' } });
    history.replaceState(null, '', location.pathname + location.search);
  }
  async function request(path, options = {}, token) {
    const response = await fetch(`${cfg.url}${path}`, { ...options, headers: { ...headers(token), ...(options.headers || {}) } });
    const body = await response.text();
    let parsed = null; try { parsed = body ? JSON.parse(body) : null; } catch { parsed = body; }
    if (!response.ok) throw new Error(parsed?.msg || parsed?.message || parsed?.error_description || parsed?.hint || parsed?.details || `Permintaan gagal (${response.status})`);
    return parsed;
  }
  async function auth(path, email, password) {
    const redirect = path === 'signup' ? `?redirect_to=${encodeURIComponent(location.origin + location.pathname)}` : '';
    const result = await request(`/auth/v1/${path}${redirect}`, { method: 'POST', body: JSON.stringify({ email, password }) });
    if (result.access_token) saveSession(result);
    return result;
  }
  async function token() {
    let s = session(); if (!s) throw new Error('Silakan masuk terlebih dahulu.');
    if (s.expires_at && s.expires_at * 1000 < Date.now() + 60_000 && s.refresh_token) {
      s = await request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: s.refresh_token }) }); saveSession(s);
    }
    return s.access_token;
  }
  async function getSnapshot() {
    const t = await token();
    const rows = await request('/rest/v1/finance_records?record_type=eq.app_state&record_id=eq.app-state&select=payload,updated_at&limit=1', {}, t);
    const transactions = await request('/rest/v1/finance_records?record_type=eq.transaction&deleted_at=is.null&select=record_id,payload&limit=5000', {}, t);
    const business = await request('/rest/v1/finance_records?record_type=eq.business&deleted_at=is.null&select=record_id,payload&limit=5000', {}, t);
    const snapshot = rows?.[0] || null;
    if (snapshot) {
      snapshot.payload.transactions = [...new Map([...(snapshot.payload.transactions || []), ...(transactions || []).map(row => row.payload)].map(item => [item.id, item])).values()];
      snapshot.payload.business = [...new Map([...(snapshot.payload.business || []), ...(business || []).map(row => row.payload)].map(item => [item.id, item])).values()];
    } else if (transactions?.length || business?.length) return { payload: { transactions: transactions.map(row => row.payload), business: business.map(row => row.payload) } };
    return snapshot;
  }
  async function putSnapshot(snapshot) {
    const t = await token();
    const user = await request('/auth/v1/user', {}, t);
    const records = [{ user_id: user.id, record_type: 'app_state', record_id: 'app-state', payload: snapshot, deleted_at: null }];
    for (const item of snapshot.transactions || []) records.push({ user_id: user.id, record_type: 'transaction', record_id: item.id, payload: item, deleted_at: null });
    for (const item of snapshot.business || []) records.push({ user_id: user.id, record_type: 'business', record_id: item.id, payload: item, deleted_at: null });
    for (const id of snapshot.syncDeleted || []) records.push({ user_id: user.id, record_type: 'transaction', record_id: id, payload: { id, deleted: true }, deleted_at: new Date().toISOString() });
    for (const id of snapshot.syncDeletedBusiness || []) records.push({ user_id: user.id, record_type: 'business', record_id: id, payload: { id, deleted: true }, deleted_at: new Date().toISOString() });
    await request('/rest/v1/finance_records?on_conflict=user_id%2Crecord_type%2Crecord_id', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(records)
    }, t);
  }
  async function makeLinkCode() {
    const t = await token();
    const user = await request('/auth/v1/user', {}, t);
    const code = crypto.getRandomValues(new Uint8Array(8));
    const plain = [...code].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plain));
    const code_hash = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
    const expires_at = new Date(Date.now() + 15 * 60_000).toISOString();
    await request('/rest/v1/whatsapp_link_codes?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ user_id: user.id, code_hash, expires_at, used_at: null }) }, t);
    return plain;
  }
  window.RuangBackend = {
    session, enabled: () => Boolean(session()), setEnabled: () => {},
    signIn: (email, password) => auth('token?grant_type=password', email, password),
    signUp: (email, password) => auth('signup', email, password),
    signOut: async () => { const s = session(); if (s?.access_token) await request('/auth/v1/logout', { method: 'POST' }, s.access_token).catch(() => {}); saveSession(null); },
    getSnapshot, putSnapshot, makeLinkCode
  };
})();
