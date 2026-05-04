export const FIELD_QUEUE_SYNC_EVENT = "workguard:field-mode-sync";
export const FIELD_QUEUE_SYNC_TAG = "workguard-field-queue-sync";

const DB_NAME = "workguard-field-queue";
const DB_VERSION = 1;
const QUEUE_STORE = "queue";
const META_STORE = "meta";
const META_LAST_SYNC_AT = "lastSyncAt";
const SYNC_PING_KEY = "workguard:field-queue-ping";

let queueDbPromise: Promise<IDBDatabase> | null = null;
let fieldQueueFlushPromise: Promise<FieldQueueFlushResult> | null = null;

export type FieldQueueItem = {
  id: string;
  path: "/api/attendance/check-in" | "/api/attendance/check-out" | "/api/attendance/status";
  body: Record<string, unknown>;
  label: string;
  createdAt: string;
  attempts: number;
  dedupeKey: string;
  status: "queued" | "blocked";
  lastAttemptAt?: string;
  lastError?: string;
};

export type FieldQueueEnqueueResult = {
  size: number;
  deduped: boolean;
  item: FieldQueueItem;
};

export type FieldQueueFlushResult = {
  flushed: number;
  remaining: number;
  blocked: number;
};

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
  }

  return JSON.stringify(value);
}

function queueDedupeKey(path: FieldQueueItem["path"], body: Record<string, unknown>) {
  return `${path}:${stableStringify(body)}`;
}

function isConflictMessage(message: string) {
  return /이미\s*(출근|퇴근)|진행 중인 근무가 없습니다|현재 열린 근무 세션이 없습니다|상태를 변경할 수 없습니다|이미 종료/.test(message);
}

function dispatchQueueSync() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(SYNC_PING_KEY, String(Date.now()));
  } catch {
    // Ignore localStorage failures; window event still wakes local listeners.
  }
  window.dispatchEvent(new Event(FIELD_QUEUE_SYNC_EVENT));
}

function openQueueDb() {
  if (typeof indexedDB === "undefined") {
    throw new Error("이 브라우저는 IndexedDB를 지원하지 않습니다.");
  }

  if (!queueDbPromise) {
    queueDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error ?? new Error("오프라인 저장소를 열 수 없습니다."));
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(QUEUE_STORE)) {
          const queueStore = db.createObjectStore(QUEUE_STORE, {
            keyPath: "id"
          });
          queueStore.createIndex("dedupeKey", "dedupeKey", {
            unique: false
          });
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, {
            keyPath: "key"
          });
        }
      };
      request.onsuccess = () => resolve(request.result);
    });
  }

  return queueDbPromise;
}

async function readAllQueueItems() {
  const db = await openQueueDb();
  return new Promise<FieldQueueItem[]>((resolve, reject) => {
    const transaction = db.transaction(QUEUE_STORE, "readonly");
    const request = transaction.objectStore(QUEUE_STORE).getAll();
    request.onerror = () => reject(request.error ?? new Error("대기 중인 기록을 읽을 수 없습니다."));
    request.onsuccess = () => {
      const rows = (request.result as FieldQueueItem[]).sort(
        (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
      );
      resolve(rows);
    };
  });
}

async function readMetaValue(key: string) {
  const db = await openQueueDb();
  return new Promise<string | null>((resolve, reject) => {
    const transaction = db.transaction(META_STORE, "readonly");
    const request = transaction.objectStore(META_STORE).get(key);
    request.onerror = () => reject(request.error ?? new Error("동기화 메타데이터를 읽을 수 없습니다."));
    request.onsuccess = () => {
      const row = request.result as { key: string; value?: string } | undefined;
      resolve(typeof row?.value === "string" ? row.value : null);
    };
  });
}

async function writeMetaValue(key: string, value: string) {
  const db = await openQueueDb();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(META_STORE, "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("동기화 메타데이터를 저장할 수 없습니다."));
    transaction.objectStore(META_STORE).put({
      key,
      value
    });
  });
}

async function replaceQueue(items: FieldQueueItem[]) {
  const db = await openQueueDb();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(QUEUE_STORE, "readwrite");
    const store = transaction.objectStore(QUEUE_STORE);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("오프라인 대기열을 저장할 수 없습니다."));
    store.clear();
    for (const item of items) {
      store.put(item);
    }
  });
}

