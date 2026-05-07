"use client";

import { Building2, CalendarDays, CheckCircle2, Copy, MapPin, MonitorUp, QrCode, RefreshCw, Save, Send, ShieldCheck, Trash2, UserCog, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { integrationDispatchStatusLabel, integrationDispatchStatusTone, planTierLabel, roleLabel } from "@/lib/display-labels";

type TeamOption = {
  id: string;
  name: string;
};

type ManagerOption = {
  id: string;
  name: string;
  role: string;
};

type EditableTeam = {
  id: string;
  name: string;
  managerUserId: string | null;
  isActive: boolean;
};

type EditableUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  teamId: string | null;
  jobTitle: string | null;
  phoneNumber: string | null;
  extensionNumber: string | null;
  isActive: boolean;
};

type PermissionMatrixSummary = {
  roleRows: Array<{
    role: string;
    label: string;
    capabilities: Array<{
      key: string;
      label: string;
      level: "full" | "limited" | "own" | "none";
      detail: string;
    }>;
  }>;
  selectedUser: {
    id: string;
    name: string;
    email: string;
    role: string;
    teamName: string | null;
  } | null;
  resourceChecks: Array<{
    id: string;
    type: string;
    typeLabel: string;
    title: string;
    scope: string;
    canAccess: boolean;
    reason: string;
    href: string;
    updatedAt: string | Date;
  }>;
  totals: {
    total: number;
    accessible: number;
    blocked: number;
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
    throw new Error(payload?.error ?? "요청 처리에 실패했습니다.");
  }

  return response.json();
}

async function deleteJson(path: string) {
  const response = await fetch(path, {
    method: "DELETE"
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? "요청 처리에 실패했습니다.");
  }

  return response.json();
}

function useAdminAction() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function run(action: () => Promise<string>, fallback = "저장했습니다.") {
    setMessage("");
    startTransition(async () => {
      try {
        const actionMessage = await action();
        setMessage(actionMessage || fallback);
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "요청 처리에 실패했습니다.");
      }
    });
  }

  return { isPending, message, run };
}

function permissionLevelLabel(level: PermissionMatrixSummary["roleRows"][number]["capabilities"][number]["level"]) {
  if (level === "full") {
    return "전체";
  }
  if (level === "limited") {
    return "제한";
  }
  if (level === "own") {
    return "본인";
  }
  return "차단";
}

function permissionLevelTone(level: PermissionMatrixSummary["roleRows"][number]["capabilities"][number]["level"]) {
  if (level === "full") {
    return "green";
  }
  if (level === "none") {
    return "red";
  }
  return "yellow";
}

const QR_ALPHANUMERIC = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

function qrGfTables() {
  const exp = new Array<number>(512).fill(0);
  const log = new Array<number>(256).fill(0);
  let value = 1;
  for (let index = 0; index < 255; index += 1) {
    exp[index] = value;
    log[value] = index;
    value <<= 1;
    if (value & 0x100) {
      value ^= 0x11d;
    }
  }
  for (let index = 255; index < 512; index += 1) {
    exp[index] = exp[index - 255];
  }
  return { exp, log };
}

const QR_GF = qrGfTables();

function qrGfMultiply(left: number, right: number) {
  return left === 0 || right === 0 ? 0 : QR_GF.exp[QR_GF.log[left] + QR_GF.log[right]];
}

function qrReedSolomonGenerator(degree: number) {
  const result = [1];
  for (let index = 0; index < degree; index += 1) {
    result.push(0);
    for (let cursor = 0; cursor < result.length - 1; cursor += 1) {
      result[cursor] = qrGfMultiply(result[cursor], QR_GF.exp[index]) ^ result[cursor + 1];
    }
  }
  return result.slice(0, degree);
}

function qrReedSolomonRemainder(data: number[], degree: number) {
  const generator = qrReedSolomonGenerator(degree);
  const result = new Array<number>(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift()!;
    result.push(0);
    for (let index = 0; index < degree; index += 1) {
      result[index] ^= qrGfMultiply(generator[index], factor);
    }
  }
  return result;
}

function qrAppendBits(bits: number[], value: number, length: number) {
  for (let index = length - 1; index >= 0; index -= 1) {
    bits.push((value >>> index) & 1);
  }
}

function qrFormatBits(mask: number) {
  const data = (1 << 3) | mask;
  let rem = data;
  for (let index = 0; index < 10; index += 1) {
    rem = (rem << 1) ^ (((rem >>> 9) & 1) ? 0x537 : 0);
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function buildQrMatrix(rawValue: string) {
  const value = rawValue.toUpperCase();
  const version = 2;
  const size = 25;
  const dataCodewords = 34;
  const eccCodewords = 10;
  const matrix = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const reserved = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));

  function setModule(x: number, y: number, dark: boolean, isFunction = true) {
    if (x < 0 || y < 0 || x >= size || y >= size) {
      return;
    }
    matrix[y][x] = dark;
    if (isFunction) {
      reserved[y][x] = true;
    }
  }

  function drawFinder(x: number, y: number) {
    for (let dy = -1; dy <= 7; dy += 1) {
      for (let dx = -1; dx <= 7; dx += 1) {
        const distance = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
        setModule(x + dx, y + dy, distance === 3 || distance <= 1);
      }
    }
  }

  function drawAlignment(cx: number, cy: number) {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        setModule(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) === 2 || (dx === 0 && dy === 0));
      }
    }
  }

  function drawFormat(mask: number) {
    const bits = qrFormatBits(mask);
    const getBit = (index: number) => ((bits >>> index) & 1) !== 0;
    for (let index = 0; index <= 5; index += 1) setModule(8, index, getBit(index));
    setModule(8, 7, getBit(6));
    setModule(8, 8, getBit(7));
    setModule(7, 8, getBit(8));
    for (let index = 9; index < 15; index += 1) setModule(14 - index, 8, getBit(index));
    for (let index = 0; index < 8; index += 1) setModule(size - 1 - index, 8, getBit(index));
    for (let index = 8; index < 15; index += 1) setModule(8, size - 15 + index, getBit(index));
    setModule(8, size - 8, true);
  }

  drawFinder(0, 0);
  drawFinder(size - 7, 0);
  drawFinder(0, size - 7);
  drawAlignment(18, 18);
  for (let index = 8; index < size - 8; index += 1) {
    setModule(index, 6, index % 2 === 0);
    setModule(6, index, index % 2 === 0);
  }
  drawFormat(0);

  const bits: number[] = [];
  qrAppendBits(bits, 0b0010, 4);
  qrAppendBits(bits, value.length, 9);
  for (let index = 0; index < value.length; index += 2) {
    const first = QR_ALPHANUMERIC.indexOf(value[index]);
    const second = index + 1 < value.length ? QR_ALPHANUMERIC.indexOf(value[index + 1]) : -1;
    if (first < 0 || (index + 1 < value.length && second < 0)) {
      return null;
    }
    if (second >= 0) {
      qrAppendBits(bits, first * 45 + second, 11);
    } else {
      qrAppendBits(bits, first, 6);
    }
  }
  const capacityBits = dataCodewords * 8;
  qrAppendBits(bits, 0, Math.min(4, capacityBits - bits.length));
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }
  const data: number[] = [];
  for (let index = 0; index < bits.length; index += 8) {
    data.push(bits.slice(index, index + 8).reduce((sum, bit) => (sum << 1) | bit, 0));
  }
  for (let pad = 0; data.length < dataCodewords; pad += 1) {
    data.push(pad % 2 === 0 ? 0xec : 0x11);
  }
  const codewords = [...data, ...qrReedSolomonRemainder(data, eccCodewords)];
  const codewordBits = codewords.flatMap((byte) => Array.from({ length: 8 }, (_, index) => (byte >>> (7 - index)) & 1));
  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) {
      right -= 1;
    }
    for (let vertical = 0; vertical < size; vertical += 1) {
      const y = upward ? size - 1 - vertical : vertical;
      for (let column = 0; column < 2; column += 1) {
        const x = right - column;
        if (reserved[y][x]) {
          continue;
        }
        const mask = (x + y) % 2 === 0;
        matrix[y][x] = Boolean((codewordBits[bitIndex] ?? 0) ^ (mask ? 1 : 0));
        bitIndex += 1;
      }
    }
    upward = !upward;
  }
  drawFormat(0);

  return matrix;
}

function QrCodeSvg({ value }: { value: string }) {
  const matrix = buildQrMatrix(value);
  if (!matrix) {
    return <div className="empty">QR로 표시할 수 없는 토큰입니다.</div>;
  }

  const quiet = 4;
  const size = matrix.length + quiet * 2;
  const cells = matrix.flatMap((row, y) =>
    row.map((dark, x) => (dark ? <rect key={`${x}-${y}`} x={x + quiet} y={y + quiet} width="1" height="1" /> : null))
  );

  return (
    <svg className="qr-token" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="출퇴근 인증 QR">
      <rect width={size} height={size} fill="#fff" />
      <g fill="#111827">{cells}</g>
    </svg>
  );
}

