import {
  AnnualLeaveBasis,
  AdjustmentType,
  ApprovalStatus,
  ApprovalType,
  EventType,
  LeaveDuration,
  LeaveType,
  MonthCloseEventType,
  MonthCloseStatus,
  NotificationType,
  PayrollSyncStatus,
  PrismaClient,
  RiskLevel,
  RiskType,
  Role,
  WorkStatus
} from "../src/generated/prisma/index.js";
import { randomBytes, scryptSync } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const prisma = new PrismaClient();
const PASSWORD_KEY_LENGTH = 64;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

function hashPassword(password) {
  const salt = randomBytes(16);
  const derivedKey = scryptSync(password, salt, PASSWORD_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P
  });

  return [
    "scrypt",
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString("hex"),
    Buffer.from(derivedKey).toString("hex")
  ].join("$");
}

function dateOnly(dateString) {
  return new Date(`${dateString}T00:00:00.000Z`);
}

function kstDateString(offsetDays = 0) {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000 + offsetDays * 24 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function kstTime(dateString, hour, minute = 0) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - 9 * 60 * 60 * 1000);
}

function kstMonthString(offsetMonths = 0) {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  kst.setUTCMonth(kst.getUTCMonth() + offsetMonths);
  return kst.toISOString().slice(0, 7);
}

async function writeSeedAttachment({ companyId, requestId, uploaderId, filename, content, mimeType }) {
  const uploadRoot = path.join(process.cwd(), "data", "uploads", "approval-attachments");
  const requestDir = path.join(uploadRoot, companyId, requestId);
  await fs.mkdir(requestDir, { recursive: true });

  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const absolutePath = path.join(requestDir, safeFilename);
  const buffer = Buffer.from(content, "utf8");
  await fs.writeFile(absolutePath, buffer);

  return {
    companyId,
    approvalRequestId: requestId,
    uploadedById: uploaderId,
    originalName: filename,
    mimeType,
    sizeBytes: buffer.byteLength,
    storagePath: path.relative(uploadRoot, absolutePath).split(path.sep).join("/")
  };
}