async function removeQueueItemFromDb(itemId: string) {
  const db = await openQueueDb();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(QUEUE_STORE, "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("오프라인 대기열에서 항목을 삭제할 수 없습니다."));
    transaction.objectStore(QUEUE_STORE).delete(itemId);
  });
}

async function postQueueItem(item: FieldQueueItem) {
  const response = await fetch(item.path, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    credentials: "include",
    body: JSON.stringify(item.body ?? {})
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    const message = payload?.error ?? `요청 처리에 실패했습니다. (${response.status})`;
    const conflict = response.status === 409 || isConflictMessage(message);
    const error = new Error(message) as Error & {
      conflict?: boolean;
    };
    error.conflict = conflict;
    throw error;
  }
}

export async function listFieldQueue() {
  return readAllQueueItems();
}

export async function getFieldQueueMeta() {
  return {
    lastSyncAt: await readMetaValue(META_LAST_SYNC_AT)
  };
}

export async function enqueueFieldQueueItem(input: Omit<FieldQueueItem, "id" | "createdAt" | "attempts" | "dedupeKey" | "status" | "lastAttemptAt" | "lastError">): Promise<FieldQueueEnqueueResult> {
  const queue = await readAllQueueItems();
  const dedupeKey = queueDedupeKey(input.path, input.body);
  const duplicate = queue.find((item) => item.dedupeKey === dedupeKey && item.status === "queued");
  if (duplicate) {
    return {
      size: queue.length,
      deduped: true,
      item: duplicate
    };
  }

  const item: FieldQueueItem = {
    ...input,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    attempts: 0,
    dedupeKey,
    status: "queued"
  };

  await replaceQueue([...queue, item]);
  dispatchQueueSync();
  await registerFieldQueueBackgroundSync();

  return {
    size: queue.length + 1,
    deduped: false,
    item
  };
}

export async function removeFieldQueueItem(itemId: string) {
  await removeQueueItemFromDb(itemId);
  const queue = await readAllQueueItems();
  dispatchQueueSync();
  return queue.length;
}

export async function clearFieldQueue() {
  await replaceQueue([]);
  dispatchQueueSync();
}

export async function flushFieldQueue() {
  if (fieldQueueFlushPromise) {
    return fieldQueueFlushPromise;
  }

  fieldQueueFlushPromise = (async () => {
    const queue = await readAllQueueItems();
    if (queue.length === 0) {
      return {
        flushed: 0,
        remaining: 0,
        blocked: 0
      } satisfies FieldQueueFlushResult;
    }

    const nextQueue: FieldQueueItem[] = [];
    let flushed = 0;
    let blocked = 0;

    for (const item of queue) {
      if (item.status === "blocked") {
        nextQueue.push(item);
        blocked += 1;
        continue;
      }

      try {
        await postQueueItem(item);
        flushed += 1;
      } catch (error) {
        const conflict = Boolean(error && typeof error === "object" && "conflict" in error && (error as { conflict?: boolean }).conflict);
        const nextItem: FieldQueueItem = {
          ...item,
          attempts: item.attempts + 1,
          status: conflict ? "blocked" : "queued",
          lastAttemptAt: new Date().toISOString(),
          lastError: error instanceof Error ? error.message : "동기화 실패"
        };
        if (conflict) {
          blocked += 1;
        }
        nextQueue.push(nextItem);
      }
    }

    await replaceQueue(nextQueue);
    if (flushed > 0) {
      await writeMetaValue(META_LAST_SYNC_AT, new Date().toISOString());
    }
    dispatchQueueSync();

    return {
      flushed,
      remaining: nextQueue.length,
      blocked
    } satisfies FieldQueueFlushResult;
  })();

  try {
    return await fieldQueueFlushPromise;
  } finally {
    fieldQueueFlushPromise = null;
  }
}

export async function registerFieldQueueBackgroundSync() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  const registration = await navigator.serviceWorker.ready.catch(() => null);
  const syncRegistration = registration as (ServiceWorkerRegistration & {
    sync?: {
      register: (tag: string) => Promise<void>;
    };
  }) | null;

  if (!syncRegistration?.sync) {
    return;
  }

  try {
    await syncRegistration.sync.register(FIELD_QUEUE_SYNC_TAG);
  } catch {
    // Background sync is best-effort; foreground flush remains available.
  }
}
