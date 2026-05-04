const CACHE_NAME = "workguard-pwa-v2";
const OFFLINE_URL = "/offline.html";
const PRECACHE_URLS = ["/", "/login", OFFLINE_URL, "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/logo.jpg"];
const FIELD_QUEUE_DB = "workguard-field-queue";
const FIELD_QUEUE_STORE = "queue";
const FIELD_QUEUE_META_STORE = "meta";
const FIELD_QUEUE_META_LAST_SYNC_AT = "lastSyncAt";
const FIELD_QUEUE_SYNC_TAG = "workguard-field-queue-sync";

function openQueueDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(FIELD_QUEUE_DB, 1);
    request.onerror = () => reject(request.error || new Error("offline queue db open failed"));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FIELD_QUEUE_STORE)) {
        const queueStore = db.createObjectStore(FIELD_QUEUE_STORE, { keyPath: "id" });
        queueStore.createIndex("dedupeKey", "dedupeKey", { unique: false });
      }
      if (!db.objectStoreNames.contains(FIELD_QUEUE_META_STORE)) {
        db.createObjectStore(FIELD_QUEUE_META_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function readQueuedFieldItems() {
  const db = await openQueueDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(FIELD_QUEUE_STORE, "readonly");
    const request = transaction.objectStore(FIELD_QUEUE_STORE).getAll();
    request.onerror = () => reject(request.error || new Error("queue read failed"));
    request.onsuccess = () => {
      resolve(
        (request.result || []).sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
      );
    };
  });
}

async function replaceQueuedFieldItems(items) {
  const db = await openQueueDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(FIELD_QUEUE_STORE, "readwrite");
    const store = transaction.objectStore(FIELD_QUEUE_STORE);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("queue replace failed"));
    store.clear();
    for (const item of items) {
      store.put(item);
    }
  });
}

async function writeQueueMeta(key, value) {
  const db = await openQueueDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(FIELD_QUEUE_META_STORE, "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("queue meta write failed"));
    transaction.objectStore(FIELD_QUEUE_META_STORE).put({ key, value });
  });
}

function isQueueConflictMessage(message) {
  return /이미\s*(출근|퇴근)|진행 중인 근무가 없습니다|현재 열린 근무 세션이 없습니다|상태를 변경할 수 없습니다|이미 종료/.test(message);
}

async function postQueuedFieldItem(item) {
  const response = await fetch(item.path, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    credentials: "include",
    body: JSON.stringify(item.body || {})
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message = payload?.error || `queue sync failed (${response.status})`;
    const error = new Error(message);
    error.conflict = response.status === 409 || isQueueConflictMessage(message);
    throw error;
  }
}

async function broadcastQueueSyncResult(payload) {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  await Promise.all(
    clients.map((client) =>
      client.postMessage({
        type: "FIELD_QUEUE_SYNC_RESULT",
        payload
      })
    )
  );
}

async function flushQueuedFieldItems() {
  const queue = await readQueuedFieldItems();
  if (queue.length === 0) {
    const result = { flushed: 0, remaining: 0, blocked: 0 };
    await broadcastQueueSyncResult(result);
    return result;
  }

  const nextQueue = [];
  let flushed = 0;
  let blocked = 0;

  for (const item of queue) {
    if (item.status === "blocked") {
      nextQueue.push(item);
      blocked += 1;
      continue;
    }

    try {
      await postQueuedFieldItem(item);
      flushed += 1;
    } catch (error) {
      const conflict = Boolean(error && typeof error === "object" && error.conflict);
      nextQueue.push({
        ...item,
        status: conflict ? "blocked" : "queued",
        attempts: (item.attempts || 0) + 1,
        lastAttemptAt: new Date().toISOString(),
        lastError: error instanceof Error ? error.message : "동기화 실패"
      });
      if (conflict) {
        blocked += 1;
      }
    }
  }

  await replaceQueuedFieldItems(nextQueue);
  if (flushed > 0) {
    await writeQueueMeta(FIELD_QUEUE_META_LAST_SYNC_AT, new Date().toISOString());
  }
  const result = {
    flushed,
    remaining: nextQueue.length,
    blocked
  };
  await broadcastQueueSyncResult(result);
  return result;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
          return Promise.resolve();
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const accept = request.headers.get("accept") ?? "";
  const isRscRequest =
    url.searchParams.has("_rsc") ||
    request.headers.has("rsc") ||
    request.headers.has("next-router-state-tree") ||
    accept.includes("text/x-component");

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => (await caches.match(OFFLINE_URL)) || Response.error())
    );
    return;
  }

  if (!isSameOrigin || url.pathname.startsWith("/api/") || isRscRequest) {
    return;
  }

  if (url.pathname === "/dashboard" || url.pathname === "/login") {
    event.respondWith(fetch(request));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SHOW_NOTIFICATION") {
    const payload = event.data.payload ?? {};
    event.waitUntil(
      self.registration.showNotification(payload.title ?? "워크가드", {
        body: payload.body ?? "",
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        data: {
          actionUrl: payload.actionUrl ?? "/dashboard#notifications"
        }
      })
    );
    return;
  }

  if (event.data?.type === "FIELD_QUEUE_FLUSH") {
    event.waitUntil(flushQueuedFieldItems());
  }
});

self.addEventListener("sync", (event) => {
  if (event.tag !== FIELD_QUEUE_SYNC_TAG) {
    return;
  }

  event.waitUntil(flushQueuedFieldItems());
});

self.addEventListener("push", (event) => {
  const payload = event.data
    ? (() => {
        try {
          return event.data.json();
        } catch {
          return {
            title: "워크가드",
            body: event.data?.text?.() ?? ""
          };
        }
      })()
    : { title: "워크가드", body: "" };

  event.waitUntil(
    self.registration.showNotification(payload.title ?? "워크가드", {
      body: payload.body ?? "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: {
        actionUrl: payload.actionUrl ?? "/dashboard?view=notifications"
      }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  const actionUrl = event.notification?.data?.actionUrl ?? "/dashboard#notifications";
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(actionUrl);
          return client.focus();
        }
      }

      return self.clients.openWindow(actionUrl);
    })
  );
});