async function main() {
  await prisma.authSession.deleteMany();
  await prisma.authLoginAttempt.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.notificationDispatchLog.deleteMany();
  await prisma.notificationPreference.deleteMany();
  await prisma.monthCloseEvent.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.monthClose.deleteMany();
  await prisma.companyHoliday.deleteMany();
  await prisma.riskSignal.deleteMany();
  await prisma.invitation.deleteMany();
  await prisma.requestAttachment.deleteMany();
  await prisma.approvalRequest.deleteMany();
  await prisma.workSchedule.deleteMany();
  await prisma.workSession.deleteMany();
  await prisma.attendanceEvent.deleteMany();
  await prisma.user.deleteMany();
  await prisma.team.deleteMany();
  await prisma.workPolicy.deleteMany();
  await prisma.company.deleteMany();

  const company = await prisma.company.create({
    data: {
      name: "감시랩스",
      timezone: "Asia/Seoul",
      weeklyLimitMinutes: 52 * 60,
      defaultBreakMinutes: 60
    }
  });

  await prisma.workPolicy.create({
    data: {
      companyId: company.id,
      name: "이전 계산 정책",
      version: 1,
      isActive: false,
      effectiveFrom: new Date("2025-01-01T00:00:00.000Z"),
      standardDailyMinutes: 8 * 60,
      weeklyLimitMinutes: 52 * 60,
      defaultBreakMinutes: 60,
      overtimeThresholdMinutes: 8 * 60,
      annualLeaveBasis: AnnualLeaveBasis.CALENDAR_YEAR,
      annualLeaveGrantDays: 15,
      firstYearMonthlyAccrualEnabled: true,
      annualLeaveCarryoverDays: 2,
      carryoverExpiryMonth: 3,
      carryoverExpiryDay: 31,
      allowHalfDayLeave: true,
      allowHourlyLeave: false,
      hourlyLeaveUnitMinutes: 60,
      overtimePremiumRate: 1.5,
      nightPremiumRate: 0.5,
      holidayPremiumRate: 1.5,
      holidayIncludesWeekends: true,
      nightWorkStart: "22:00",
      nightWorkEnd: "06:00"
    }
  });

  await prisma.workPolicy.create({
    data: {
      companyId: company.id,
      name: "현재 계산 정책",
      version: 2,
      isActive: true,
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      standardDailyMinutes: 8 * 60,
      weeklyLimitMinutes: 52 * 60,
      defaultBreakMinutes: 60,
      overtimeThresholdMinutes: 8 * 60,
      annualLeaveBasis: AnnualLeaveBasis.JOIN_DATE,
      annualLeaveGrantDays: 15,
      firstYearMonthlyAccrualEnabled: true,
      annualLeaveCarryoverDays: 3,
      carryoverExpiryMonth: 3,
      carryoverExpiryDay: 31,
      allowHalfDayLeave: true,
      allowHourlyLeave: true,
      hourlyLeaveUnitMinutes: 60,
      overtimePremiumRate: 1.5,
      nightPremiumRate: 0.5,
      holidayPremiumRate: 1.5,
      holidayIncludesWeekends: true,
      nightWorkStart: "22:00",
      nightWorkEnd: "06:00"
    }
  });

  const passwordHash = hashPassword("password123!");

  const admin = await prisma.user.create({
    data: {
      companyId: company.id,
      name: "관리자",
      email: "admin@gamsi.kr",
      passwordHash,
      role: Role.ADMIN,
      jobTitle: "대표 관리자",
      phoneNumber: "010-1000-0001",
      extensionNumber: "100",
      joinedAt: dateOnly("2024-01-01")
    }
  });

  const manager = await prisma.user.create({
    data: {
      companyId: company.id,
      name: "김팀장",
      email: "manager@gamsi.kr",
      passwordHash,
      role: Role.MANAGER,
      jobTitle: "프로덕트팀 팀장",
      phoneNumber: "010-1000-0002",
      extensionNumber: "210",
      joinedAt: dateOnly("2024-03-01")
    }
  });

  const hr = await prisma.user.create({
    data: {
      companyId: company.id,
      name: "박HR",
      email: "hr@gamsi.kr",
      passwordHash,
      role: Role.HR,
      jobTitle: "인사 운영 담당",
      phoneNumber: "010-1000-0003",
      extensionNumber: "300",
      joinedAt: dateOnly("2024-02-01")
    }
  });

  const productTeam = await prisma.team.create({
    data: {
      companyId: company.id,
      name: "프로덕트팀",
      managerUserId: manager.id,
      isActive: true
    }
  });

  await prisma.user.updateMany({
    where: {
      id: {
        in: [manager.id, hr.id]
      }
    },
    data: {
      teamId: productTeam.id
    }
  });

  const employee = await prisma.user.create({
    data: {
      companyId: company.id,
      teamId: productTeam.id,
      name: "이직원",
      email: "employee@gamsi.kr",
      passwordHash,
      role: Role.EMPLOYEE,
      jobTitle: "프론트엔드 엔지니어",
      phoneNumber: "010-1000-0004",
      extensionNumber: "221",
      joinedAt: dateOnly("2025-08-15")
    }
  });

  const fieldEmployee = await prisma.user.create({
    data: {
      companyId: company.id,
      teamId: productTeam.id,
      name: "최현장",
      email: "field@gamsi.kr",
      passwordHash,
      role: Role.EMPLOYEE,
      jobTitle: "현장 운영 담당",
      phoneNumber: "010-1000-0005",
      extensionNumber: "230",
      joinedAt: dateOnly("2026-01-10")
    }
  });

  const today = kstDateString(0);
  const yesterday = kstDateString(-1);
  const twoDaysAgo = kstDateString(-2);
  const threeDaysAgo = kstDateString(-3);
  const fourDaysAgo = kstDateString(-4);
  const fiveDaysAgo = kstDateString(-5);
  const tomorrow = kstDateString(1);
  const twoDaysLater = kstDateString(2);
  const threeDaysLater = kstDateString(3);
  const nextWeek = kstDateString(5);
  const nextWeekAfter = kstDateString(6);

  await prisma.companyHoliday.createMany({
    data: [
      {
        companyId: company.id,
        date: dateOnly("2026-05-05"),
        name: "어린이날",
        isPaidHoliday: true
      },
      {
        companyId: company.id,
        date: dateOnly("2026-06-06"),
        name: "현충일",
        isPaidHoliday: true
      }
    ]
  });

  await prisma.attendanceEvent.createMany({
    data: [
      {
        companyId: company.id,
        userId: employee.id,
        eventType: EventType.CHECK_IN,
        status: WorkStatus.WORKING,
        occurredAt: kstTime(today, 9, 15),
        reason: "웹 출근"
      },
      {
        companyId: company.id,
        userId: employee.id,
        eventType: EventType.STATUS_CHANGE,
        status: WorkStatus.MEETING,
        occurredAt: kstTime(today, 10, 30),
        reason: "스프린트 회의"
      },
      {
        companyId: company.id,
        userId: employee.id,
        eventType: EventType.STATUS_CHANGE,
        status: WorkStatus.BREAK,
        occurredAt: kstTime(today, 12, 30),
        reason: "점심"
      },
      {
        companyId: company.id,
        userId: employee.id,
        eventType: EventType.STATUS_CHANGE,
        status: WorkStatus.WORKING,
        occurredAt: kstTime(today, 13, 30),
        reason: "업무 복귀"
      },
      {
        companyId: company.id,
        userId: manager.id,
        eventType: EventType.CHECK_IN,
        status: WorkStatus.WORKING,
        occurredAt: kstTime(today, 8, 50),
        reason: "웹 출근"
      },
      {
        companyId: company.id,
        userId: fieldEmployee.id,
        eventType: EventType.CHECK_OUT,
        occurredAt: kstTime(today, 18, 2),
        reason: "현장 앱 동기화 지연으로 체크인 누락"
      }
    ]
  });

  await prisma.workSchedule.createMany({
    data: [
      {
        companyId: company.id,
        userId: employee.id,
        workDate: dateOnly(today),
        shiftName: "오피스 데이",
        scheduledStartAt: kstTime(today, 8, 0),
        scheduledEndAt: kstTime(today, 18, 0),
        breakMinutes: 60,
        note: "제품 리뷰"
      },
      {
        companyId: company.id,
        userId: employee.id,
        workDate: dateOnly(tomorrow),
        shiftName: "기본 근무",
        scheduledStartAt: kstTime(tomorrow, 9, 0),
        scheduledEndAt: kstTime(tomorrow, 18, 0),
        breakMinutes: 60,
        note: "주간 회의"
      },
      {
        companyId: company.id,
        userId: employee.id,
        workDate: dateOnly(twoDaysLater),
        shiftName: "재택 근무",
        scheduledStartAt: kstTime(twoDaysLater, 10, 0),
        scheduledEndAt: kstTime(twoDaysLater, 19, 0),
        breakMinutes: 60,
        note: "문서 작업"
      },
      {
        companyId: company.id,
        userId: manager.id,
        workDate: dateOnly(today),
        shiftName: "팀 운영",
        scheduledStartAt: kstTime(today, 9, 0),
        scheduledEndAt: kstTime(today, 18, 0),
        breakMinutes: 60,
        note: "1:1 면담"
      },
      {
        companyId: company.id,
        userId: manager.id,
        workDate: dateOnly(tomorrow),
        shiftName: "채용 인터뷰",
        scheduledStartAt: kstTime(tomorrow, 10, 0),
        scheduledEndAt: kstTime(tomorrow, 19, 0),
        breakMinutes: 60,
        note: "면접 진행"
      },
      {
        companyId: company.id,
        userId: fieldEmployee.id,
        workDate: dateOnly(today),
        shiftName: "현장 순회",
        scheduledStartAt: kstTime(today, 9, 0),
        scheduledEndAt: kstTime(today, 18, 0),
        breakMinutes: 60,
        note: "매장 점검"
      },
      {
        companyId: company.id,
        userId: fieldEmployee.id,
        workDate: dateOnly(tomorrow),
        shiftName: "현장 교육",
        scheduledStartAt: kstTime(tomorrow, 9, 30),
        scheduledEndAt: kstTime(tomorrow, 18, 30),
        breakMinutes: 60,
        note: "신규 매뉴얼 안내"
      },
      {
        companyId: company.id,
        userId: fieldEmployee.id,
        workDate: dateOnly(threeDaysLater),
        shiftName: "가맹점 지원",
        scheduledStartAt: kstTime(threeDaysLater, 9, 0),
        scheduledEndAt: kstTime(threeDaysLater, 18, 0),
        breakMinutes: 60,
        note: "현장 동행"
      }
    ]
  });

  const createdSessions = await Promise.all(
    [
      { date: yesterday, checkIn: 9, checkOut: 20, work: 10 * 60, overtime: 2 * 60, breakMinutes: 60 },
      { date: twoDaysAgo, checkIn: 9, checkOut: 21, work: 11 * 60, overtime: 3 * 60, breakMinutes: 40 },
      { date: threeDaysAgo, checkIn: 9, checkOut: 20, work: 10 * 60, overtime: 2 * 60, breakMinutes: 55 },
      { date: fourDaysAgo, checkIn: 9, checkOut: 19, work: 9 * 60, overtime: 60, breakMinutes: 60 },
      { date: fiveDaysAgo, checkIn: 9, checkOut: 18, work: 8 * 60, overtime: 0, breakMinutes: 60 }
    ].map((row) =>
      prisma.workSession.create({
        data: {
          companyId: company.id,
          userId: employee.id,
          workDate: dateOnly(row.date),
          checkInAt: kstTime(row.date, row.checkIn, 0),
          checkOutAt: kstTime(row.date, row.checkOut, 0),
          grossMinutes: (row.checkOut - row.checkIn) * 60,
          breakMinutes: row.breakMinutes,
          calculatedWorkMinutes: row.work,
          overtimeMinutes: row.overtime,
          status: "CLOSED"
        }
      })
    )
  );

  const overtimeRequest = await prisma.approvalRequest.create({
    data: {
      companyId: company.id,
      requesterId: employee.id,
      sessionId: createdSessions[0].id,
      type: ApprovalType.OVERTIME,
      requestedMinutes: 2 * 60,
      reason: "배포 전 회귀 테스트와 장애 대응 대기",
      status: "PENDING"
    }
  });

  const leaveRequest = await prisma.approvalRequest.create({
    data: {
      companyId: company.id,
      requesterId: employee.id,
      type: ApprovalType.LEAVE,
      leaveType: LeaveType.ANNUAL,
      leaveStartDate: dateOnly(nextWeek),
      leaveEndDate: dateOnly(nextWeekAfter),
      leaveDuration: LeaveDuration.FULL_DAY,
      reason: "가족 일정으로 연차를 사용합니다.",
      status: "PENDING"
    }
  });

  const leaveReminderRequest = await prisma.approvalRequest.create({
    data: {
      companyId: company.id,
      requesterId: employee.id,
      reviewerId: hr.id,
      type: ApprovalType.LEAVE,
      leaveType: LeaveType.ANNUAL,
      leaveStartDate: dateOnly(tomorrow),
      leaveEndDate: dateOnly(tomorrow),
      leaveDuration: LeaveDuration.HALF_DAY_PM,
      reason: "병원 방문 일정으로 오후 반차를 사용합니다.",
      status: ApprovalStatus.APPROVED,
      reviewedAt: kstTime(today, 17, 30),
      reviewNote: "인수인계 확인 후 승인"
    }
  });

  await prisma.approvalRequest.create({
    data: {
      companyId: company.id,
      requesterId: employee.id,
      reviewerId: hr.id,
      type: ApprovalType.LEAVE,
      leaveType: LeaveType.ANNUAL,
      leaveStartDate: dateOnly(twoDaysAgo),
      leaveEndDate: dateOnly(twoDaysAgo),
      leaveDuration: LeaveDuration.HOURLY,
      requestedLeaveMinutes: 120,
      reason: "오전 병원 예약으로 2시간 시간차를 사용합니다.",
      status: ApprovalStatus.APPROVED,
      reviewedAt: kstTime(twoDaysAgo, 8, 0),
      reviewNote: "시간차 승인"
    }
  });

  const adjustmentRequest = await prisma.approvalRequest.create({
    data: {
      companyId: company.id,
      requesterId: fieldEmployee.id,
      type: ApprovalType.ADJUSTMENT,
      adjustmentType: AdjustmentType.MISSING_CHECK_IN,
      targetDate: dateOnly(today),
      requestedAt: kstTime(today, 9, 2),
      reason: "현장 진입 직후 네트워크가 불안정해 출근 버튼이 누락되었습니다.",
      status: "PENDING"
    }
  });

  await prisma.requestAttachment.createMany({
    data: [
      await writeSeedAttachment({
        companyId: company.id,
        requestId: overtimeRequest.id,
        uploaderId: employee.id,
        filename: "overtime-log.txt",
        mimeType: "text/plain",
        content: "배포 로그 요약\n- 19:10 배포 시작\n- 19:45 장애 대응 완료\n- 20:05 검증 종료"
      }),
      await writeSeedAttachment({
        companyId: company.id,
        requestId: leaveRequest.id,
        uploaderId: employee.id,
        filename: "leave-handover.txt",
        mimeType: "text/plain",
        content: "휴가 인수인계\n- 고객 문의: 김팀장에게 전달\n- 배포 모니터링: 박HR 백업\n- 일정 공유 완료"
      }),
      await writeSeedAttachment({
        companyId: company.id,
        requestId: adjustmentRequest.id,
        uploaderId: fieldEmployee.id,
        filename: "field-checkin-note.txt",
        mimeType: "text/plain",
        content: "현장 출근 증빙\n- 09:01 매장 출입 기록\n- 09:02 메신저 업무 시작 보고\n- 네트워크 불안정으로 앱 동기화 실패"
      })
    ]
  });

  await prisma.notification.createMany({
    data: [
      {
        companyId: company.id,
        userId: manager.id,
        type: NotificationType.APPROVAL_PENDING,
        title: "승인 대기 요청 3건",
        message: "초과근로, 휴가, 근태 정정 요청이 접수되었습니다.",
        actionUrl: `/dashboard?approvalId=${overtimeRequest.id}#approvals`
      },
      {
        companyId: company.id,
        userId: hr.id,
        type: NotificationType.APPROVAL_PENDING,
        title: "휴가 요청 검토 필요",
        message: "이직원님의 연차 요청과 첨부 인수인계 파일을 확인하세요.",
        actionUrl: `/dashboard?approvalId=${leaveRequest.id}#approvals`
      },
      {
        companyId: company.id,
        userId: employee.id,
        type: NotificationType.SCHEDULE_UPDATED,
        title: "내일 스케줄이 확정되었습니다",
        message: `${tomorrow} 기본 근무 일정과 주간 회의 메모를 확인하세요.`,
        actionUrl: "/dashboard#employee"
      },
      {
        companyId: company.id,
        userId: employee.id,
        type: NotificationType.APPROVAL_APPROVED,
        title: "오후 반차가 승인되었습니다",
        message: `${leaveReminderRequest.reviewNote} · ${tomorrow} 오후 반차`,
        actionUrl: "/dashboard#employee"
      },
      {
        companyId: company.id,
        userId: employee.id,
        type: NotificationType.LEAVE_STARTING,
        title: "내일 오후 반차 시작",
        message: `${tomorrow} 오후 반차 일정이 예정되어 있습니다.`,
        actionUrl: "/dashboard#employee"
      }
    ]
  });

  await prisma.notificationPreference.createMany({
    data: [
      {
        companyId: company.id,
        userId: admin.id,
        emailEnabled: true,
        webPushEnabled: true,
        approvalPendingEmail: true,
        approvalReviewedEmail: true,
        leaveReminderEmail: true,
        missingRecordEmail: true,
        monthCloseEmail: true,
        schedulerDigestEnabled: true,
        browserPermission: "granted"
      },
      {
        companyId: company.id,
        userId: hr.id,
        emailEnabled: true,
        webPushEnabled: true,
        approvalPendingEmail: true,
        approvalReviewedEmail: true,
        leaveReminderEmail: true,
        missingRecordEmail: true,
        monthCloseEmail: true,
        schedulerDigestEnabled: true,
        browserPermission: "granted"
      },
      {
        companyId: company.id,
        userId: manager.id,
        emailEnabled: true,
        webPushEnabled: false,
        approvalPendingEmail: true,
        approvalReviewedEmail: true,
        leaveReminderEmail: false,
        missingRecordEmail: false,
        monthCloseEmail: true,
        schedulerDigestEnabled: true,
        browserPermission: "default"
      },
      {
        companyId: company.id,
        userId: employee.id,
        emailEnabled: true,
        webPushEnabled: true,
        approvalPendingEmail: false,
        approvalReviewedEmail: true,
        leaveReminderEmail: true,
        missingRecordEmail: true,
        monthCloseEmail: false,
        schedulerDigestEnabled: true,
        browserPermission: "granted"
      }
    ]
  });

  const previousMonthClose = await prisma.monthClose.create({
    data: {
      companyId: company.id,
      month: kstMonthString(-1),
      status: MonthCloseStatus.CLOSED,
      lockedAt: kstTime(today, 11, 0),
      lockedById: hr.id,
      payrollSyncStatus: PayrollSyncStatus.APPLIED,
      payrollAppliedAt: kstTime(today, 11, 15),
      payrollAppliedById: hr.id,
      summary: {
        blockingSummary: {
          pendingApprovals: 0,
          pendingLeaveApprovals: 0,
          pendingAdjustmentApprovals: 0,
          openSessions: 0,
          unresolvedOvertime: 0,
          missingRecordRisks: 0,
          scheduleMismatchSessions: 0,
          leaveBalanceDeficitUsers: 0
        }
      }
    }
  });

  await prisma.monthCloseEvent.createMany({
    data: [
      {
        monthCloseId: previousMonthClose.id,
        companyId: company.id,
        actorUserId: hr.id,
        type: MonthCloseEventType.CLOSED,
        detail: {
          summary: previousMonthClose.summary
        }
      },
      {
        monthCloseId: previousMonthClose.id,
        companyId: company.id,
        actorUserId: hr.id,
        type: MonthCloseEventType.PAYROLL_APPLIED,
        detail: {
          exportedRows: 2
        }
      }
    ]
  });

  await prisma.riskSignal.create({
    data: {
      companyId: company.id,
      userId: fieldEmployee.id,
      signature: `${fieldEmployee.id}|${RiskType.MISSING_CHECK_IN_OUT}||${today}|현장 순회|||||`,
      type: RiskType.MISSING_CHECK_IN_OUT,
      level: RiskLevel.HIGH,
      title: "출퇴근 누락 가능성",
      message: `${today} 현장 순회 일정에 대해 출근 기록 확인이 필요합니다.`,
      evidence: {
        workDate: today,
        shiftName: "현장 순회"
      }
    }
  });

  await prisma.auditLog.createMany({
    data: [
      {
        companyId: company.id,
        actorUserId: hr.id,
        action: "leave.balance.adjusted",
        targetType: "user",
        targetId: employee.id,
        payload: {
          effectiveDate: today,
          deltaDays: 1,
          reason: "회사 창립기념일 대체휴무 보정"
        }
      },
      {
        companyId: company.id,
        actorUserId: manager.id,
        action: "notifications.preferences.extended.saved",
        targetType: "notification_preference",
        targetId: manager.id,
        payload: {
          managerDailyDigestEnabled: true,
          approvalMuted: false,
          leaveMuted: false,
          missingRecordMuted: false,
          monthCloseMuted: false,
          dailyDigestMuted: false,
          approvalSnoozeUntil: null,
          leaveSnoozeUntil: null,
          missingRecordSnoozeUntil: null,
          monthCloseSnoozeUntil: null,
          dailyDigestSnoozeUntil: null
        }
      },
      {
        companyId: company.id,
        actorUserId: employee.id,
        action: "notifications.archive.saved",
        targetType: "notification_archive",
        targetId: employee.id,
        payload: {
          count: 1,
          items: [
            {
              id: "seed-archived-leave",
              type: NotificationType.LEAVE_STARTING,
              title: "지난 휴가 시작 알림",
              message: "지난주 승인 휴가 알림이 보관되었습니다.",
              actionUrl: "/dashboard#notifications",
              isRead: true,
              createdAt: `${threeDaysAgo}T00:00:00.000Z`,
              archivedAt: `${today}T00:00:00.000Z`
            }
          ]
        }
      },
      {
        companyId: company.id,
        actorUserId: manager.id,
        action: "dashboard.personalization.saved",
        targetType: "dashboard_personalization",
        targetId: manager.id,
        payload: {
          defaultApprovalFilters: {
            type: "ADJUSTMENT",
            teamId: productTeam.id,
            from: threeDaysAgo,
            to: today
          },
          defaultApprovalFilterName: "현장 정정 집중",
          savedApprovalViews: [
            {
              id: "seed-adjustments",
              name: "정정 우선 처리",
              filters: {
                type: "ADJUSTMENT",
                teamId: productTeam.id,
                from: twoDaysAgo,
                to: today
              }
            },
            {
              id: "seed-leaves",
              name: "휴가 검토",
              filters: {
                type: "LEAVE",
                teamId: "",
                from: today,
                to: nextWeekAfter
              }
            }
          ],
          showMyAssignedRisks: true,
          showTodayApprovals: true,
          showWeekBlockers: true,
          compactRiskView: true
        }
      },
      {
        companyId: company.id,
        actorUserId: admin.id,
        action: "integrations.settings.saved",
        targetType: "integration_settings",
        targetId: company.id,
        payload: {
          payrollDelimiter: ",",
          payrollHeaders: {
            employeeName: "name",
            employeeEmail: "email",
            regularMinutes: "regular_minutes",
            overtimeMinutes: "overtime_minutes",
            approvedOvertimeMinutes: "approved_overtime_minutes",
            annualLeaveRemainingDays: "annual_leave_remaining_days",
            closeStatus: "close_status"
          },
          calendarDefaultScope: "COMPANY",
          calendarIncludeSchedules: true,
          calendarIncludeLeaves: true,
          slackDigestEnabled: true,
          slackWebhookUrl: "https://hooks.slack.example/services/demo",
          emailDigestRecipients: "ops@gamsi.kr, hr@gamsi.kr",
          erpAdapter: "DOUZONE",
          erpExportFormat: "CSV"
        }
      }
    ]
  });

  await prisma.auditLog.create({
    data: {
      companyId: company.id,
      actorUserId: admin.id,
      action: "seed.created",
      targetType: "company",
      targetId: company.id,
      payload: {
        demoAccounts: [
          "admin@gamsi.kr",
          "hr@gamsi.kr",
          "manager@gamsi.kr",
          "employee@gamsi.kr",
          "field@gamsi.kr"
        ]
      }
    }
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