export function CompanySettingsForm({
  name,
  weeklyLimitHours,
  defaultBreakMinutes
}: {
  name: string;
  weeklyLimitHours: number;
  defaultBreakMinutes: number;
}) {
  const { isPending, message, run } = useAdminAction();
  const [companyName, setCompanyName] = useState(name);
  const [weeklyHours, setWeeklyHours] = useState(String(weeklyLimitHours));
  const [breakMinutes, setBreakMinutes] = useState(String(defaultBreakMinutes));

  return (
    <div className="inline-form">
      <div className="field">
        <label htmlFor="company-name">회사명</label>
        <input id="company-name" value={companyName} onChange={(event) => setCompanyName(event.target.value)} />
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="weekly-limit">주간 한도</label>
          <input
            id="weekly-limit"
            inputMode="decimal"
            value={weeklyHours}
            onChange={(event) => setWeeklyHours(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="break-minutes">기본 휴게시간</label>
          <input
            id="break-minutes"
            inputMode="numeric"
            value={breakMinutes}
            onChange={(event) => setBreakMinutes(event.target.value)}
          />
        </div>
      </div>
      <button
        className="button"
        type="button"
        disabled={isPending}
        onClick={() =>
          run(async () => {
            await postJson("/api/admin/company", {
              name: companyName,
              weeklyLimitHours: Number(weeklyHours),
              defaultBreakMinutes: Number(breakMinutes)
            });
            return "회사 설정을 저장했습니다.";
          })
        }
      >
        <Building2 size={16} />
        회사 설정 저장
      </button>
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}

export function CompanyPlanSettingsForm({
  summary
}: {
  summary: {
    tier: string;
    userLimit: number;
    activeUsers: number;
    pendingInvitations: number;
    remainingSeats: number;
    canInvite: boolean;
  };
}) {
  const { isPending, message, run } = useAdminAction();
  const [planTier, setPlanTier] = useState(summary.tier);
  const [userLimit, setUserLimit] = useState(String(summary.userLimit));

  return (
    <div className="inline-form">
      <div className="grid-3">
        <div className="metric">
          <span>활성 사용자</span>
          <strong>{summary.activeUsers}명</strong>
        </div>
        <div className="metric">
          <span>초대 대기</span>
          <strong>{summary.pendingInvitations}명</strong>
        </div>
        <div className="metric">
          <span>남은 좌석</span>
          <strong>{summary.remainingSeats}명</strong>
        </div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="company-plan-tier">플랜</label>
          <select id="company-plan-tier" value={planTier} onChange={(event) => setPlanTier(event.target.value)}>
            <option value="TRIAL">{planTierLabel("TRIAL")}</option>
            <option value="STARTER">{planTierLabel("STARTER")}</option>
            <option value="GROWTH">{planTierLabel("GROWTH")}</option>
            <option value="ENTERPRISE">{planTierLabel("ENTERPRISE")}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="company-user-limit">사용자 수 제한</label>
          <input id="company-user-limit" inputMode="numeric" value={userLimit} onChange={(event) => setUserLimit(event.target.value)} />
        </div>
      </div>
      <button
        className="button"
        type="button"
        disabled={isPending}
        onClick={() =>
          run(async () => {
            await postJson("/api/admin/company/plan", {
              planTier,
              userLimit: Number(userLimit)
            });
            return "회사 플랜을 저장했습니다.";
          })
        }
      >
        <ShieldCheck size={16} />
        플랜 저장
      </button>
      {!summary.canInvite ? (
        <div className="notice-card warning">
          <strong>사용자 한도 도달</strong>
          <span className="muted">새 초대나 비활성 계정 재활성화 전에 한도를 늘려야 합니다.</span>
        </div>
      ) : null}
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}

export function PolicySettingsForm({
  standardDailyHours,
  overtimeThresholdHours,
  weeklyLimitHours,
  defaultBreakMinutes,
  annualLeaveBasis,
  annualLeaveGrantDays,
  firstYearMonthlyAccrualEnabled,
  annualLeaveCarryoverDays,
  carryoverExpiryMonth,
  carryoverExpiryDay,
  allowHalfDayLeave,
  allowHourlyLeave,
  hourlyLeaveUnitMinutes,
  overtimePremiumRate,
  nightPremiumRate,
  holidayPremiumRate,
  holidayIncludesWeekends,
  nightWorkStart,
  nightWorkEnd
}: {
  standardDailyHours: number;
  overtimeThresholdHours: number;
  weeklyLimitHours: number;
  defaultBreakMinutes: number;
  annualLeaveBasis: "CALENDAR_YEAR" | "JOIN_DATE";
  annualLeaveGrantDays: number;
  firstYearMonthlyAccrualEnabled: boolean;
  annualLeaveCarryoverDays: number;
  carryoverExpiryMonth: number;
  carryoverExpiryDay: number;
  allowHalfDayLeave: boolean;
  allowHourlyLeave: boolean;
  hourlyLeaveUnitMinutes: number;
  overtimePremiumRate: number;
  nightPremiumRate: number;
  holidayPremiumRate: number;
  holidayIncludesWeekends: boolean;
  nightWorkStart: string;
  nightWorkEnd: string;
}) {
  const { isPending, message, run } = useAdminAction();
  const [standardHours, setStandardHours] = useState(String(standardDailyHours));
  const [overtimeHours, setOvertimeHours] = useState(String(overtimeThresholdHours));
  const [weeklyHours, setWeeklyHours] = useState(String(weeklyLimitHours));
  const [breakMinutes, setBreakMinutes] = useState(String(defaultBreakMinutes));
  const [leaveBasis, setLeaveBasis] = useState(annualLeaveBasis);
  const [grantDays, setGrantDays] = useState(String(annualLeaveGrantDays));
  const [firstYearMonthly, setFirstYearMonthly] = useState(firstYearMonthlyAccrualEnabled);
  const [carryoverDays, setCarryoverDays] = useState(String(annualLeaveCarryoverDays));
  const [carryoverMonth, setCarryoverMonth] = useState(String(carryoverExpiryMonth));
  const [carryoverDay, setCarryoverDay] = useState(String(carryoverExpiryDay));
  const [halfDayAllowed, setHalfDayAllowed] = useState(allowHalfDayLeave);
  const [hourlyAllowed, setHourlyAllowed] = useState(allowHourlyLeave);
  const [hourlyUnit, setHourlyUnit] = useState(String(hourlyLeaveUnitMinutes));
  const [overtimeRate, setOvertimeRate] = useState(String(overtimePremiumRate));
  const [nightRate, setNightRate] = useState(String(nightPremiumRate));
  const [holidayRate, setHolidayRate] = useState(String(holidayPremiumRate));
  const [includesWeekends, setIncludesWeekends] = useState(holidayIncludesWeekends);
  const [nightStart, setNightStart] = useState(nightWorkStart);
  const [nightEnd, setNightEnd] = useState(nightWorkEnd);

  return (
    <div className="inline-form">
      <div className="grid-2">
        <div className="field">
          <label htmlFor="policy-standard-hours">기본 근무시간(일)</label>
          <input
            id="policy-standard-hours"
            inputMode="decimal"
            value={standardHours}
            onChange={(event) => setStandardHours(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="policy-overtime-hours">연장근로 기준(일)</label>
          <input
            id="policy-overtime-hours"
            inputMode="decimal"
            value={overtimeHours}
            onChange={(event) => setOvertimeHours(event.target.value)}
          />
        </div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="policy-weekly-hours">주간 한도</label>
          <input
            id="policy-weekly-hours"
            inputMode="decimal"
            value={weeklyHours}
            onChange={(event) => setWeeklyHours(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="policy-break-minutes">기본 휴게시간</label>
          <input
            id="policy-break-minutes"
            inputMode="numeric"
            value={breakMinutes}
            onChange={(event) => setBreakMinutes(event.target.value)}
          />
        </div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="policy-leave-basis">연차 기준</label>
          <select id="policy-leave-basis" value={leaveBasis} onChange={(event) => setLeaveBasis(event.target.value as "CALENDAR_YEAR" | "JOIN_DATE")}>
            <option value="CALENDAR_YEAR">캘린더 연도 기준</option>
            <option value="JOIN_DATE">입사일 기준</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="policy-grant-days">연차 부여</label>
          <input
            id="policy-grant-days"
            inputMode="decimal"
            value={grantDays}
            onChange={(event) => setGrantDays(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="policy-carryover-days">연차 이월</label>
          <input
            id="policy-carryover-days"
            inputMode="decimal"
            value={carryoverDays}
            onChange={(event) => setCarryoverDays(event.target.value)}
          />
        </div>
      </div>
      <div className="grid-3">
        <div className="field">
          <label htmlFor="policy-carryover-month">이월 만료 월</label>
          <input
            id="policy-carryover-month"
            inputMode="numeric"
            value={carryoverMonth}
            onChange={(event) => setCarryoverMonth(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="policy-carryover-day">이월 만료 일</label>
          <input
            id="policy-carryover-day"
            inputMode="numeric"
            value={carryoverDay}
            onChange={(event) => setCarryoverDay(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="policy-hourly-unit">시간차 단위(분)</label>
          <input
            id="policy-hourly-unit"
            inputMode="numeric"
            value={hourlyUnit}
            onChange={(event) => setHourlyUnit(event.target.value)}
          />
        </div>
      </div>
      <div className="grid-3">
        <div className="field">
          <label htmlFor="policy-overtime-rate">연장 가산율</label>
          <input
            id="policy-overtime-rate"
            inputMode="decimal"
            value={overtimeRate}
            onChange={(event) => setOvertimeRate(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="policy-night-rate">야간 가산율</label>
          <input
            id="policy-night-rate"
            inputMode="decimal"
            value={nightRate}
            onChange={(event) => setNightRate(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="policy-holiday-rate">휴일 가산율</label>
          <input
            id="policy-holiday-rate"
            inputMode="decimal"
            value={holidayRate}
            onChange={(event) => setHolidayRate(event.target.value)}
          />
        </div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="policy-night-start">야간 시작</label>
          <input id="policy-night-start" type="time" value={nightStart} onChange={(event) => setNightStart(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="policy-night-end">야간 종료</label>
          <input id="policy-night-end" type="time" value={nightEnd} onChange={(event) => setNightEnd(event.target.value)} />
        </div>
      </div>
      <label className="check-row">
        <input
          type="checkbox"
          checked={includesWeekends}
          onChange={(event) => setIncludesWeekends(event.target.checked)}
        />
        주말 근무를 휴일근로로 간주
      </label>
      <label className="check-row">
        <input type="checkbox" checked={firstYearMonthly} onChange={(event) => setFirstYearMonthly(event.target.checked)} />
        첫해는 만근 월수 기준 월차를 자동 부여
      </label>
      <label className="check-row">
        <input type="checkbox" checked={halfDayAllowed} onChange={(event) => setHalfDayAllowed(event.target.checked)} />
        반차 사용 허용
      </label>
      <label className="check-row">
        <input type="checkbox" checked={hourlyAllowed} onChange={(event) => setHourlyAllowed(event.target.checked)} />
        시간차 사용 허용
      </label>
      <button
        className="button"
        type="button"
        disabled={isPending}
        onClick={() =>
          run(async () => {
            await postJson("/api/admin/policy", {
              standardDailyHours: Number(standardHours),
              overtimeThresholdHours: Number(overtimeHours),
              weeklyLimitHours: Number(weeklyHours),
              defaultBreakMinutes: Number(breakMinutes),
              annualLeaveBasis: leaveBasis,
              annualLeaveGrantDays: Number(grantDays),
              firstYearMonthlyAccrualEnabled: firstYearMonthly,
              annualLeaveCarryoverDays: Number(carryoverDays),
              carryoverExpiryMonth: Number(carryoverMonth),
              carryoverExpiryDay: Number(carryoverDay),
              allowHalfDayLeave: halfDayAllowed,
              allowHourlyLeave: hourlyAllowed,
              hourlyLeaveUnitMinutes: Number(hourlyUnit),
              overtimePremiumRate: Number(overtimeRate),
              nightPremiumRate: Number(nightRate),
              holidayPremiumRate: Number(holidayRate),
              holidayIncludesWeekends: includesWeekends,
              nightWorkStart: nightStart,
              nightWorkEnd: nightEnd
            });
            return "계산 정책을 저장했습니다.";
          })
        }
      >
        <Save size={16} />
        계산 정책 저장
      </button>
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}

export function HolidayCalendarForm({
  defaultDate
}: {
  defaultDate: string;
}) {
  const { isPending, message, run } = useAdminAction();
  const [date, setDate] = useState(defaultDate);
  const [name, setName] = useState("");
  const [isPaidHoliday, setIsPaidHoliday] = useState(true);

  return (
    <div className="inline-form">
      <div className="grid-2">
        <div className="field">
          <label htmlFor="holiday-date">공휴일 날짜</label>
          <input id="holiday-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="holiday-name">회사/임시 휴일 이름</label>
          <input
            id="holiday-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="예: 회사 창립기념일, 임시 휴무"
          />
        </div>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={isPaidHoliday} onChange={(event) => setIsPaidHoliday(event.target.checked)} />
        유급 공휴일로 반영
      </label>
      <button
        className="button secondary"
        type="button"
        disabled={isPending}
        onClick={() =>
          run(async () => {
            await fetch("/api/admin/holidays", {
              method: "POST",
              headers: {
                "content-type": "application/json"
              },
              body: JSON.stringify({
                date,
                name,
                isPaidHoliday
              })
            }).then(async (response) => {
              if (!response.ok) {
                const payload = (await response.json().catch(() => null)) as { error?: string } | null;
                throw new Error(payload?.error ?? "공휴일 저장에 실패했습니다.");
              }
            });
            setName("");
            return "공휴일을 저장했습니다.";
          })
        }
      >
        <CalendarDays size={16} />
        예외 휴일 수동 등록
      </button>
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}

export function HolidayDeleteButton({
  holidayId
}: {
  holidayId: string;
}) {
  const { isPending, message, run } = useAdminAction();

  return (
    <div className="stack" style={{ gap: 6 }}>
      <button
        className="button secondary"
        type="button"
        disabled={isPending}
        onClick={() =>
          run(async () => {
            const response = await fetch(`/api/admin/holidays?id=${holidayId}`, {
              method: "DELETE"
            });
            if (!response.ok) {
              const payload = (await response.json().catch(() => null)) as { error?: string } | null;
              throw new Error(payload?.error ?? "공휴일 삭제에 실패했습니다.");
            }
            return "공휴일을 삭제했습니다.";
          })
        }
      >
        <Trash2 size={15} />
        삭제
      </button>
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}

export function TeamCreateForm({
  managers
}: {
  managers: ManagerOption[];
}) {
  const { isPending, message, run } = useAdminAction();
  const [name, setName] = useState("");
  const [managerUserId, setManagerUserId] = useState("");

  return (
    <div className="inline-form">
      <div className="field">
        <label htmlFor="team-name">팀 이름</label>
        <input id="team-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="예: 세일즈팀" />
      </div>
      <div className="field">
        <label htmlFor="team-manager">팀 관리자</label>
        <select id="team-manager" value={managerUserId} onChange={(event) => setManagerUserId(event.target.value)}>
          <option value="">지정 안 함</option>
            {managers.map((manager) => (
              <option key={manager.id} value={manager.id}>
              {manager.name} · {roleLabel(manager.role)}
              </option>
            ))}
          </select>
      </div>
      <button
        className="button secondary"
        type="button"
        disabled={isPending}
        onClick={() =>
          run(async () => {
            await postJson("/api/admin/teams", {
              name,
              managerUserId: managerUserId || null
            });
            setName("");
            setManagerUserId("");
            return "팀을 생성했습니다.";
          })
        }
      >
        <Users size={16} />
        팀 생성
      </button>
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}

export function InvitationCreateForm({
  teams
}: {
  teams: TeamOption[];
}) {
  const { isPending, message, run } = useAdminAction();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("EMPLOYEE");
  const [teamId, setTeamId] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");

  return (
    <div className="inline-form">
      <div className="grid-2">
        <div className="field">
          <label htmlFor="invite-name">이름</label>
          <input id="invite-name" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="invite-email">이메일</label>
          <input id="invite-email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="invite-role">역할</label>
          <select id="invite-role" value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="EMPLOYEE">직원</option>
            <option value="MANAGER">팀장</option>
            <option value="HR">인사 담당</option>
            <option value="ADMIN">관리자</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="invite-team">팀</label>
          <select id="invite-team" value={teamId} onChange={(event) => setTeamId(event.target.value)}>
            <option value="">소속 없음</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <button
        className="button"
        type="button"
        disabled={isPending}
        onClick={() =>
          run(async () => {
            const invitation = (await postJson("/api/admin/invitations", {
              name,
              email,
              role,
              teamId: teamId || null
            })) as { inviteUrl: string };
            setInviteUrl(invitation.inviteUrl);
            setName("");
            setEmail("");
            return "초대 링크를 생성하고 메일 발송을 시도했습니다.";
          })
        }
      >
        <Send size={16} />
        직원 초대
      </button>
      {inviteUrl ? (
        <div className="empty">
          초대 링크
          <br />
          <strong>{inviteUrl}</strong>
        </div>
      ) : null}
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}

export function WorkLocationSettingsForm({
  summary
}: {
  summary: {
    locations: Array<{
      id: string;
      name: string;
      description?: string | null;
      isActive: boolean;
      updatedAt: string | Date;
    }>;
    metrics: {
      totalLocations: number;
      activeLocations: number;
      activeTokens: number;
      usedTokens: number;
    };
    recentTokens: Array<{
      id: string;
      purpose: string;
      expiresAt: string | Date;
      usedAt: string | Date | null;
      createdAt: string | Date;
      location: {
        name: string;
      };
      usedBy: {
        name: string;
        email: string;
      } | null;
    }>;
  };
}) {
  const { isPending, message, run } = useAdminAction();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [qrToken, setQrToken] = useState<{
    payload: string;
    token: string;
    expiresAt: string | Date;
    location: {
      name: string;
    };
  } | null>(null);

  function issueToken(locationId: string) {
    run(async () => {
      const issued = (await postJson(`/api/admin/work-locations/${locationId}/qr`, {
        purpose: "BOTH",
        ttlSeconds: 60
      })) as typeof qrToken;
      setQrToken(issued);
      return "출퇴근 QR을 발급했습니다.";
    });
  }

  return (
    <div className="inline-form">
      <div className="grid-4">
        <div className="metric">
          <span>근무지</span>
          <strong>{summary.metrics.totalLocations}곳</strong>
        </div>
        <div className="metric">
          <span>활성 근무지</span>
          <strong>{summary.metrics.activeLocations}곳</strong>
        </div>
        <div className="metric">
          <span>활성 QR</span>
          <strong>{summary.metrics.activeTokens}개</strong>
        </div>
        <div className="metric">
          <span>오늘 사용</span>
          <strong>{summary.metrics.usedTokens}건</strong>
        </div>
      </div>

      <div className="grid-2">
        <div className="field">
          <label htmlFor="work-location-name">근무지 이름</label>
          <input id="work-location-name" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="work-location-description">설명</label>
          <input id="work-location-description" value={description} onChange={(event) => setDescription(event.target.value)} />
        </div>
      </div>
      <div className="actions-row">
        <button
          className="button secondary"
          type="button"
          disabled={isPending}
          onClick={() =>
            run(async () => {
              await postJson("/api/admin/work-locations", {
                name,
                description
              });
              setName("");
              setDescription("");
              return "근무지를 추가했습니다.";
            })
          }
        >
          <MapPin size={16} />
          근무지 추가
        </button>
        <a className="button secondary" href="/admin/qr-display" target="_blank" rel="noreferrer">
          <MonitorUp size={16} />
          현장 화면 열기
        </a>
      </div>

      {qrToken ? (
        <div className="qr-display-card">
          <QrCodeSvg value={qrToken.payload} />
          <div>
            <strong>{qrToken.location.name} 출퇴근 QR</strong>
            <p className="muted" style={{ margin: "8px 0" }}>
              만료 {new Date(qrToken.expiresAt).toLocaleTimeString("ko-KR")}
            </p>
            <code>{qrToken.payload}</code>
          </div>
        </div>
      ) : null}

      <div className="stack" style={{ gap: 8 }}>
        {summary.locations.map((location) => (
          <div key={location.id} className="notification-card read">
            <div>
              <strong>{location.name}</strong>
              <p className="muted" style={{ margin: "6px 0 0" }}>
                {location.description || "설명 없음"} · {new Date(location.updatedAt).toLocaleString("ko-KR")}
              </p>
            </div>
            <div className="actions-row">
              <span className={`status-pill ${location.isActive ? "green" : "gray"}`}>{location.isActive ? "활성" : "비활성"}</span>
              <button className="button secondary" type="button" disabled={!location.isActive || isPending} onClick={() => issueToken(location.id)}>
                <QrCode size={15} />
                QR 발급
              </button>
              <button
                className="button secondary"
                type="button"
                disabled={isPending}
                onClick={() =>
                  run(async () => {
                    await postJson(`/api/admin/work-locations/${location.id}`, {
                      name: location.name,
                      description: location.description ?? null,
                      isActive: !location.isActive
                    });
                    return location.isActive ? "근무지를 비활성화했습니다." : "근무지를 활성화했습니다.";
                  })
                }
              >
                {location.isActive ? "비활성" : "활성"}
              </button>
            </div>
          </div>
        ))}
        {summary.locations.length === 0 ? <div className="empty">등록된 QR 근무지가 없습니다.</div> : null}
      </div>

      {summary.recentTokens.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>근무지</th>
                <th>용도</th>
                <th>상태</th>
                <th>사용자</th>
                <th>만료</th>
              </tr>
            </thead>
            <tbody>
              {summary.recentTokens.slice(0, 8).map((token) => (
                <tr key={token.id}>
                  <td>{token.location.name}</td>
                  <td>{token.purpose}</td>
                  <td>
                    <span className={`status-pill ${token.usedAt ? "green" : new Date(token.expiresAt) < new Date() ? "gray" : "yellow"}`}>
                      {token.usedAt ? "사용" : new Date(token.expiresAt) < new Date() ? "만료" : "대기"}
                    </span>
                  </td>
                  <td>{token.usedBy?.name ?? "-"}</td>
                  <td>{new Date(token.expiresAt).toLocaleTimeString("ko-KR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}

export function InvitationActionButtons({ invitationId }: { invitationId: string }) {
  const { isPending, message, run } = useAdminAction();
  const [inviteUrl, setInviteUrl] = useState("");

  function runInvitationAction(action: "resend" | "reissue" | "cancel") {
    run(async () => {
      const result = (await postJson(`/api/admin/invitations/${invitationId}`, {
        action
      })) as {
        inviteUrl?: string | null;
      };
      if (result.inviteUrl) {
        setInviteUrl(result.inviteUrl);
      }
      if (action === "cancel") {
        return "초대를 취소했습니다.";
      }
      if (action === "reissue") {
        return "새 초대 링크를 발급하고 메일 발송을 시도했습니다.";
      }
      return "초대 메일 재발송을 시도했습니다.";
    });
  }

  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="actions-row">
        <button className="button secondary" type="button" disabled={isPending} onClick={() => runInvitationAction("resend")}>
          재발송
        </button>
        <button className="button secondary" type="button" disabled={isPending} onClick={() => runInvitationAction("reissue")}>
          새 링크
        </button>
        <button className="button secondary" type="button" disabled={isPending} onClick={() => runInvitationAction("cancel")}>
          취소
        </button>
      </div>
      {inviteUrl ? <span className="muted">{inviteUrl}</span> : null}
      {message ? <span className="muted">{message}</span> : null}
    </div>
  );
}

export function TeamEditList({
  teams,
  managers
}: {
  teams: EditableTeam[];
  managers: ManagerOption[];
}) {
  const { isPending, message, run } = useAdminAction();
  const [drafts, setDrafts] = useState<Record<string, EditableTeam>>(
    Object.fromEntries(teams.map((team) => [team.id, team]))
  );

  function updateDraft(teamId: string, patch: Partial<EditableTeam>) {
    setDrafts((current) => ({
      ...current,
      [teamId]: {
        ...current[teamId],
        ...patch
      }
    }));
  }

  return (
    <div className="stack">
      {teams.map((team) => {
        const draft = drafts[team.id] ?? team;
        return (
          <div className="card" key={team.id}>
            <div className="grid-2">
              <div className="field">
                <label htmlFor={`team-edit-${team.id}`}>팀 이름</label>
                <input
                  id={`team-edit-${team.id}`}
                  value={draft.name}
                  onChange={(event) => updateDraft(team.id, { name: event.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor={`team-manager-edit-${team.id}`}>팀 관리자</label>
                <select
                  id={`team-manager-edit-${team.id}`}
                  value={draft.managerUserId ?? ""}
                  onChange={(event) => updateDraft(team.id, { managerUserId: event.target.value || null })}
                >
                  <option value="">지정 안 함</option>
                  {managers.map((manager) => (
                    <option key={manager.id} value={manager.id}>
                      {manager.name} · {roleLabel(manager.role)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="actions-row" style={{ justifyContent: "space-between", marginTop: 12 }}>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={draft.isActive}
                  onChange={(event) => updateDraft(team.id, { isActive: event.target.checked })}
                />
                활성 팀
              </label>
              <button
                className="button secondary"
                type="button"
                disabled={isPending}
                onClick={() =>
                  run(async () => {
                    await postJson(`/api/admin/teams/${team.id}`, draft);
                    return "팀 정보를 저장했습니다.";
                  })
                }
              >
                <Save size={16} />
                저장
              </button>
            </div>
          </div>
        );
      })}
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}

export function UserEditList({
  users,
  teams
}: {
  users: EditableUser[];
  teams: TeamOption[];
}) {
  const { isPending, message, run } = useAdminAction();
  const [drafts, setDrafts] = useState<Record<string, EditableUser>>(
    Object.fromEntries(users.map((user) => [user.id, user]))
  );

  function updateDraft(userId: string, patch: Partial<EditableUser>) {
    setDrafts((current) => ({
      ...current,
      [userId]: {
        ...current[userId],
        ...patch
      }
    }));
  }

  return (
    <div className="stack">
      {users.map((user) => {
        const draft = drafts[user.id] ?? user;
        return (
          <div className="card" key={user.id}>
            <div className="grid-2">
              <div className="field">
                <label htmlFor={`user-name-${user.id}`}>이름</label>
                <input
                  id={`user-name-${user.id}`}
                  value={draft.name}
                  onChange={(event) => updateDraft(user.id, { name: event.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor={`user-email-${user.id}`}>이메일</label>
                <input
                  id={`user-email-${user.id}`}
                  value={draft.email}
                  onChange={(event) => updateDraft(user.id, { email: event.target.value })}
                />
              </div>
            </div>
            <div className="grid-2" style={{ marginTop: 12 }}>
              <div className="field">
                <label htmlFor={`user-role-${user.id}`}>역할</label>
                <select
                  id={`user-role-${user.id}`}
                  value={draft.role}
                  onChange={(event) => updateDraft(user.id, { role: event.target.value })}
                >
                  <option value="EMPLOYEE">직원</option>
                  <option value="MANAGER">팀장</option>
                  <option value="HR">인사 담당</option>
                  <option value="ADMIN">관리자</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor={`user-team-${user.id}`}>팀</label>
                <select
                  id={`user-team-${user.id}`}
                  value={draft.teamId ?? ""}
                  onChange={(event) => updateDraft(user.id, { teamId: event.target.value || null })}
                >
                  <option value="">소속 없음</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid-3" style={{ marginTop: 12 }}>
              <div className="field">
                <label htmlFor={`user-job-title-${user.id}`}>직책</label>
                <input
                  id={`user-job-title-${user.id}`}
                  value={draft.jobTitle ?? ""}
                  onChange={(event) => updateDraft(user.id, { jobTitle: event.target.value || null })}
                  placeholder="예: 인사 매니저"
                />
              </div>
              <div className="field">
                <label htmlFor={`user-phone-${user.id}`}>연락처</label>
                <input
                  id={`user-phone-${user.id}`}
                  value={draft.phoneNumber ?? ""}
                  onChange={(event) => updateDraft(user.id, { phoneNumber: event.target.value || null })}
                  placeholder="010-0000-0000"
                />
              </div>
              <div className="field">
                <label htmlFor={`user-extension-${user.id}`}>내선</label>
                <input
                  id={`user-extension-${user.id}`}
                  value={draft.extensionNumber ?? ""}
                  onChange={(event) => updateDraft(user.id, { extensionNumber: event.target.value || null })}
                  placeholder="예: 120"
                />
              </div>
            </div>
            <div className="actions-row" style={{ justifyContent: "space-between", marginTop: 12 }}>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={draft.isActive}
                  onChange={(event) => updateDraft(user.id, { isActive: event.target.checked })}
                />
                활성 직원
              </label>
              <button
                className="button secondary"
                type="button"
                disabled={isPending}
                onClick={() =>
                  run(async () => {
                    await postJson(`/api/admin/users/${user.id}`, draft);
                    return "직원 정보를 저장했습니다.";
                  })
                }
              >
                <UserCog size={16} />
                저장
              </button>
            </div>
          </div>
        );
      })}
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}

export function PermissionMatrixPanel({
  summary,
  users
}: {
  summary: PermissionMatrixSummary;
  users: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
    teamName: string | null;
  }>;
}) {
  const router = useRouter();

  function selectUser(userId: string) {
    const search = new URLSearchParams(window.location.search);
    search.set("view", "settings");
    search.set("settingsTab", "operations");
    search.set("settingsPermissionUserId", userId);
    router.push(`/dashboard?${search.toString()}#permission-matrix`);
  }

  return (
    <div className="stack">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>역할</th>
              {summary.roleRows[0]?.capabilities.map((capability) => (
                <th key={capability.key}>{capability.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {summary.roleRows.map((row) => (
              <tr key={row.role}>
                <td>
                  <strong>{row.label}</strong>
                </td>
                {row.capabilities.map((capability) => (
                  <td key={capability.key}>
                    <span className={`status-pill ${permissionLevelTone(capability.level)}`}>
                      {permissionLevelLabel(capability.level)}
                    </span>
                    <br />
                    <span className="muted">{capability.detail}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid-3">
        <div className="metric">
          <span>선택 직원</span>
          <strong>{summary.selectedUser?.name ?? "-"}</strong>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            {summary.selectedUser ? `${roleLabel(summary.selectedUser.role)} · ${summary.selectedUser.teamName ?? "소속 없음"}` : "직원을 선택하세요."}
          </p>
        </div>
        <div className="metric">
          <span>접근 가능</span>
          <strong>{summary.totals.accessible}건</strong>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            최근 리소스 {summary.totals.total}건 기준
          </p>
        </div>
        <div className="metric">
          <span>차단</span>
          <strong>{summary.totals.blocked}건</strong>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            권한 사고 점검 대상
          </p>
        </div>
      </div>

      <div className="field">
        <label htmlFor="permission-matrix-user">직원으로 보기</label>
        <select
          id="permission-matrix-user"
          value={summary.selectedUser?.id ?? ""}
          onChange={(event) => selectUser(event.target.value)}
        >
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name} · {roleLabel(user.role)} · {user.teamName ?? "소속 없음"}
            </option>
          ))}
        </select>
      </div>

      {summary.resourceChecks.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>대상</th>
                <th>범위</th>
                <th>결과</th>
                <th>판정 이유</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {summary.resourceChecks.map((resource) => (
                <tr key={resource.id}>
                  <td>
                    <span className="status-pill gray">{resource.typeLabel}</span>
                    <br />
                    <strong>{resource.title}</strong>
                    <br />
                    <span className="muted">{new Date(resource.updatedAt).toLocaleString("ko-KR")}</span>
                  </td>
                  <td>{resource.scope}</td>
                  <td>
                    <span className={`status-pill ${resource.canAccess ? "green" : "red"}`}>
                      {resource.canAccess ? "보임" : "차단"}
                    </span>
                  </td>
                  <td>{resource.reason}</td>
                  <td>
                    <a className="button secondary" href={resource.href}>
                      화면 열기
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">권한을 점검할 최근 그룹웨어 자료가 없습니다.</div>
      )}
    </div>
  );
}

function ClientErrorActions({
  error
}: {
  error: {
    key: string;
    pathname: string;
    apiPath: string | null;
    message: string;
    digest: string | null;
    stack: string | null;
    count: number;
    firstSeenAt: string | Date;
    lastSeenAt: string | Date;
    status: "open" | "resolved";
  };
}) {
  const { isPending, message, run } = useAdminAction();
  const detail = [
    `상태: ${error.status === "resolved" ? "해결됨" : "열림"}`,
    `화면: ${error.pathname}`,
    `API: ${error.apiPath ?? "-"}`,
    `식별자: ${error.digest ?? error.key}`,
    `발생: ${error.count}회`,
    `처음: ${new Date(error.firstSeenAt).toLocaleString("ko-KR")}`,
    `최근: ${new Date(error.lastSeenAt).toLocaleString("ko-KR")}`,
    `메시지: ${error.message}`,
    error.stack ? `스택:\n${error.stack}` : null
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="actions-row">
        <button
          className="button secondary"
          type="button"
          onClick={() =>
            run(async () => {
              await navigator.clipboard.writeText(detail);
              return "오류 상세를 복사했습니다.";
            })
          }
        >
          <Copy size={15} />
          상세 복사
        </button>
        {error.status === "open" ? (
          <button
            className="button secondary"
            type="button"
            disabled={isPending}
            onClick={() =>
              run(async () => {
                await postJson("/api/admin/ops/client-errors/resolve", {
                  key: error.key
                });
                return "오류를 해결됨으로 처리했습니다.";
              })
            }
          >
            <CheckCircle2 size={15} />
            해결 처리
          </button>
        ) : null}
      </div>
      {message ? <span className="muted">{message}</span> : null}
    </div>
  );
}

export function IntegrationSettingsForm({
  settings,
  dispatchLogs,
  opsSummary,
  deploymentSummary,
  users
}: {
  settings: {
    payrollDelimiter: "," | ";" | "TAB";
    payrollHeaders: {
      employeeName: string;
      employeeEmail: string;
      regularMinutes: string;
      overtimeMinutes: string;
      approvedOvertimeMinutes: string;
      annualLeaveRemainingDays: string;
      closeStatus: string;
    };
    calendarDefaultScope: "MY" | "COMPANY";
    calendarIncludeSchedules: boolean;
    calendarIncludeLeaves: boolean;
    slackDigestEnabled: boolean;
    slackWebhookUrl: string;
    emailDigestRecipients: string;
    digestEmailSubject: string;
    digestEmailIntro: string;
    slackDigestTitle: string;
    slackDigestFooter: string;
    erpAdapter: "GENERIC" | "DOUZONE" | "GROUPWARE";
    erpExportFormat: "CSV" | "JSON";
    erpFilePrefix: string;
    calendarEventPrefix: string;
  };
  dispatchLogs: Array<{
    id: string;
    channel: string;
    status: string;
    detail: string | null;
    createdAt: string | Date;
    user: {
      name: string;
      email: string;
    };
  }>;
  opsSummary: {
    checks: Array<{
      key: string;
      label: string;
      status: "ready" | "warning" | "critical";
      detail: string;
    }>;
    metrics: {
      activePushSubscriptions: number;
      subscribedUsers: number;
      failingPushSubscriptions: number;
      recentFailedDispatches: number;
      recentPrunedSubscriptions: number;
    };
    recentFailures: Array<{
      id: string;
      type: string;
      channel: string;
      status: string;
      detail: string | null;
      createdAt: string | Date;
      user: {
        name: string;
        email: string;
      };
    }>;
  };
  deploymentSummary: {
    health: {
      status: "ok" | "degraded";
      timestamp: string | Date;
      checks: Array<{
        key: string;
        label: string;
        status: "ok" | "degraded";
        detail: string;
        severity?: "required" | "recommended";
        action?: string;
      }>;
    };
    bootstrap: {
      seedCommand: string;
      adminBootstrapCommand: string;
      backupCommand: string;
      restoreCommand: string;
    };
    readiness: {
      score: number;
      readyCount: number;
      totalCount: number;
      blockingCount: number;
      warningCount: number;
    };
    sampleData: {
      seededAt: string | Date | null;
      cleanupAvailable: boolean;
    };
    clientErrors: Array<{
      id: string;
      key: string;
      pathname: string;
      apiPath: string | null;
      message: string;
      digest: string | null;
      stack: string | null;
      count: number;
      firstSeenAt: string | Date;
      lastSeenAt: string | Date;
      actor: {
        name: string;
        email: string;
      } | null;
      status: "open" | "resolved";
      resolvedAt: string | Date | null;
      resolvedBy: {
        name: string;
        email: string;
      } | null;
    }>;
    recentOpsEvents: Array<{
      id: string;
      action: string;
      targetType: string;
      targetId: string;
      createdAt: string | Date;
      actor: {
        name: string;
        email: string;
      } | null;
      payload: unknown;
    }>;
  };
  users: Array<{
    id: string;
    name: string;
    email: string;
  }>;
}) {
  const { isPending, message, run } = useAdminAction();
  const [state, setState] = useState(settings);
  const [preview, setPreview] = useState("");
  const [opsOutput, setOpsOutput] = useState("");
  const [testPushUserId, setTestPushUserId] = useState(users[0]?.id ?? "");
  const digestContext = {
    companyName: "워크가드 데모",
    today: new Date().toISOString().slice(0, 10)
  };

  function patch(next: Partial<typeof state>) {
    setState((current) => ({
      ...current,
      ...next
    }));
  }

  function renderTemplate(template: string) {
    return Object.entries(digestContext).reduce(
      (message, [key, value]) => message.replaceAll(`{{${key}}}`, value),
      template
    );
  }

  const filePrefix = state.erpFilePrefix.trim() || "workguard";
  const calendarPrefix = state.calendarEventPrefix.trim() || "워크가드";
  const hasCriticalCheck = opsSummary.checks.some((check) => check.status === "critical");

  function channelLabel(channel: string) {
    if (channel === "slack") {
      return "Slack";
    }
    if (channel === "web_push") {
      return "웹푸시";
    }
    return "이메일";
  }

  function checkTone(status: "ready" | "warning" | "critical") {
    if (status === "ready") {
      return "green";
    }
    if (status === "critical") {
      return "red";
    }
    return "yellow";
  }

  function healthTone(status: "ok" | "degraded") {
    return status === "ok" ? "green" : "yellow";
  }

  function renderOpsPayload(payload: unknown) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return "-";
    }

    const record = payload as Record<string, unknown>;
    if (typeof record.detail === "string") {
      return record.detail;
    }
    if (typeof record.message === "string" && typeof record.pathname === "string") {
      return `${record.pathname} · ${record.message}`;
    }
    if (typeof record.message === "string") {
      return record.message;
    }
    if (typeof record.pathname === "string") {
      return record.pathname;
    }
    return "-";
  }

  return (
    <div className="inline-form">
      <div className="grid-3">
        <div className="metric">
          <span>활성 푸시 구독</span>
          <strong>{opsSummary.metrics.activePushSubscriptions}건</strong>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            직원 {opsSummary.metrics.subscribedUsers}명이 브라우저 푸시를 연결했습니다.
          </p>
        </div>
        <div className="metric">
          <span>전송 실패 감시</span>
          <strong>{opsSummary.metrics.recentFailedDispatches}건</strong>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            실패 구독 {opsSummary.metrics.failingPushSubscriptions}건 · 최근 정리 {opsSummary.metrics.recentPrunedSubscriptions}건
          </p>
        </div>
        <div className="metric">
          <span>배포 준비도</span>
          <strong style={{ fontSize: 18 }}>{deploymentSummary.readiness.score}점</strong>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            차단 {deploymentSummary.readiness.blockingCount}건 · 주의 {deploymentSummary.readiness.warningCount}건
          </p>
        </div>
      </div>

      <div className="split">
        <div className="card">
          <div className="actions-row" style={{ justifyContent: "space-between" }}>
            <strong>연동 상태 체크</strong>
            <span className={`status-pill ${hasCriticalCheck ? "red" : "green"}`}>{hasCriticalCheck ? "즉시 조치" : "운영 가능"}</span>
          </div>
          <div className="stack" style={{ gap: 8, marginTop: 10 }}>
            {opsSummary.checks.map((check) => (
              <div key={check.key} className="notification-card read">
                <div>
                  <strong>{check.label}</strong>
                  <p className="muted" style={{ margin: "6px 0 0" }}>
                    {check.detail}
                  </p>
                </div>
                <span className={`status-pill ${checkTone(check.status)}`}>{check.status === "ready" ? "정상" : check.status === "critical" ? "치명" : "주의"}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="actions-row" style={{ justifyContent: "space-between" }}>
            <strong>배포 상태 체크</strong>
            <span className={`status-pill ${healthTone(deploymentSummary.health.status)}`}>
              {deploymentSummary.health.status === "ok" ? "정상" : "점검 필요"}
            </span>
          </div>
          <div className="stack" style={{ gap: 8, marginTop: 10 }}>
            {deploymentSummary.health.checks.map((check) => (
              <div key={check.key} className="notification-card read">
                <div>
                  <strong>{check.label}</strong>
                  <p className="muted" style={{ margin: "6px 0 0" }}>
                    {check.detail}
                    {check.action ? ` · 조치: ${check.action}` : ""}
                  </p>
                </div>
                <span className={`status-pill ${healthTone(check.status)}`}>{check.status === "ok" ? "정상" : "점검 필요"}</span>
              </div>
            ))}
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <strong>운영 부트스트랩</strong>
            <p className="muted" style={{ margin: "8px 0 0" }}>
              초기 데이터와 첫 관리자 계정은 아래 명령으로 준비합니다.
            </p>
            <pre style={{ margin: "10px 0 0", whiteSpace: "pre-wrap" }}>
              {deploymentSummary.bootstrap.seedCommand}
              {"\n"}
              {deploymentSummary.bootstrap.adminBootstrapCommand}
              {"\n"}
              {deploymentSummary.bootstrap.backupCommand}
              {"\n"}
              {deploymentSummary.bootstrap.restoreCommand}
            </pre>
            <p className="muted" style={{ margin: "8px 0 0" }}>
              샘플 데이터 {deploymentSummary.sampleData.seededAt ? `있음 · ${new Date(deploymentSummary.sampleData.seededAt).toLocaleString("ko-KR")}` : "없음"}
            </p>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="actions-row" style={{ justifyContent: "space-between" }}>
          <strong>테스트 전송</strong>
          <button
            className="button secondary"
            type="button"
            disabled={isPending}
            onClick={() =>
              run(
                async () => {
                  setOpsOutput("");
                  return "운영 관제 상태를 새로고침했습니다.";
                },
                "운영 관제 상태를 새로고침했습니다."
              )
            }
          >
            <RefreshCw size={15} />
            상태 새로고침
          </button>
        </div>
        <div className="grid-2" style={{ marginTop: 12 }}>
          <div className="field">
            <label htmlFor="integration-test-user">웹푸시 테스트 대상</label>
            <select id="integration-test-user" value={testPushUserId} onChange={(event) => setTestPushUserId(event.target.value)}>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} · {user.email}
                </option>
              ))}
            </select>
          </div>
          <div className="actions-row" style={{ alignItems: "flex-end" }}>
            <button
              className="button secondary"
              type="button"
              disabled={isPending}
              onClick={() =>
                run(async () => {
                  const result = (await postJson("/api/admin/integrations/test", {
                    channel: "slack"
                  })) as { detail: string };
                  setOpsOutput(result.detail);
                  return "Slack 테스트 전송을 실행했습니다.";
                })
              }
            >
              <Send size={16} />
              Slack 테스트
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={isPending || !testPushUserId}
              onClick={() =>
                run(async () => {
                  const result = (await postJson("/api/admin/integrations/test", {
                    channel: "web_push",
                    userId: testPushUserId
                  })) as { detail: string };
                  setOpsOutput(result.detail);
                  return "웹푸시 테스트 전송을 실행했습니다.";
                })
              }
            >
              <Send size={16} />
              웹푸시 테스트
            </button>
          </div>
        </div>
        {opsOutput ? (
          <p className="muted" style={{ margin: "10px 0 0" }}>
            {opsOutput}
          </p>
        ) : null}
      </div>

      <div className="grid-2">
        <div className="field">
          <label htmlFor="integration-delimiter">급여 CSV 구분자</label>
          <select
            id="integration-delimiter"
            value={state.payrollDelimiter}
            onChange={(event) => patch({ payrollDelimiter: event.target.value as "," | ";" | "TAB" })}
          >
            <option value=",">콤마</option>
            <option value=";">세미콜론</option>
            <option value="TAB">탭</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="integration-erp-adapter">ERP 어댑터</label>
          <select
            id="integration-erp-adapter"
            value={state.erpAdapter}
            onChange={(event) => patch({ erpAdapter: event.target.value as "GENERIC" | "DOUZONE" | "GROUPWARE" })}
          >
            <option value="GENERIC">일반 CSV</option>
            <option value="DOUZONE">더존</option>
            <option value="GROUPWARE">그룹웨어</option>
          </select>
        </div>
      </div>
      <div className="grid-3">
        <div className="field">
          <label htmlFor="integration-name-header">이름 컬럼</label>
          <input
            id="integration-name-header"
            value={state.payrollHeaders.employeeName}
            onChange={(event) =>
              patch({
                payrollHeaders: {
                  ...state.payrollHeaders,
                  employeeName: event.target.value
                }
              })
            }
          />
        </div>
        <div className="field">
          <label htmlFor="integration-email-header">이메일 컬럼</label>
          <input
            id="integration-email-header"
            value={state.payrollHeaders.employeeEmail}
            onChange={(event) =>
              patch({
                payrollHeaders: {
                  ...state.payrollHeaders,
                  employeeEmail: event.target.value
                }
              })
            }
          />
        </div>
        <div className="field">
          <label htmlFor="integration-regular-header">정규근무 컬럼</label>
          <input
            id="integration-regular-header"
            value={state.payrollHeaders.regularMinutes}
            onChange={(event) =>
              patch({
                payrollHeaders: {
                  ...state.payrollHeaders,
                  regularMinutes: event.target.value
                }
              })
            }
          />
        </div>
      </div>
      <div className="grid-3">
        <div className="field">
          <label htmlFor="integration-overtime-header">연장근무 컬럼</label>
          <input
            id="integration-overtime-header"
            value={state.payrollHeaders.overtimeMinutes}
            onChange={(event) =>
              patch({
                payrollHeaders: {
                  ...state.payrollHeaders,
                  overtimeMinutes: event.target.value
                }
              })
            }
          />
        </div>
        <div className="field">
          <label htmlFor="integration-approved-header">승인연장 컬럼</label>
          <input
            id="integration-approved-header"
            value={state.payrollHeaders.approvedOvertimeMinutes}
            onChange={(event) =>
              patch({
                payrollHeaders: {
                  ...state.payrollHeaders,
                  approvedOvertimeMinutes: event.target.value
                }
              })
            }
          />
        </div>
        <div className="field">
          <label htmlFor="integration-leave-header">잔여연차 컬럼</label>
          <input
            id="integration-leave-header"
            value={state.payrollHeaders.annualLeaveRemainingDays}
            onChange={(event) =>
              patch({
                payrollHeaders: {
                  ...state.payrollHeaders,
                  annualLeaveRemainingDays: event.target.value
                }
              })
            }
          />
        </div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="integration-calendar-scope">캘린더 기본 범위</label>
          <select
            id="integration-calendar-scope"
            value={state.calendarDefaultScope}
            onChange={(event) => patch({ calendarDefaultScope: event.target.value as "MY" | "COMPANY" })}
          >
            <option value="MY">내 캘린더</option>
            <option value="COMPANY">회사 캘린더</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="integration-digest-email">요약 알림 수신 이메일</label>
          <input
            id="integration-digest-email"
            value={state.emailDigestRecipients}
            onChange={(event) => patch({ emailDigestRecipients: event.target.value })}
            placeholder="ops@gamsi.kr, hr@gamsi.kr"
          />
        </div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="integration-erp-prefix">ERP 파일명 접두어</label>
          <input
            id="integration-erp-prefix"
            value={state.erpFilePrefix}
            onChange={(event) => patch({ erpFilePrefix: event.target.value })}
            placeholder="workguard"
          />
        </div>
        <div className="field">
          <label htmlFor="integration-calendar-prefix">캘린더 일정 제목 접두어</label>
          <input
            id="integration-calendar-prefix"
            value={state.calendarEventPrefix}
            onChange={(event) => patch({ calendarEventPrefix: event.target.value })}
            placeholder="워크가드"
          />
        </div>
      </div>
      <label className="check-row">
        <input
          type="checkbox"
          checked={state.calendarIncludeSchedules}
          onChange={(event) => patch({ calendarIncludeSchedules: event.target.checked })}
        />
        캘린더 내보내기에 근무 스케줄 포함
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={state.calendarIncludeLeaves}
          onChange={(event) => patch({ calendarIncludeLeaves: event.target.checked })}
        />
        캘린더 내보내기에 승인 휴가 포함
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={state.slackDigestEnabled}
          onChange={(event) => patch({ slackDigestEnabled: event.target.checked })}
        />
        Slack 요약 알림 사용
      </label>
      <div className="field">
        <label htmlFor="integration-slack-webhook">Slack 알림 수신 주소</label>
        <input
          id="integration-slack-webhook"
          value={state.slackWebhookUrl}
          onChange={(event) => patch({ slackWebhookUrl: event.target.value })}
          placeholder="https://hooks.slack.com/services/..."
        />
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="integration-digest-email-subject">이메일 제목 템플릿</label>
          <input
            id="integration-digest-email-subject"
            value={state.digestEmailSubject}
            onChange={(event) => patch({ digestEmailSubject: event.target.value })}
            placeholder="[워크가드] {{companyName}} 오늘 운영 요약"
          />
        </div>
        <div className="field">
          <label htmlFor="integration-digest-email-intro">이메일 안내 문구</label>
          <input
            id="integration-digest-email-intro"
            value={state.digestEmailIntro}
            onChange={(event) => patch({ digestEmailIntro: event.target.value })}
            placeholder="{{companyName}} 운영 요약 알림입니다."
          />
        </div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="integration-slack-title">Slack 제목 템플릿</label>
          <input
            id="integration-slack-title"
            value={state.slackDigestTitle}
            onChange={(event) => patch({ slackDigestTitle: event.target.value })}
            placeholder="{{companyName}} 오늘 운영 요약"
          />
        </div>
        <div className="field">
          <label htmlFor="integration-slack-footer">Slack 마무리 문구</label>
          <input
            id="integration-slack-footer"
            value={state.slackDigestFooter}
            onChange={(event) => patch({ slackDigestFooter: event.target.value })}
            placeholder="워크가드 자동 요약"
          />
        </div>
      </div>
      <div className="card">
        <strong>내보내기/알림 미리보기</strong>
        <p className="muted" style={{ margin: "8px 0 0" }}>
          ERP 파일 예시: {filePrefix}-{state.erpAdapter.toLowerCase()}-2026-04.{state.erpExportFormat === "JSON" ? "json" : "csv"}
        </p>
        <p className="muted" style={{ margin: "8px 0 0" }}>
          캘린더 제목 예시: {calendarPrefix} 근무 · 홍길동 · 기본 근무
        </p>
        <p className="muted" style={{ margin: "8px 0 0" }}>
          이메일 제목 예시: {renderTemplate(state.digestEmailSubject)}
        </p>
        <p className="muted" style={{ margin: "8px 0 0" }}>
          이메일 안내 예시: {renderTemplate(state.digestEmailIntro)}
        </p>
        <p className="muted" style={{ margin: "8px 0 0" }}>
          Slack 제목 예시: {renderTemplate(state.slackDigestTitle)}
        </p>
      </div>
      <div className="actions-row">
        <button
          className="button"
          type="button"
          disabled={isPending}
          onClick={() =>
            run(async () => {
              await postJson("/api/admin/integrations", state);
              return "연동 설정을 저장했습니다.";
            })
          }
        >
          <Save size={16} />
          연동 설정 저장
        </button>
        <a className="button secondary" href="/api/integrations/calendar/export?scope=company">
          <CalendarDays size={16} />
          ICS 내보내기
        </a>
        <a className="button secondary" href="/api/integrations/erp/export">
          <Send size={16} />
          ERP 내보내기
        </a>
        <button
          className="button secondary"
          type="button"
          disabled={isPending}
          onClick={() =>
            run(async () => {
              const result = (await postJson("/api/integrations/digest/preview", {})) as {
                title: string;
                emailSubject?: string;
                emailIntro?: string;
                slackFooter?: string;
                lines: string[];
              };
              setPreview(
                [
                  result.emailSubject ? `이메일 제목: ${result.emailSubject}` : result.title,
                  result.emailIntro ? `이메일 안내: ${result.emailIntro}` : null,
                  `Slack 제목: ${result.title}`,
                  ...result.lines,
                  result.slackFooter ? `Slack 마무리: ${result.slackFooter}` : null
                ]
                  .filter(Boolean)
                  .join("\n")
              );
              return "요약 알림 미리보기를 생성했습니다.";
            })
          }
        >
          요약 알림 미리보기
        </button>
        <button
          className="button secondary"
          type="button"
          disabled={isPending}
          onClick={() =>
            run(async () => {
              const result = (await postJson("/api/integrations/digest/send", {})) as {
                results: Array<{ detail: string }>;
              };
              setPreview(result.results.map((entry) => entry.detail).join("\n"));
              return "요약 알림 전송 결과를 확인했습니다.";
            })
          }
        >
          요약 알림 전송 점검
        </button>
      </div>
      {dispatchLogs.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>시각</th>
                <th>채널</th>
                <th>상태</th>
                <th>담당자</th>
                <th>결과</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {dispatchLogs.map((log) => (
                <tr key={log.id}>
                  <td>{new Date(log.createdAt).toLocaleString("ko-KR")}</td>
                  <td>{channelLabel(log.channel)}</td>
                  <td>
                    <span className={`status-pill ${integrationDispatchStatusTone(log.status)}`}>
                      {integrationDispatchStatusLabel(log.status)}
                    </span>
                  </td>
                  <td>
                    {log.user.name}
                    <br />
                    <span className="muted">{log.user.email}</span>
                  </td>
                  <td>{log.detail ?? "-"}</td>
                  <td>
                    {log.channel !== "web_push" && log.status !== "sent" ? (
                      <button
                        className="button secondary"
                        type="button"
                        disabled={isPending}
                        onClick={() =>
                          run(async () => {
                            const result = (await postJson("/api/integrations/digest/send", {
                              retryLogId: log.id
                            })) as { results: Array<{ detail: string }> };
                            setPreview(result.results.map((entry) => entry.detail).join("\n"));
                            return "요약 알림 재시도를 실행했습니다.";
                          })
                        }
                      >
                        <RefreshCw size={15} />
                        다시 시도
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">아직 저장된 연동 전송 이력이 없습니다.</div>
      )}
      {opsSummary.recentFailures.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>최근 실패 시각</th>
                <th>채널</th>
                <th>담당자</th>
                <th>실패 내용</th>
              </tr>
            </thead>
            <tbody>
              {opsSummary.recentFailures.map((log) => (
                <tr key={log.id}>
                  <td>{new Date(log.createdAt).toLocaleString("ko-KR")}</td>
                  <td>{channelLabel(log.channel)}</td>
                  <td>
                    {log.user.name}
                    <br />
                    <span className="muted">{log.user.email}</span>
                  </td>
                  <td>{log.detail ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">최근 실패한 알림/연동 기록이 없습니다.</div>
      )}
      {deploymentSummary.clientErrors.length > 0 ? (
        <div className="grid-3">
          {deploymentSummary.clientErrors.slice(0, 3).map((error) => (
            <div className="notice-card warning" key={`client-error-summary-${error.id}`}>
              <div>
                <span className={`status-pill ${error.status === "resolved" ? "green" : "red"}`}>
                  {error.status === "resolved" ? "해결됨" : "클라이언트 오류"} {error.count}회
                </span>
                <strong style={{ display: "block", marginTop: 8 }}>{error.pathname}</strong>
                <p className="muted" style={{ margin: "6px 0 0" }}>
                  {error.message}
                </p>
                <p className="muted" style={{ margin: "6px 0 0" }}>
                  API {error.apiPath ?? "-"} · 최근 {new Date(error.lastSeenAt).toLocaleString("ko-KR")}
                </p>
                {error.digest ? (
                  <p className="muted" style={{ margin: "6px 0 0" }}>
                    식별자 {error.digest}
                  </p>
                ) : null}
              </div>
              {error.pathname && error.pathname !== "-" ? (
                <a className="button secondary" href={error.pathname}>
                  화면 열기
                </a>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {deploymentSummary.clientErrors.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>상태</th>
                <th>화면</th>
                <th>API</th>
                <th>발생</th>
                <th>사용자</th>
                <th>메시지</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {deploymentSummary.clientErrors.map((error) => (
                <tr key={error.id}>
                  <td>
                    <span className={`status-pill ${error.status === "resolved" ? "green" : "red"}`}>
                      {error.status === "resolved" ? "해결됨" : "열림"}
                    </span>
                    {error.resolvedAt ? (
                      <>
                        <br />
                        <span className="muted">
                          {new Date(error.resolvedAt).toLocaleString("ko-KR")}
                          {error.resolvedBy ? ` · ${error.resolvedBy.name}` : ""}
                        </span>
                      </>
                    ) : null}
                  </td>
                  <td>
                    {error.pathname}
                    {error.digest ? (
                      <>
                        <br />
                        <span className="muted">오류 식별자: {error.digest}</span>
                      </>
                    ) : null}
                  </td>
                  <td>{error.apiPath ?? "-"}</td>
                  <td>
                    {error.count}회
                    <br />
                    <span className="muted">
                      처음 {new Date(error.firstSeenAt).toLocaleString("ko-KR")}
                      <br />
                      최근 {new Date(error.lastSeenAt).toLocaleString("ko-KR")}
                    </span>
                  </td>
                  <td>
                    {error.actor?.name ?? "-"}
                    {error.actor?.email ? (
                      <>
                        <br />
                        <span className="muted">{error.actor.email}</span>
                      </>
                    ) : null}
                  </td>
                  <td>{error.message}</td>
                  <td>
                    <ClientErrorActions error={error} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">최근 수집된 클라이언트 오류가 없습니다.</div>
      )}
      {deploymentSummary.recentOpsEvents.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>최근 운영 이벤트</th>
                <th>담당자</th>
                <th>대상</th>
                <th>요약</th>
              </tr>
            </thead>
            <tbody>
              {deploymentSummary.recentOpsEvents.map((event) => (
                <tr key={event.id}>
                  <td>{new Date(event.createdAt).toLocaleString("ko-KR")}</td>
                  <td>
                    {event.actor?.name ?? "-"}
                    {event.actor?.email ? (
                      <>
                        <br />
                        <span className="muted">{event.actor.email}</span>
                      </>
                    ) : null}
                  </td>
                  <td>
                    {event.targetType}
                    <br />
                    <span className="muted">{event.targetId}</span>
                  </td>
                  <td>{renderOpsPayload(event.payload)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">최근 수집된 운영 오류/이벤트가 없습니다.</div>
      )}
      {preview ? (
        <div className="card">
          <strong>요약 알림 미리보기</strong>
          <pre style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>{preview}</pre>
        </div>
      ) : null}
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}

export function AutomationSettingsForm({
  summary
}: {
  summary: {
    settings: {
      dailyDigestEnabled: boolean;
      failureAlertThreshold: number;
      autoPruneEnabled: boolean;
      deadSubscriptionFailureCount: number;
    };
    recentRuns: Array<{
      id: string;
      createdAt: string | Date;
      trigger: "manual" | "cron";
      scheduler: {
        approvalPending: number;
        leaveStarting: number;
        missingRecord: number;
        monthClose: number;
        riskEscalation: number;
      };
      digest: {
        sent: number;
        skipped: number;
        failed: number;
      };
      failureAlert: {
        triggered: boolean;
        detail: string;
      };
      prune: {
        pruned: number;
      };
      metrics: {
        pendingApprovals: number;
        unresolvedRisks: number;
        monthCloseBlockers: number;
        failingPushSubscriptions: number;
        recentFailedDispatches: number;
      };
    }>;
  };
}) {
  const { isPending, message, run } = useAdminAction();
  const [dailyDigestEnabled, setDailyDigestEnabled] = useState(summary.settings.dailyDigestEnabled);
  const [failureAlertThreshold, setFailureAlertThreshold] = useState(String(summary.settings.failureAlertThreshold));
  const [autoPruneEnabled, setAutoPruneEnabled] = useState(summary.settings.autoPruneEnabled);
  const [deadSubscriptionFailureCount, setDeadSubscriptionFailureCount] = useState(
    String(summary.settings.deadSubscriptionFailureCount)
  );
  const [runOutput, setRunOutput] = useState("");

  return (
    <div className="inline-form">
      <div className="grid-2">
        <label className="check-row">
          <input type="checkbox" checked={dailyDigestEnabled} onChange={(event) => setDailyDigestEnabled(event.target.checked)} />
          정기 요약 자동 발송
        </label>
        <label className="check-row">
          <input type="checkbox" checked={autoPruneEnabled} onChange={(event) => setAutoPruneEnabled(event.target.checked)} />
          죽은 푸시 구독 자동 정리
        </label>
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="automation-failure-threshold">실패 경보 임계치</label>
          <input
            id="automation-failure-threshold"
            inputMode="numeric"
            value={failureAlertThreshold}
            onChange={(event) => setFailureAlertThreshold(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="automation-prune-threshold">구독 정리 실패 횟수</label>
          <input
            id="automation-prune-threshold"
            inputMode="numeric"
            value={deadSubscriptionFailureCount}
            onChange={(event) => setDeadSubscriptionFailureCount(event.target.value)}
          />
        </div>
      </div>
      <div className="actions-row">
        <button
          className="button"
          type="button"
          disabled={isPending}
          onClick={() =>
            run(async () => {
              await postJson("/api/admin/automation", {
                dailyDigestEnabled,
                failureAlertThreshold: Number(failureAlertThreshold),
                autoPruneEnabled,
                deadSubscriptionFailureCount: Number(deadSubscriptionFailureCount)
              });
              return "운영 자동화 설정을 저장했습니다.";
            })
          }
        >
          <Save size={16} />
          자동화 저장
        </button>
        <button
          className="button secondary"
          type="button"
          disabled={isPending}
          onClick={() =>
            run(async () => {
              const result = (await postJson("/api/admin/automation", {
                action: "run"
              })) as {
                companies?: Array<{
                  digest?: { sent?: number; failed?: number };
                  prune?: { pruned?: number };
                  failureAlert?: { detail?: string };
                }>;
              };
              const current = result.companies?.[0];
              setRunOutput(
                `요약 발송 ${current?.digest?.sent ?? 0}건 · 발송 실패 ${current?.digest?.failed ?? 0}건 · 구독 정리 ${current?.prune?.pruned ?? 0}건`
              );
              return "운영 자동화를 즉시 실행했습니다.";
            })
          }
        >
          <RefreshCw size={16} />
          지금 실행
        </button>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        월마감 리마인더와 리스크 처리기한 리마인더는 스케줄러에 포함되어 함께 실행됩니다.
      </p>
      {runOutput ? <p className="muted">{runOutput}</p> : null}
      {message ? <p className="muted">{message}</p> : null}

      <div className="card">
        <div className="actions-row" style={{ justifyContent: "space-between" }}>
          <strong>최근 자동화 실행</strong>
          <span className="status-pill gray">{summary.recentRuns.length}건</span>
        </div>
        {summary.recentRuns.length > 0 ? (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>시각</th>
                  <th>트리거</th>
                  <th>요약 발송</th>
                  <th>실패 경보</th>
                  <th>구독 정리</th>
                </tr>
              </thead>
              <tbody>
                {summary.recentRuns.map((runRow) => (
                  <tr key={runRow.id}>
                    <td>{new Date(runRow.createdAt).toLocaleString("ko-KR")}</td>
                    <td>{runRow.trigger === "manual" ? "수동" : "예약"}</td>
                    <td>
                      발송 {runRow.digest.sent}건 · 실패 {runRow.digest.failed}건
                    </td>
                    <td>{runRow.failureAlert.triggered ? runRow.failureAlert.detail : "정상"}</td>
                    <td>{runRow.prune.pruned}건</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty" style={{ marginTop: 12 }}>아직 기록된 자동화 실행 이력이 없습니다.</div>
        )}
      </div>
    </div>
  );
}

export function EvidenceSecuritySettingsForm({
  summary
}: {
  summary: {
    settings: {
      retentionDays: number;
      managerScopedAccess: boolean;
    };
    metrics: {
      totalAttachments: number;
      overdueAttachments: number;
      retainedAttachments: number;
      recentDownloadEvents: number;
    };
    recentAttachments: Array<{
      id: string;
      originalName: string;
      mimeType: string;
      sizeBytes: number;
      createdAt: string | Date;
      uploadedByName: string;
      requestType: string;
      requester: {
        name: string;
        team?: {
          name?: string | null;
        } | null;
      };
      isOverRetention: boolean;
    }>;
    recentDownloads: Array<{
      id: string;
      createdAt: string | Date;
      actor: {
        name: string;
        email: string;
      } | null;
      originalName: string;
    }>;
  };
}) {
  const { isPending, message, run } = useAdminAction();
  const [retentionDays, setRetentionDays] = useState(String(summary.settings.retentionDays));
  const [managerScopedAccess, setManagerScopedAccess] = useState(summary.settings.managerScopedAccess);

  return (
    <div className="inline-form">
      <div className="grid-3">
        <div className="metric">
          <span>전체 증빙</span>
          <strong>{summary.metrics.totalAttachments}건</strong>
        </div>
        <div className="metric">
          <span>보관기한 경과</span>
          <strong>{summary.metrics.overdueAttachments}건</strong>
        </div>
        <div className="metric">
          <span>최근 다운로드</span>
          <strong>{summary.metrics.recentDownloadEvents}건</strong>
        </div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="evidence-retention-days">보관기간(일)</label>
          <input
            id="evidence-retention-days"
            inputMode="numeric"
            value={retentionDays}
            onChange={(event) => setRetentionDays(event.target.value)}
          />
        </div>
        <label className="check-row" style={{ alignSelf: "flex-end" }}>
          <input
            type="checkbox"
            checked={managerScopedAccess}
            onChange={(event) => setManagerScopedAccess(event.target.checked)}
          />
          팀장은 관리 범위 증빙만 접근
        </label>
      </div>
      <button
        className="button"
        type="button"
        disabled={isPending}
        onClick={() =>
          run(async () => {
            await postJson("/api/admin/evidence", {
              retentionDays: Number(retentionDays),
              managerScopedAccess
            });
            return "증빙 보안 정책을 저장했습니다.";
          })
        }
      >
        <Save size={16} />
        증빙 정책 저장
      </button>
      {message ? <p className="muted">{message}</p> : null}

      <div className="split">
        <div className="card">
          <strong>최근 증빙</strong>
          {summary.recentAttachments.length > 0 ? (
            <div className="stack" style={{ gap: 8, marginTop: 12 }}>
              {summary.recentAttachments.slice(0, 6).map((attachment) => (
                <div key={attachment.id} className="notification-card read">
                  <div className="actions-row" style={{ justifyContent: "space-between" }}>
                    <strong>{attachment.originalName}</strong>
                    <span className={`status-pill ${attachment.isOverRetention ? "yellow" : "green"}`}>
                      {attachment.isOverRetention ? "기한 경과" : "보관중"}
                    </span>
                  </div>
                  <p className="muted" style={{ margin: "6px 0 0" }}>
                    {attachment.requester.name} · {attachment.requester.team?.name ?? "소속 없음"} · {attachment.mimeType}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty" style={{ marginTop: 12 }}>최근 증빙이 없습니다.</div>
          )}
        </div>

        <div className="card">
          <strong>최근 다운로드 감사</strong>
          {summary.recentDownloads.length > 0 ? (
            <div className="stack" style={{ gap: 8, marginTop: 12 }}>
              {summary.recentDownloads.slice(0, 6).map((download) => (
                <div key={download.id} className="notification-card read">
                  <div className="actions-row" style={{ justifyContent: "space-between" }}>
                    <strong>{download.originalName}</strong>
                    <span className="muted">{new Date(download.createdAt).toLocaleString("ko-KR")}</span>
                  </div>
                  <p className="muted" style={{ margin: "6px 0 0" }}>
                    {download.actor?.name ?? "시스템"} · {download.actor?.email ?? "-"}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty" style={{ marginTop: 12 }}>아직 다운로드 감사 이력이 없습니다.</div>
          )}
        </div>
      </div>
    </div>
  );
}

export function OnboardingChecklistForm({
  summary
}: {
  summary: {
    steps: Array<{
      id: string;
      label: string;
      complete: boolean;
      detail: string;
    }>;
    completedCount: number;
    totalCount: number;
    criticalChecks: Array<{
      key: string;
      label: string;
      detail: string;
    }>;
    sampleSeededAt: string | Date | null;
  };
}) {
  const { isPending, message, run } = useAdminAction();

  return (
    <div className="inline-form">
      <div className="actions-row" style={{ justifyContent: "space-between" }}>
        <strong>첫 회사 설정 Wizard</strong>
        <span className={`status-pill ${summary.completedCount === summary.totalCount ? "green" : "yellow"}`}>
          {summary.completedCount}/{summary.totalCount}
        </span>
      </div>
      <div className="stack" style={{ gap: 8 }}>
        {summary.steps.map((step) => (
          <div key={step.id} className="notification-card read">
            <div className="actions-row" style={{ justifyContent: "space-between" }}>
              <strong>{step.label}</strong>
              <span className={`status-pill ${step.complete ? "green" : "yellow"}`}>
                {step.complete ? "완료" : "확인 필요"}
              </span>
            </div>
            <p className="muted" style={{ margin: "6px 0 0" }}>{step.detail}</p>
          </div>
        ))}
      </div>
      {summary.criticalChecks.length > 0 ? (
        <div className="card">
          <strong>필수 환경 변수 누락</strong>
          <div className="stack" style={{ gap: 8, marginTop: 12 }}>
            {summary.criticalChecks.map((check) => (
              <div key={check.key} className="notification-card read">
                <strong>{check.label}</strong>
                <p className="muted" style={{ margin: "6px 0 0" }}>{check.detail}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="actions-row">
        <button
          className="button secondary"
          type="button"
          disabled={isPending}
          onClick={() =>
            run(async () => {
              await postJson("/api/admin/onboarding/sample-data", {});
              return "샘플 데이터 주입을 완료했습니다.";
            })
          }
        >
          <Users size={16} />
          샘플 데이터 주입
        </button>
        {summary.sampleSeededAt ? (
          <button
            className="button secondary"
            type="button"
            disabled={isPending}
            onClick={() =>
              run(async () => {
                await deleteJson("/api/admin/onboarding/sample-data");
                return "샘플 데이터를 제거했습니다.";
              })
            }
          >
            <Trash2 size={16} />
            샘플 제거
          </button>
        ) : null}
        <span className="muted">
          {summary.sampleSeededAt ? `최근 주입 ${new Date(summary.sampleSeededAt).toLocaleString("ko-KR")}` : "샘플 데이터 없음"}
        </span>
      </div>
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}
