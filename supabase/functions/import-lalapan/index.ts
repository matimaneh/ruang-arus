import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const secretKeysText = Deno.env.get("SUPABASE_SECRET_KEYS");
const secretKeys = secretKeysText ? JSON.parse(secretKeysText) : {};
const serviceKey = secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !serviceKey) throw new Error("Supabase server credentials are unavailable.");

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function safeEqual(a: string, b: string) {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) mismatch |= left[i] ^ right[i];
  return mismatch === 0;
}

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const normalized = new Date(Date.UTC(year, month - 1, day));
  return normalized.getUTCFullYear() === year && normalized.getUTCMonth() === month - 1 && normalized.getUTCDate() === day;
}

function rupiah(value: number) {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(value);
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Metode tidak didukung." }, 405);

  const { data: expectedSecret, error: secretError } = await admin.rpc("get_lalapan_sync_secret");
  if (secretError || typeof expectedSecret !== "string" || !expectedSecret) {
    console.error("Import secret is not configured.");
    return json({ error: "Integrasi belum dikonfigurasi." }, 503);
  }
  const providedSecret = request.headers.get("x-lalapan-sync") || "";
  if (!safeEqual(providedSecret, expectedSecret)) return json({ error: "Tidak diizinkan." }, 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Isi rekap tidak valid." }, 400);
  }

  const { date, turnover, hpp, cost, net_profit: netProfit } = body;
  const values = [turnover, hpp, cost, netProfit].map(Number);
  if (!isDate(date) || values.some(value => !Number.isFinite(value)) || values.slice(0, 3).some(value => value < 0)) {
    return json({ error: "Tanggal atau nominal rekap tidak valid." }, 400);
  }
  const [sales, recipeCost, operatingCost, sourceNet] = values;
  const calculatedNet = sales - recipeCost - operatingCost;
  if (Math.abs(calculatedNet - sourceNet) > 1) {
    return json({ error: "Laba bersih tidak cocok dengan omzet, HPP, dan biaya." }, 422);
  }

  const { data: userPage, error: userError } = await admin.auth.admin.listUsers({ page: 1, perPage: 2 });
  if (userError || !userPage?.users || userPage.users.length !== 1) {
    console.error("Import requires exactly one Ruang Arus account.");
    return json({ error: "Akun tujuan belum dapat dipastikan." }, 409);
  }

  const userId = userPage.users[0].id;
  const businessId = `lalapan-${date}`;
  const incomeId = `lalapan-income-${date}`;
  const grossProfit = sales - recipeCost;
  const importedAt = new Date().toISOString();
  const dateForTitle = new Intl.DateTimeFormat("id-ID", {
    day: "numeric", month: "short", timeZone: "Asia/Makassar",
  }).format(new Date(`${date}T00:00:00+08:00`));

  const business = {
    id: businessId,
    date,
    turnover: sales,
    hpp: recipeCost,
    cost: operatingCost,
    note: `Rekap otomatis dari Lalapan Legenda. Laba bersih: Rp ${rupiah(sourceNet)}.`,
    source: "lalapan-legenda",
    personalIncomeId: grossProfit > 0 ? incomeId : null,
  };
  const rows: Array<Record<string, unknown>> = [{
    user_id: userId,
    record_type: "business",
    record_id: businessId,
    payload: business,
    deleted_at: null,
    updated_at: importedAt,
  }];

  if (grossProfit > 0) {
    rows.push({
      user_id: userId,
      record_type: "transaction",
      record_id: incomeId,
      payload: {
        id: incomeId,
        type: "income",
        title: `Keuntungan usaha · ${dateForTitle}`,
        category: "Pendapatan usaha",
        date,
        amount: grossProfit,
        note: `Omzet Rp ${rupiah(sales)} − HPP Rp ${rupiah(recipeCost)}. Diimpor otomatis dari Lalapan Legenda.`,
        source: "Usaha",
        entryMethod: "business",
        businessEntryId: businessId,
        created: importedAt,
      },
      deleted_at: null,
      updated_at: importedAt,
    });
  } else {
    rows.push({
      user_id: userId,
      record_type: "transaction",
      record_id: incomeId,
      payload: { id: incomeId, deleted: true },
      deleted_at: importedAt,
      updated_at: importedAt,
    });
  }

  const { error: writeError } = await admin
    .from("finance_records")
    .upsert(rows, { onConflict: "user_id,record_type,record_id" });
  if (writeError) {
    console.error("Daily finance import failed.", writeError.message);
    return json({ error: "Rekap belum berhasil disimpan." }, 500);
  }

  return json({ ok: true, date, businessImported: true, personalIncomeImported: grossProfit > 0 });
});
