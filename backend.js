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
  const recordCollections = {
    transaction: 'transactions',
    business: 'business',
    installment: 'installments',
    note: 'notes',
    savings_goal: 'savingsGoals',
    savings_transfer: 'savingsTransfers'
  };
  async function getSnapshot() {
    const t = await token();
    const stateRows = await request('/rest/v1/finance_records?record_type=eq.app_state&record_id=eq.app-state&select=payload,updated_at&limit=1', {}, t);
    const allRows = await request('/rest/v1/finance_records?record_type=in.%28transaction,business,installment,note,savings_goal,savings_transfer%29&select=record_type,record_id,payload,deleted_at&limit=5000', {}, t);
    const payload = stateRows?.[0]?.payload ? structuredClone(stateRows[0].payload) : {};
    const recordsByType = Object.fromEntries(Object.keys(recordCollections).map(type => [type, []]));
    const seenTypes = new Set();
    payload.syncDeletedRecords ||= [];
    payload.syncDeletedAt ||= {};
    payload.syncDeleted ||= [];
    payload.syncDeletedBusiness ||= [];
    for (const row of allRows || []) {
      const collection = recordCollections[row.record_type];
      if (!collection) continue;
      seenTypes.add(row.record_type);
      if (row.deleted_at) {
        const id = row.record_id;
        recordsByType[row.record_type].push({ id, deleted: true, updatedAt: row.deleted_at });
        const old = Date.parse(payload.syncDeletedAt[id] || '') || 0;
        if (Date.parse(row.deleted_at) > old) payload.syncDeletedAt[id] = row.deleted_at;
        if (!payload.syncDeleted.includes(id)) payload.syncDeleted.push(id);
        if (row.record_type === 'business' && !payload.syncDeletedBusiness.includes(id)) payload.syncDeletedBusiness.push(id);
        const key = row.record_type + ':' + id;
        const tombstone = { id, recordType: row.record_type, deletedAt: row.deleted_at };
        const existing = payload.syncDeletedRecords.find(item => item.recordType + ':' + item.id === key);
        if (!existing) payload.syncDeletedRecords.push(tombstone);
        else if (Date.parse(row.deleted_at) > Date.parse(existing.deletedAt || '')) existing.deletedAt = row.deleted_at;
      } else {
        recordsByType[row.record_type].push(row.payload);
      }
    }
    for (const [type, collection] of Object.entries(recordCollections)) {
      if (seenTypes.has(type)) payload[collection] = recordsByType[type].filter(item => !item.deleted);
    }
    if (!stateRows?.length && !allRows?.length) return null;
    return { payload };
  }
  async function putSnapshot(snapshot) {
    const t = await token();
    const user = await request('/auth/v1/user', {}, t);
    const now = new Date().toISOString();
    const records = [{ user_id: user.id, record_type: 'app_state', record_id: 'app-state', payload: snapshot, deleted_at: null, updated_at: now }];
    const typedIds = new Set();
    for (const [type, collection] of Object.entries(recordCollections)) {
      for (const item of snapshot[collection] || []) {
        typedIds.add(type + ':' + item.id);
        records.push({ user_id: user.id, record_type: type, record_id: item.id, payload: item, deleted_at: null, updated_at: item.updatedAt || item.updated_at || item.updated || item.created || now });
      }
    }
    const tombstones = new Map();
    for (const item of snapshot.syncDeletedRecords || []) {
      if (!item?.id || !recordCollections[item.recordType]) continue;
      const key = item.recordType + ':' + item.id;
      if (!typedIds.has(key)) tombstones.set(key, item);
    }
    const typedDeletedIds = new Set([...tombstones.values()].map(item => item.id));
    for (const id of snapshot.syncDeleted || []) {
      if (!typedDeletedIds.has(id) && !typedIds.has('transaction:' + id)) {
        const deletedAt = snapshot.syncDeletedAt?.[id] || now;
        const item = { id, recordType: 'transaction', deletedAt };
        tombstones.set('transaction:' + id, item);
      }
    }
    for (const id of snapshot.syncDeletedBusiness || []) {
      if (!typedIds.has('business:' + id)) {
        const deletedAt = snapshot.syncDeletedAt?.[id] || now;
        tombstones.set('business:' + id, { id, recordType: 'business', deletedAt });
      }
    }
    for (const item of tombstones.values()) {
      const deletedAt = item.deletedAt || snapshot.syncDeletedAt?.[item.id] || now;
      records.push({ user_id: user.id, record_type: item.recordType, record_id: item.id, payload: { id: item.id, deleted: true, updatedAt: deletedAt }, deleted_at: deletedAt, updated_at: deletedAt });
    }
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
