const KST_OFFSET_MINUTES = 9 * 60;
const MINUTE_MS = 60 * 1000;

export function getKstDateString(date = new Date()) {
  const kst = new Date(date.getTime() + KST_OFFSET_MINUTES * MINUTE_MS);
  return kst.toISOString().slice(0, 10);
}

export function dateOnly(dateString: string) {
  return new Date(`${dateString}T00:00:00.000Z`);
}

export function kstDateTime(dateString: string, hour: number, minute = 0) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - KST_OFFSET_MINUTES * MINUTE_MS);
}

export function parseTimeValue(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    return null;
  }

  return { hour, minute };
}

export function kstDateTimeFromTimeString(dateString: string, value: string) {
  const parsed = parseTimeValue(value);
  if (!parsed) {
    return null;
  }

  return kstDateTime(dateString, parsed.hour, parsed.minute);
}

export function kstDayBounds(dateString: string) {
  const start = kstDateTime(dateString, 0, 0);
  const end = new Date(start.getTime() + 24 * 60 * MINUTE_MS);
  return { start, end };
}

export function kstWeekBounds(dateString = getKstDateString()) {
  const base = kstDateTime(dateString, 12, 0);
  const kst = new Date(base.getTime() + KST_OFFSET_MINUTES * MINUTE_MS);
  const day = kst.getUTCDay();
  const daysFromMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(kst.getTime() - daysFromMonday * 24 * 60 * MINUTE_MS);
  const mondayString = monday.toISOString().slice(0, 10);
  const start = kstDateTime(mondayString, 0, 0);
  const end = new Date(start.getTime() + 7 * 24 * 60 * MINUTE_MS);
  return { start, end, mondayString };
}

export function kstMonthBounds(monthString = getKstDateString().slice(0, 7)) {
  const [year, month] = monthString.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1, -KST_OFFSET_MINUTES / 60, 0));
  const end = new Date(Date.UTC(year, month, 1, -KST_OFFSET_MINUTES / 60, 0));
  return { start, end };
}

export function monthDateBounds(monthString = getKstDateString().slice(0, 7)) {
  const [year, month] = monthString.split("-").map(Number);
  const startString = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
  const nextMonthYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const endString = `${String(nextMonthYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01`;
  const lastDate = new Date(`${endString}T00:00:00.000Z`);
  lastDate.setUTCDate(lastDate.getUTCDate() - 1);

  return {
    start: dateOnly(startString),
    end: dateOnly(endString),
    startString,
    endString: lastDate.toISOString().slice(0, 10)
  };
}

export function minutesBetween(start: Date, end: Date) {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / MINUTE_MS));
}

export function formatMinutes(minutes: number) {
  const safeMinutes = Math.max(0, minutes);
  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;
  if (hours === 0) {
    return `${remainder}분`;
  }

  if (remainder === 0) {
    return `${hours}시간`;
  }

  return `${hours}시간 ${remainder}분`;
}

export function formatKstDateTime(value?: Date | string | null) {
  if (!value) {
    return "-";
  }

  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function formatKstDate(value?: Date | string | null) {
  if (!value) {
    return "-";
  }

  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  }).format(date);
}

export function formatKstTime(value?: Date | string | null) {
  if (!value) {
    return "-";
  }

  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
