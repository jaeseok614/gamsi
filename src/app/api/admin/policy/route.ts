import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { updateWorkPolicySettings } from "@/lib/admin";
import { jsonError, requireApiUser } from "@/lib/api";
import { canAdminSettings } from "@/lib/auth";
import { parseTimeValue } from "@/lib/time";

export async function POST(request: NextRequest) {
  const { user, response } = await requireApiUser(request);
  if (response) {
    return response;
  }

  if (!canAdminSettings(user.role)) {
    return jsonError("계산 정책 설정 권한이 필요합니다.", 403);
  }

  const body = (await request.json().catch(() => ({}))) as {
    standardDailyHours?: number;
    overtimeThresholdHours?: number;
    weeklyLimitHours?: number;
    defaultBreakMinutes?: number;
    annualLeaveBasis?: "CALENDAR_YEAR" | "JOIN_DATE";
    annualLeaveGrantDays?: number;
    firstYearMonthlyAccrualEnabled?: boolean;
    annualLeaveCarryoverDays?: number;
    carryoverExpiryMonth?: number;
    carryoverExpiryDay?: number;
    allowHalfDayLeave?: boolean;
    allowHourlyLeave?: boolean;
    hourlyLeaveUnitMinutes?: number;
    overtimePremiumRate?: number;
    nightPremiumRate?: number;
    holidayPremiumRate?: number;
    holidayIncludesWeekends?: boolean;
    nightWorkStart?: string;
    nightWorkEnd?: string;
  };

  const standardDailyHours = Number(body.standardDailyHours);
  const overtimeThresholdHours = Number(body.overtimeThresholdHours);
  const weeklyLimitHours = Number(body.weeklyLimitHours);
  const defaultBreakMinutes = Number(body.defaultBreakMinutes);
  const annualLeaveBasis = body.annualLeaveBasis === "JOIN_DATE" ? "JOIN_DATE" : "CALENDAR_YEAR";
  const annualLeaveGrantDays = Number(body.annualLeaveGrantDays);
  const firstYearMonthlyAccrualEnabled = Boolean(body.firstYearMonthlyAccrualEnabled);
  const annualLeaveCarryoverDays = Number(body.annualLeaveCarryoverDays);
  const carryoverExpiryMonth = Number(body.carryoverExpiryMonth);
  const carryoverExpiryDay = Number(body.carryoverExpiryDay);
  const hourlyLeaveUnitMinutes = Number(body.hourlyLeaveUnitMinutes);
  const overtimePremiumRate = Number(body.overtimePremiumRate);
  const nightPremiumRate = Number(body.nightPremiumRate);
  const holidayPremiumRate = Number(body.holidayPremiumRate);
  const nightWorkStart = String(body.nightWorkStart ?? "").trim();
  const nightWorkEnd = String(body.nightWorkEnd ?? "").trim();

  if (
    !Number.isFinite(standardDailyHours) ||
    !Number.isFinite(overtimeThresholdHours) ||
    !Number.isFinite(weeklyLimitHours) ||
    !Number.isFinite(defaultBreakMinutes) ||
    !Number.isFinite(annualLeaveGrantDays) ||
    !Number.isFinite(annualLeaveCarryoverDays) ||
    !Number.isFinite(carryoverExpiryMonth) ||
    !Number.isFinite(carryoverExpiryDay) ||
    !Number.isFinite(hourlyLeaveUnitMinutes) ||
    !Number.isFinite(overtimePremiumRate) ||
    !Number.isFinite(nightPremiumRate) ||
    !Number.isFinite(holidayPremiumRate)
  ) {
    return jsonError("계산 정책 숫자 값을 확인하세요.");
  }

  if (
    carryoverExpiryMonth < 1 ||
    carryoverExpiryMonth > 12 ||
    carryoverExpiryDay < 1 ||
    carryoverExpiryDay > 31 ||
    hourlyLeaveUnitMinutes <= 0
  ) {
    return jsonError("이월 만료일 또는 시간차 단위를 확인하세요.");
  }

  if (!parseTimeValue(nightWorkStart) || !parseTimeValue(nightWorkEnd)) {
    return jsonError("야간근로 시작/종료 시간을 확인하세요.");
  }

  try {
    return NextResponse.json(
      await updateWorkPolicySettings(user, {
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
        allowHalfDayLeave: Boolean(body.allowHalfDayLeave),
        allowHourlyLeave: Boolean(body.allowHourlyLeave),
        hourlyLeaveUnitMinutes,
        overtimePremiumRate,
        nightPremiumRate,
        holidayPremiumRate,
        holidayIncludesWeekends: Boolean(body.holidayIncludesWeekends),
        nightWorkStart,
        nightWorkEnd
      })
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "계산 정책 저장에 실패했습니다.");
  }
}
