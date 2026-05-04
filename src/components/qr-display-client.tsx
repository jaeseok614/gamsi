"use client";

import { MonitorUp, QrCode, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { QrCodeSvg } from "@/components/qr-code-svg";

type WorkLocationOption = {
  id: string;
  name: string;
  description?: string | null;
  isActive: boolean;
};

type IssuedQrToken = {
  id: string;
  payload: string;
  token: string;
  purpose: string;
  expiresAt: string | Date;
  ttlSeconds: number;
  location: {
    id: string;
    name: string;
  };
};

async function postJson(path: string, body: Record<string, unknown>) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? "QR 발급에 실패했습니다.");
  }

  return response.json();
}

export function QrDisplayClient({ locations }: { locations: WorkLocationOption[] }) {
  const activeLocations = useMemo(() => locations.filter((location) => location.isActive), [locations]);
  const [selectedLocationId, setSelectedLocationId] = useState(activeLocations[0]?.id ?? "");
  const [issuedToken, setIssuedToken] = useState<IssuedQrToken | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [message, setMessage] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const selectedLocation = activeLocations.find((location) => location.id === selectedLocationId) ?? activeLocations[0] ?? null;
  const expiresAt = issuedToken ? new Date(issuedToken.expiresAt).getTime() : 0;
  const secondsLeft = issuedToken ? Math.max(0, Math.ceil((expiresAt - now) / 1000)) : 0;

  const issueToken = useCallback(async (locationId: string) => {
    if (!locationId) {
      return;
    }

    setIsRefreshing(true);
    try {
      const issued = (await postJson(`/api/admin/work-locations/${locationId}/qr`, {
        purpose: "BOTH",
        ttlSeconds: 60
      })) as IssuedQrToken;
      setIssuedToken(issued);
      setMessage("");
      setNow(Date.now());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "QR 발급에 실패했습니다.");
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const tick = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!selectedLocationId) {
      return;
    }

    const initialRefresh = window.setTimeout(() => {
      void issueToken(selectedLocationId);
    }, 0);
    const refresh = window.setInterval(() => {
      void issueToken(selectedLocationId);
    }, 60_000);

    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(refresh);
    };
  }, [issueToken, selectedLocationId]);

  if (activeLocations.length === 0) {
    return (
      <div className="qr-display-stage">
        <div className="empty">활성 근무지가 없습니다. 설정에서 근무지를 먼저 추가하세요.</div>
      </div>
    );
  }

  return (
    <section className="qr-display-stage" aria-label="출퇴근 QR 현장 표시">
      <div className="qr-display-visual">
        {issuedToken ? (
          <QrCodeSvg value={issuedToken.payload} className="qr-token qr-token-large" />
        ) : (
          <div className="empty">QR을 발급하는 중입니다.</div>
        )}
      </div>

      <div className="qr-display-controls">
        <div className="actions-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <strong>
            <MonitorUp size={20} />
            현장 출퇴근 QR
          </strong>
          <span className={`status-pill ${secondsLeft <= 10 ? "yellow" : "green"}`}>
            {secondsLeft > 0 ? `${secondsLeft}초` : "갱신 중"}
          </span>
        </div>

        <div className="field">
          <label htmlFor="qr-display-location">근무지</label>
          <select
            id="qr-display-location"
            value={selectedLocation?.id ?? ""}
            onChange={(event) => setSelectedLocationId(event.target.value)}
          >
            {activeLocations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </div>

        <div className="qr-display-meta-grid">
          <div className="metric">
            <span>근무지</span>
            <strong>{issuedToken?.location.name ?? selectedLocation?.name ?? "-"}</strong>
          </div>
          <div className="metric">
            <span>자동 갱신</span>
            <strong>60초</strong>
          </div>
          <div className="metric">
            <span>만료 시각</span>
            <strong>{issuedToken ? new Date(issuedToken.expiresAt).toLocaleTimeString("ko-KR") : "-"}</strong>
          </div>
          <div className="metric">
            <span>용도</span>
            <strong>출근/퇴근</strong>
          </div>
        </div>

        <div className="qr-display-token">
          <QrCode size={18} />
          <code>{issuedToken?.payload ?? "WG1:..."}</code>
        </div>

        <button
          className="button secondary"
          type="button"
          disabled={!selectedLocationId || isRefreshing}
          onClick={() => void issueToken(selectedLocationId)}
        >
          <RefreshCw size={16} />
          {isRefreshing ? "갱신 중" : "지금 갱신"}
        </button>
        {message ? <p className="muted" aria-live="polite">{message}</p> : null}
      </div>
    </section>
  );
}
