import { mergeRecord, recordKey, type RecordPayload } from "./record-merge";

const STORAGE_KEY = "bond-issuance-workbench-v1";
type LocalImport = { id: string; dataset_type: string; trade_date: string; week_start: string; file_name: string; record_count: number; created_at: string };
type LocalRecord = Record<string, unknown> & { id: number; import_id: string; dataset_type: string; trade_date: string; week_start: string; bond_code: string; raw_json: string };
type LocalState = { imports: LocalImport[]; records: LocalRecord[]; drafts: Record<string, { summary_text: string; review_text: string; updated_at: string }> };

function emptyState(): LocalState { return { imports: [], records: [], drafts: {} }; }
function readState(): LocalState {
  if (typeof window === "undefined") return emptyState();
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as LocalState | null;
    return parsed?.imports && parsed?.records && parsed?.drafts ? parsed : emptyState();
  } catch { return emptyState(); }
}
function writeState(state: LocalState) { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } }); }

function storedRecord(payload: RecordPayload, metadata: { id: number; importId: string; datasetType: string; weekStart: string; tradeDate: string }): LocalRecord {
  return {
    id: metadata.id, import_id: metadata.importId, dataset_type: metadata.datasetType,
    trade_date: payload.tradeDate || metadata.tradeDate, week_start: metadata.weekStart, bond_code: payload.bondCode || "",
    short_name: payload.shortName || "", full_name: payload.fullName || "", issuer: payload.issuer || "", region: payload.region || "",
    bond_type: payload.bondType || "", issuance_route: payload.issuanceRoute || "", venue: payload.venue || "", bid_time: payload.bidTime || "",
    tenor: payload.tenor || "", amount: payload.amount ?? null, spread: payload.spread ?? null, floor_rate: payload.floorRate ?? null,
    fee: payload.fee ?? null, distribution_date: payload.distributionDate || "", remark: payload.remark || "", raw_json: JSON.stringify(payload.raw || {}),
  };
}

export async function workbenchFetch(input: string, init: RequestInit = {}) {
  const url = new URL(input, window.location.href);
  const state = readState();
  const method = (init.method || "GET").toUpperCase();
  if (method === "GET") {
    if (url.searchParams.get("meta") === "latest") {
      const latestDates: Record<string, string> = {};
      state.records.forEach(row => { if (!latestDates[row.dataset_type] || row.trade_date > latestDates[row.dataset_type]) latestDates[row.dataset_type] = row.trade_date; });
      return json({ latestDates });
    }
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    if (startDate && endDate) {
      const datasetType = url.searchParams.get("datasetType") === "local_bond" ? "local_bond" : "spread";
      const records = state.records.filter(row => row.dataset_type === datasetType && row.trade_date >= startDate && row.trade_date <= endDate)
        .sort((a, b) => `${a.trade_date}|${a.id}`.localeCompare(`${b.trade_date}|${b.id}`));
      return json({ records });
    }
    const weekStart = url.searchParams.get("weekStart") || "";
    return json({
      imports: state.imports.filter(row => row.week_start === weekStart).sort((a, b) => a.created_at.localeCompare(b.created_at)),
      records: state.records.filter(row => row.week_start === weekStart).sort((a, b) => `${a.trade_date}|${a.id}`.localeCompare(`${b.trade_date}|${b.id}`)),
      draft: state.drafts[weekStart] || null,
    });
  }
  if (method === "DELETE") {
    const importId = url.searchParams.get("importId");
    if (!importId) return json({ error: "缺少 importId" }, 400);
    state.imports = state.imports.filter(row => row.id !== importId);
    state.records = state.records.filter(row => row.import_id !== importId);
    writeState(state);
    return json({ ok: true });
  }
  if (method === "POST") {
    const payload = JSON.parse(String(init.body || "{}")) as {
      action?: string; datasetType?: string; tradeDate?: string; weekStart?: string; fileName?: string;
      records?: RecordPayload[]; summaryText?: string; reviewText?: string;
    };
    if (payload.action === "saveDraft") {
      if (!payload.weekStart) return json({ error: "周起始日无效" }, 400);
      state.drafts[payload.weekStart] = { summary_text: payload.summaryText || "", review_text: payload.reviewText || "", updated_at: new Date().toISOString() };
      writeState(state);
      return json({ ok: true });
    }
    if (!payload.datasetType || !payload.tradeDate || !payload.weekStart || !payload.fileName || !payload.records?.length) return json({ error: "上传数据不完整" }, 400);
    const existingByKey = new Map(state.records.filter(row => row.dataset_type === payload.datasetType).map(row => [recordKey({ tradeDate: row.trade_date, bondCode: row.bond_code }), row]));
    const importId = crypto.randomUUID();
    let inserted = 0, updated = 0, unchanged = 0;
    payload.records.forEach((incoming, index) => {
      const normalized = { ...incoming, tradeDate: incoming.tradeDate || payload.tradeDate };
      const existing = existingByKey.get(recordKey(normalized));
      const merged = mergeRecord(normalized, existing);
      if (!merged.changed) { unchanged += 1; return; }
      const row = storedRecord(merged.record, { id: existing?.id || Date.now() * 1000 + index, importId, datasetType: payload.datasetType!, weekStart: payload.weekStart!, tradeDate: payload.tradeDate! });
      if (existing) { state.records[state.records.indexOf(existing)] = row; updated += 1; }
      else { state.records.push(row); inserted += 1; }
    });
    if (inserted || updated) state.imports.push({ id: importId, dataset_type: payload.datasetType, trade_date: payload.tradeDate, week_start: payload.weekStart, file_name: payload.fileName, record_count: inserted + updated, created_at: new Date().toISOString() });
    writeState(state);
    return json({ ok: true, inserted, updated, unchanged }, 201);
  }
  return json({ error: "不支持的请求" }, 405);
}

export function downloadLocalBackup() {
  const blob = new Blob([JSON.stringify(readState())], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `利率债工作台数据备份_${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function restoreLocalBackup(file: File) {
  const parsed = JSON.parse(await file.text()) as LocalState;
  if (!parsed?.imports || !parsed?.records || !parsed?.drafts) throw new Error("备份文件格式不正确");
  writeState(parsed);
}
