import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const encoder = new TextEncoder();
const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function verifySignature(rawBody: Uint8Array, signature: string | null): Promise<boolean> {
  const secret = env("WHATSAPP_APP_SECRET");
  if (!signature?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, rawBody));
  const expected = "sha256=" + [...mac].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return safeEqual(expected, signature);
}

function apiRoot(): string { return env("SUPABASE_URL").replace(/\/$/, "") + "/rest/v1"; }
function serviceHeaders(extra: Record<string, string> = {}): HeadersInit {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  return { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", ...extra };
}

async function rest(path: string, method = "GET", body?: unknown, prefer = "return=representation"): Promise<any> {
  const response = await fetch(`${apiRoot()}/${path}`, {
    method,
    headers: serviceHeaders({ Prefer: prefer }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${method} ${path}: ${response.status} ${text.slice(0, 240)}`);
  return text ? JSON.parse(text) : null;
}

function parseDigits(raw: string, unit = ""): number {
  const digits = Number(raw.replace(/[.,\s]/g, ""));
  const multiplier = /^(juta|jt)$/i.test(unit) ? 1_000_000 : /^(ribu|rb|k)$/i.test(unit) ? 1_000 : 1;
  return digits * multiplier;
}

function parseWords(raw: string): number | null {
  const units: Record<string, number> = {
    nol: 0, se: 1, satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6,
    tujuh: 7, delapan: 8, sembilan: 9, sepuluh: 10, sebelas: 11,
  };
  const tokens = raw.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  let total = 0, current = 0, found = false;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "ribu" || token === "rb" || token === "ribuannya") { total += (current || 1) * 1_000; current = 0; found = true; continue; }
    if (token === "juta" || token === "jt") { total += (current || 1) * 1_000_000; current = 0; found = true; continue; }
    if (token === "puluh") { current = (current || 1) * 10; found = true; continue; }
    if (token === "ratus") { current = (current || 1) * 100; found = true; continue; }
    if (Object.hasOwn(units, token)) { current += units[token]; found = true; continue; }
    return null;
  }
  const value = total + current;
  return found && value > 0 ? value : null;
}

function extractAmount(text: string): { amount: number; fragment: string } | null {
  const numeric = text.match(/(?:rp\s*)?(\d[\d.,\s]*?)\s*(juta|jt|ribu|rb|k)?\b/i);
  if (numeric) {
    const amount = parseDigits(numeric[1], numeric[2] || "");
    if (amount > 0 && Number.isFinite(amount)) return { amount: Math.round(amount), fragment: numeric[0] };
  }
  const words = text.match(/\b(?:satu|se|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas|dua belas|tiga belas|empat belas|lima belas|enam belas|tujuh belas|delapan belas|sembilan belas)(?:\s+(?:puluh|belas|ratus|ribu|rb|juta|jt|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan))*\s*(?:ribu|rb|juta|jt)?\b/i);
  if (words) {
    const amount = parseWords(words[0]);
    if (amount && Number.isFinite(amount)) return { amount, fragment: words[0] };
  }
  return null;
}

const categoryRules: Array<[RegExp, string]> = [
  [/\b(jajan|cemilan|snack|es|kopi)\b/i, "Jajan"],
  [/\b(makan|sarapan|makan siang|makan malam|nasi)\b/i, "Makan"],
  [/\b(bensin|pertalite|pertamax|solar)\b/i, "Bensin"],
  [/\b(ojek|gojek|grab|angkot|parkir|transport)\b/i, "Transportasi"],
  [/\b(tagihan|listrik|air|wifi|internet)\b/i, "Tagihan"],
  [/\b(obat|dokter|klinik|kesehatan)\b/i, "Kesehatan"],
];

function parseTransaction(text: string, timestamp?: string) {
  const lower = text.toLowerCase().trim();
  const amountData = extractAmount(lower);
  if (!amountData) return null;
  const type = /\b(masuk|gaji|bonus|terima|pemasukan)\b/i.test(lower) ? "income" : "expense";
  const categoryMatch = categoryRules.find(([pattern]) => pattern.test(lower));
  const category = categoryMatch?.[1] ? categoryMatch[1] : (type === "income" ? "Pendapatan lain" : "Lainnya");
  const sourceMatch = lower.match(/@([\p{L}\d_-]+)/u) || lower.match(/(?:sumber|dari)\s+(tunai|cash|bank|bca|bri|bni|mandiri|qris|gopay|ovo|dana|shopeepay)/i);
  const source = sourceMatch ? (sourceMatch[1].charAt(0).toUpperCase() + sourceMatch[1].slice(1)) : "Tunai";
  const removeAmount = amountData.fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let title = lower.replace(new RegExp(removeAmount, "i"), " ")
    .replace(/\b(keluar|masuk|catat|catatkan|pengeluaran|pemasukan|jajan|cemilan|snack|makan|sarapan|siang|malam|nasi|bensin|pertalite|pertamax|solar|ojek|gojek|grab|angkot|parkir|transportasi|tagihan|listrik|air|wifi|internet|obat|dokter|klinik|kesehatan|tunai|cash|bca|bri|bni|mandiri|qris|gopay|ovo|dana|shopeepay)\b/gi, " ")
    .replace(/@([\p{L}\d_-]+)/gu, " ").replace(/\b(rp|rupiah|ribu|rb|juta|jt)\b/gi, " ").replace(/\s+/g, " ").trim();
  title = title ? `beli ${title}` : category.toLowerCase();
  const date = timestamp ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Number(timestamp) * 1_000)) : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return {
    id: crypto.randomUUID(), type, title, category, amount: amountData.amount, date, note: "",
    source, entryMethod: "WhatsApp", created: new Date().toISOString(),
    transactionCode: `TX-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
  };
}

async function linkedUser(waId: string): Promise<string | null> {
  const rows = await rest(`whatsapp_links?wa_id=eq.${encodeURIComponent(waId)}&select=user_id&limit=1`);
  return rows?.[0]?.user_id || null;
}

async function sendText(to: string, body: string): Promise<void> {
  const version = Deno.env.get("WHATSAPP_GRAPH_VERSION") || "v27.0";
  const phoneId = env("WHATSAPP_PHONE_NUMBER_ID");
  const response = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${env("WHATSAPP_ACCESS_TOKEN")}`, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body } }),
  });
  if (!response.ok) console.error("WhatsApp send failed", response.status, (await response.text()).slice(0, 200));
}

async function claimMessage(messageId: string, waId: string, type: string): Promise<boolean> {
  const rows = await rest("whatsapp_events?on_conflict=message_id", "POST", [{ message_id: messageId, wa_id: waId, message_type: type, outcome: "received" }], "resolution=ignore-duplicates,return=representation");
  return Array.isArray(rows) && rows.length === 1;
}

async function linkAccount(waId: string, code: string): Promise<string | null> {
  const codeHash = await sha256(code.toUpperCase());
  const rows = await rest(`whatsapp_link_codes?code_hash=eq.${codeHash}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&used_at=is.null&select=user_id&limit=1`);
  const userId = rows?.[0]?.user_id;
  if (!userId) return null;
  const existing = await rest(`whatsapp_links?user_id=eq.${userId}&select=wa_id&limit=1`);
  if (existing?.[0] && existing[0].wa_id !== waId) {
    await rest(`whatsapp_links?user_id=eq.${userId}`, "PATCH", { wa_id: waId, linked_at: new Date().toISOString() }, "return=minimal");
  } else {
    await rest("whatsapp_links?on_conflict=user_id", "POST", [{ user_id: userId, wa_id: waId }], "resolution=merge-duplicates,return=minimal");
  }
  await rest(`whatsapp_link_codes?user_id=eq.${userId}`, "PATCH", { used_at: new Date().toISOString() }, "return=minimal");
  return userId;
}

async function pendingFor(waId: string): Promise<any | null> {
  const rows = await rest(`whatsapp_pending?wa_id=eq.${encodeURIComponent(waId)}&state=eq.pending&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=*&order=created_at.desc&limit=1`);
  return rows?.[0] || null;
}

async function daySummary(userId: string, date: string) {
  const rows = await rest(`finance_records?user_id=eq.${userId}&record_type=eq.transaction&deleted_at=is.null&select=payload&limit=2000`);
  let income = 0, expense = 0;
  for (const row of rows || []) {
    const tx = row.payload || {};
    if (tx.date !== date) continue;
    if (tx.type === "income") income += Number(tx.amount) || 0;
    else if (tx.type === "expense") expense += Number(tx.amount) || 0;
  }
  return { income, expense, balance: income - expense };
}

function transactionReceipt(tx: any, summary: { income: number; expense: number; balance: number }) {
  const typeLabel = tx.type === "income" ? "Masuk" : "Keluar";
  return [
    `Oke, ${tx.type === "income" ? "pemasukan" : "pengeluaran"} sudah dicatat!`,
    "",
    "Detail transaksi",
    `No. catatan  ${tx.transactionCode}`,
    `${typeLabel}  Rp ${new Intl.NumberFormat("id-ID").format(tx.amount)}`,
    `Sumber dana  ${tx.source}`,
    `Kategori  ${tx.category}`,
    `Keterangan  ${tx.title}`,
    "",
    "Ringkasan hari ini",
    `Masuk  Rp ${new Intl.NumberFormat("id-ID").format(summary.income)}`,
    `Keluar  Rp ${new Intl.NumberFormat("id-ID").format(summary.expense)}`,
    `Sisa  Rp ${new Intl.NumberFormat("id-ID").format(summary.balance)}`,
    "",
    "Salah? Balas BATAL atau HAPUS 1 untuk membatalkan catatan terakhir.",
  ].join("\n");
}

async function handleMessage(message: any): Promise<void> {
  const waId = String(message.from_user_id || message.from || "");
  if (!waId || !message.id) return;
  const type = String(message.type || "unknown");
  if (!await claimMessage(String(message.id), waId, type)) return;

  const text = type === "text" ? String(message.text?.body || "").trim() : type === "image" ? String(message.image?.caption || "").trim() : "";
  const linkMatch = text.match(/^hubungkan\s+([a-z\d-]{12,40})$/i);
  if (linkMatch) {
    const userId = await linkAccount(waId, linkMatch[1]);
    await sendText(waId, userId ? "WhatsApp berhasil ditautkan ke Ruang Arus. Kirim contoh: jajan sepuluh ribu beli es" : "Kode tidak berlaku atau sudah kedaluwarsa. Buat kode tautan baru di Pengaturan aplikasi.");
    return;
  }

  const userId = await linkedUser(waId);
  if (!userId) {
    await sendText(waId, "Nomor ini belum ditautkan. Buka Ruang Arus → Pengaturan → Integrasi WhatsApp → Buat kode, lalu kirim: hubungkan KODE-ANDA");
    return;
  }

  if (type === "image") {
    await sendText(waId, "Foto sudah diterima. Untuk menjaga privasi, pembacaan foto dilakukan di aplikasi Ruang Arus pada perangkat Anda. Buka aplikasi → ＋ → Baca dari foto. Untuk catatan WhatsApp, kirim teks seperti: jajan sepuluh ribu beli es.");
    return;
  }
  if (type !== "text") {
    await sendText(waId, "Saya bisa mencatat pesan teks. Contoh: jajan sepuluh ribu beli es, atau masuk 5 juta gaji.");
    return;
  }

  const command = text.toLowerCase().trim();
  const pending = await pendingFor(waId);
  if (/^(batal|cancel|tidak jadi|ga jadi|gak jadi)$/.test(command)) {
    if (pending) {
      await rest(`whatsapp_pending?id=eq.${pending.id}`, "PATCH", { state: "cancelled", completed_at: new Date().toISOString() }, "return=minimal");
      await sendText(waId, "Draf transaksi dibatalkan. Tidak ada catatan yang disimpan.");
      return;
    }
    await undoLatest(waId, userId);
    return;
  }
  if (/^(hapus\s+1|hapus terakhir|undo|kembalikan)$/.test(command)) {
    if (pending) {
      await rest(`whatsapp_pending?id=eq.${pending.id}`, "PATCH", { state: "cancelled", completed_at: new Date().toISOString() }, "return=minimal");
      await sendText(waId, "Draf transaksi dibatalkan. Tidak ada catatan yang disimpan.");
      return;
    }
    await undoLatest(waId, userId);
    return;
  }
  if (/^(simpan|ya|oke|ok|setuju|catat)$/.test(command)) {
    if (!pending) { await sendText(waId, "Tidak ada draf yang menunggu konfirmasi. Kirim catatan baru, misalnya: jajan sepuluh ribu beli es."); return; }
    const tx = pending.payload;
    await rest("finance_records?on_conflict=user_id%2Crecord_type%2Crecord_id", "POST", [{ user_id: userId, record_type: "transaction", record_id: tx.id, payload: tx }], "resolution=merge-duplicates,return=minimal");
    await rest(`whatsapp_pending?id=eq.${pending.id}`, "PATCH", { state: "confirmed", transaction_record_id: tx.id, completed_at: new Date().toISOString() }, "return=minimal");
    const summary = await daySummary(userId, tx.date);
    await sendText(waId, transactionReceipt(tx, summary));
    return;
  }

  const ts = message.timestamp;
  const tx = parseTransaction(text, ts);
  if (!tx) {
    await sendText(waId, "Saya belum menemukan nominalnya. Coba tulis: jajan sepuluh ribu beli es. Balas SIMPAN untuk menyimpan draf.");
    return;
  }
  if (pending) await rest(`whatsapp_pending?id=eq.${pending.id}`, "PATCH", { state: "cancelled", completed_at: new Date().toISOString() }, "return=minimal");
  await rest("whatsapp_pending", "POST", [{ user_id: userId, wa_id: waId, message_id: String(message.id), payload: tx }], "return=minimal");
  await sendText(waId, `Draf ${tx.type === "income" ? "pemasukan" : "pengeluaran"}\nRp ${new Intl.NumberFormat("id-ID").format(tx.amount)} · ${tx.category}\n${tx.title} · ${tx.source}\nTanggal ${tx.date}\n\nBalas SIMPAN untuk mencatat atau BATAL untuk membatalkan.`);
}

async function undoLatest(waId: string, userId: string): Promise<void> {
  const rows = await rest(`finance_records?user_id=eq.${userId}&record_type=eq.transaction&deleted_at=is.null&select=record_id,payload,updated_at&order=created_at.desc&limit=20`);
  const latest = (rows || []).find((row: any) => row.payload?.entryMethod === "WhatsApp");
  if (!latest) { await sendText(waId, "Tidak ada transaksi WhatsApp terakhir yang bisa dibatalkan."); return; }
  await rest(`finance_records?user_id=eq.${userId}&record_type=eq.transaction&record_id=eq.${encodeURIComponent(latest.record_id)}`, "PATCH", { deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }, "return=minimal");
  const date = latest.payload.date;
  const summary = await daySummary(userId, date);
  await sendText(waId, `Catatan ${latest.payload.transactionCode || "terakhir"} dibatalkan.\n\nRingkasan hari ini\nMasuk Rp ${new Intl.NumberFormat("id-ID").format(summary.income)}\nKeluar Rp ${new Intl.NumberFormat("id-ID").format(summary.expense)}\nSisa Rp ${new Intl.NumberFormat("id-ID").format(summary.balance)}`);
}

Deno.serve(async (request: Request) => {
  try {
    if (request.method === "GET") {
      const url = new URL(request.url);
      const mode = url.searchParams.get("hub.mode") || "";
      const token = url.searchParams.get("hub.verify_token") || "";
      const challenge = url.searchParams.get("hub.challenge") || "";
      if (mode === "subscribe" && safeEqual(token, env("WHATSAPP_VERIFY_TOKEN")) && challenge) return new Response(challenge, { status: 200 });
      return new Response("Forbidden", { status: 403 });
    }
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const raw = new Uint8Array(await request.arrayBuffer());
    if (!await verifySignature(raw, request.headers.get("x-hub-signature-256"))) return json({ error: "Invalid signature" }, 401);
    const body = JSON.parse(new TextDecoder().decode(raw));
    if (body.object !== "whatsapp_business_account") return json({ received: true });
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        for (const message of change.value?.messages || []) {
          try { await handleMessage(message); }
          catch (error) { console.error("WhatsApp message processing failed", error); }
        }
      }
    }
    return json({ received: true });
  } catch (error) {
    console.error("WhatsApp webhook error", error);
    return json({ error: "Webhook is not configured or request could not be processed" }, 500);
  }
});

