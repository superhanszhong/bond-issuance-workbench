import { mergeRecord, recordKey, type RecordPayload } from "./record-merge";

const STORAGE_KEY = "bond-issuance-workbench-v1";
const DATABASE_NAME = "bond-issuance-workbench";
const DATABASE_VERSION = 1;
const STATE_STORE = "state";
const STATE_ID = "current";
type LocalImport = { id: string; dataset_type: string; trade_date: string; week_start: string; file_name: string; record_count: number; created_at: string };
type LocalRecord = Record<string, unknown> & { id: number; import_id: string; dataset_type: string; trade_date: string; week_start: string; bond_code: string; raw_json: string };
type LocalState = { imports: LocalImport[]; records: LocalRecord[]; drafts: Record<string, { summary_text: string; review_text: string; updated_at: string }> };

function emptyState(): LocalState { return { imports: [], records: [], drafts: {} }; }

function validState(value: LocalState | null): value is LocalState {
  return Boolean(value?.imports && value?.records && value?.drafts);
}

function weekStartForRecord(tradeDate: string, datasetType: string) {
  const match = tradeDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  if (datasetType === "maturity") {
    if (date.getDay() === 6) date.setDate(date.getDate() - 5);
    if (date.getDay() === 0) date.setDate(date.getDate() - 6);
  }
  const weekday = date.getDay() || 7;
  date.setDate(date.getDate() - weekday + 1);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeRecordWeeks(state: LocalState) {
  let changed = false;
  const records = state.records.map((row) => {
    const expected = weekStartForRecord(row.trade_date, row.dataset_type);
    if (!expected || expected === row.week_start) return row;
    changed = true;
    return { ...row, week_start: expected };
  });
  return { state: changed ? { ...state, records } : state, changed };
}

let databasePromise: Promise<IDBDatabase> | null = null;
function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STATE_STORE)) request.result.createObjectStore(STATE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("本机数据库打开失败"));
  });
  return databasePromise;
}

async function readIndexedState() {
  const database = await openDatabase();
  return new Promise<LocalState | null>((resolve, reject) => {
    const request = database.transaction(STATE_STORE, "readonly").objectStore(STATE_STORE).get(STATE_ID);
    request.onsuccess = () => resolve(validState(request.result as LocalState | null) ? request.result as LocalState : null);
    request.onerror = () => reject(request.error || new Error("本机数据库读取失败"));
  });
}

async function writeState(state: LocalState) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STATE_STORE, "readwrite");
    transaction.objectStore(STATE_STORE).put(state, STATE_ID);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("本机数据库写入失败"));
    transaction.onabort = () => reject(transaction.error || new Error("本机数据库写入失败"));
  });
}

async function readState(): Promise<LocalState> {
  if (typeof window === "undefined") return emptyState();
  const indexed = await readIndexedState();
  if (indexed) {
    const normalized = normalizeRecordWeeks(indexed);
    if (normalized.changed) await writeState(normalized.state);
    return normalized.state;
  }
  const legacy = localStorage.getItem(STORAGE_KEY);
  if (!legacy) return emptyState();
  let parsed: LocalState | null = null;
  try {
    parsed = JSON.parse(legacy) as LocalState | null;
  } catch { return emptyState(); }
  if (!validState(parsed)) return emptyState();
  const normalized = normalizeRecordWeeks(parsed);
  await writeState(normalized.state);
  localStorage.removeItem(STORAGE_KEY);
  return normalized.state;
}
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
  const state = await readState();
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
    await writeState(state);
    return json({ ok: true });
  }
  if (method === "POST") {
    const payload = JSON.parse(String(init.body || "{}")) as {
      action?: string; datasetType?: string; tradeDate?: string; weekStart?: string; fileName?: string;
      records?: RecordPayload[]; summaryText?: string; reviewText?: string;
      batches?: Array<{ tradeDate: string; weekStart: string; records: RecordPayload[] }>;
    };
    if (payload.action === "saveDraft") {
      if (!payload.weekStart) return json({ error: "周起始日无效" }, 400);
      state.drafts[payload.weekStart] = { summary_text: payload.summaryText || "", review_text: payload.reviewText || "", updated_at: new Date().toISOString() };
      await writeState(state);
      return json({ ok: true });
    }
    const batches = payload.batches?.length
      ? payload.batches.filter((batch) => batch.tradeDate && batch.weekStart && batch.records?.length)
      : payload.tradeDate && payload.weekStart && payload.records?.length
        ? [{ tradeDate: payload.tradeDate, weekStart: payload.weekStart, records: payload.records }]
        : [];
    if (!payload.datasetType || !payload.fileName || !batches.length) return json({ error: "上传数据不完整" }, 400);
    const existingByKey = new Map(state.records.filter(row => row.dataset_type === payload.datasetType).map(row => [recordKey({ tradeDate: row.trade_date, bondCode: row.bond_code }), row]));
    let inserted = 0, updated = 0, unchanged = 0;
    let nextId = state.records.reduce((maximum, row) => Math.max(maximum, row.id), 0) + 1;
    batches.forEach((batch) => {
      const importId = crypto.randomUUID();
      let batchChanges = 0;
      batch.records.forEach((incoming) => {
        const normalized = { ...incoming, tradeDate: incoming.tradeDate || batch.tradeDate };
        const key = recordKey(normalized);
        const existing = existingByKey.get(key);
        const merged = mergeRecord(normalized, existing);
        const expectedWeekStart = weekStartForRecord(normalized.tradeDate || batch.tradeDate, payload.datasetType!) || batch.weekStart;
        const metadataChanged = Boolean(existing && (existing.week_start !== expectedWeekStart || existing.trade_date !== normalized.tradeDate));
        if (!merged.changed && !metadataChanged) { unchanged += 1; return; }
        const row = storedRecord(merged.record, { id: existing?.id || nextId++, importId, datasetType: payload.datasetType!, weekStart: expectedWeekStart, tradeDate: normalized.tradeDate || batch.tradeDate });
        if (existing) {
          const position = state.records.findIndex((item) => item.id === existing.id);
          if (position >= 0) state.records[position] = row;
          updated += 1;
        } else {
          state.records.push(row);
          inserted += 1;
        }
        existingByKey.set(key, row);
        batchChanges += 1;
      });
      if (batchChanges) state.imports.push({ id: importId, dataset_type: payload.datasetType!, trade_date: batch.tradeDate, week_start: batch.weekStart, file_name: payload.fileName!, record_count: batchChanges, created_at: new Date().toISOString() });
    });
    await writeState(state);
    return json({ ok: true, inserted, updated, unchanged }, 201);
  }
  return json({ error: "不支持的请求" }, 405);
}

export async function downloadLocalBackup() {
  const blob = new Blob([JSON.stringify(await readState())], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `利率债工作台数据备份_${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function restoreLocalBackup(file: File) {
  const parsed = JSON.parse(await file.text()) as LocalState;
  if (!validState(parsed)) throw new Error("备份文件格式不正确");
  await writeState(parsed);
  localStorage.removeItem(STORAGE_KEY);
}
