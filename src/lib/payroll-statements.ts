import fs from "node:fs";

import PDFDocument from "pdfkit";

import { type User } from "@/generated/prisma";

import { canViewReports } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { getPayrollReport } from "@/lib/payroll";
import { prisma } from "@/lib/prisma";
import { formatKstDateTime, formatMinutes } from "@/lib/time";

type Actor = Pick<User, "id" | "companyId" | "role">;

const MONTH_PATTERN = /^\d{4}-\d{2}$/;

function findKoreanFont() {
  const candidates = [
    "/mnt/c/Windows/Fonts/NotoSansKR-VF.ttf",
    "/mnt/c/Windows/Fonts/malgun.ttf",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
  ];

  return candidates.find((path) => fs.existsSync(path)) ?? null;
}

function csvLine(values: string[]) {
  return values.map((value) => `"${value.replaceAll('"', '""')}"`).join(",");
}

export async function getPayrollStatement(actor: Actor, input: {
  month: string;
  userId?: string | null;
  bypassIssueCheck?: boolean;
}) {
  if (!MONTH_PATTERN.test(input.month)) {
    throw new Error("급여명세 월을 확인하세요.");
  }

  const targetUserId = canViewReports(actor.role) && input.userId ? input.userId : actor.id;
  if (!input.bypassIssueCheck && !canViewReports(actor.role)) {
    const issue = await prisma.payrollStatementIssue.findUnique({
      where: {
        companyId_userId_month: {
          companyId: actor.companyId,
          userId: targetUserId,
          month: input.month
        }
      }
    });
    if (!issue || (issue.status !== "PUBLISHED" && issue.status !== "LOCKED")) {
      throw new Error("아직 발행된 급여명세가 없습니다.");
    }
  }

  const report = await getPayrollReport({
    id: actor.id,
    companyId: actor.companyId,
    role: "HR"
  }, input.month);
  const row = report.payrollRows.find((item) => item.user.id === targetUserId);
  if (!row) {
    throw new Error("급여명세 대상 직원을 찾을 수 없습니다.");
  }
  const company = await prisma.company.findUniqueOrThrow({
    where: {
      id: actor.companyId
    }
  });

  return {
    company,
    generatedAt: new Date(),
    month: report.month,
    policy: report.policy,
    monthClose: report.monthClose,
    row
  };
}

export function payrollStatementToCsv(statement: Awaited<ReturnType<typeof getPayrollStatement>>) {
  const row = statement.row;
  const lines = [
    csvLine(["급여명세 기초자료"]),
    csvLine(["회사", statement.company.name]),
    csvLine(["대상월", statement.month]),
    csvLine(["직원", row.user.name]),
    csvLine(["이메일", row.user.email]),
    csvLine(["부서", row.user.team?.name ?? "소속 없음"]),
    csvLine(["정책", `${statement.policy.name} v${statement.policy.version}`]),
    csvLine(["월마감", statement.monthClose?.status ?? "OPEN"]),
    csvLine([]),
    csvLine(["항목", "값"]),
    csvLine(["인정 근로시간", formatMinutes(row.calculatedWorkMinutes)]),
    csvLine(["승인 연장근로", formatMinutes(row.approvedOvertimeMinutes)]),
    csvLine(["야간근로", formatMinutes(row.nightWorkMinutes)]),
    csvLine(["휴일근로", formatMinutes(row.holidayWorkMinutes)]),
    csvLine(["연장 가산 환산", formatMinutes(row.additionalOvertimePremiumMinutes)]),
    csvLine(["야간 가산 환산", formatMinutes(row.additionalNightPremiumMinutes)]),
    csvLine(["휴일 가산 환산", formatMinutes(row.additionalHolidayPremiumMinutes)]),
    csvLine(["급여 환산 합계", formatMinutes(row.payableEquivalentMinutes)]),
    csvLine(["연차 사용", `${row.annualLeaveUsedThisMonth}일`]),
    csvLine(["연차 잔여", `${row.annualLeaveRemainingDays}일`]),
    csvLine(["확인 필요", row.closeStatus])
  ];

  return `\uFEFF${lines.join("\n")}\n`;
}

export async function renderPayrollStatementPdf(statement: Awaited<ReturnType<typeof getPayrollStatement>>) {
  const doc = new PDFDocument({
    size: "A4",
    margin: 42,
    bufferPages: true,
    info: {
      Title: "급여명세 기초자료",
      Author: "WorkGuard"
    }
  });
  const fontPath = findKoreanFont();
  if (fontPath) {
    doc.registerFont("WorkGuardKR", fontPath);
    doc.font("WorkGuardKR");
  }

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));

  const row = statement.row;
  doc.rect(0, 0, doc.page.width, 104).fill("#1E3A8A");
  doc.fillColor("#FFFFFF").fontSize(22).text("급여명세 기초자료", 42, 34);
  doc.fillColor("#DBEAFE").fontSize(10).text(`${statement.month} · ${statement.company.name}`, 42, 66);
  doc.y = 132;

  const infoRows: Array<[string, string]> = [
    ["직원", `${row.user.name} / ${row.user.email}`],
    ["부서", row.user.team?.name ?? "소속 없음"],
    ["정책", `${statement.policy.name} v${statement.policy.version}`],
    ["월마감", statement.monthClose?.status ?? "OPEN"],
    ["생성일시", formatKstDateTime(statement.generatedAt)]
  ];
  for (const [label, value] of infoRows) {
    const y = doc.y;
    doc.rect(42, y, 110, 28).fill("#F9FAFB").stroke("#E5E7EB");
    doc.rect(152, y, 401, 28).stroke("#E5E7EB");
    doc.fillColor("#374151").fontSize(9).text(label, 50, y + 9, { width: 94 });
    doc.fillColor("#111827").fontSize(9).text(value, 162, y + 9, { width: 381 });
    doc.y = y + 28;
  }

  doc.moveDown(1.2);
  doc.fillColor("#1E3A8A").fontSize(14).text("근로 및 급여 환산");
  doc.moveDown(0.6);
  const metricRows: Array<[string, string]> = [
    ["인정 근로시간", formatMinutes(row.calculatedWorkMinutes)],
    ["승인 연장근로", formatMinutes(row.approvedOvertimeMinutes)],
    ["야간근로", formatMinutes(row.nightWorkMinutes)],
    ["휴일근로", formatMinutes(row.holidayWorkMinutes)],
    ["연장 가산 환산", formatMinutes(row.additionalOvertimePremiumMinutes)],
    ["야간 가산 환산", formatMinutes(row.additionalNightPremiumMinutes)],
    ["휴일 가산 환산", formatMinutes(row.additionalHolidayPremiumMinutes)],
    ["급여 환산 합계", formatMinutes(row.payableEquivalentMinutes)],
    ["연차 사용", `${row.annualLeaveUsedThisMonth}일`],
    ["연차 잔여", `${row.annualLeaveRemainingDays}일`],
    ["확인 필요", row.closeStatus]
  ];
  for (const [label, value] of metricRows) {
    const y = doc.y;
    doc.rect(42, y, 255, 28).stroke("#E5E7EB");
    doc.rect(297, y, 256, 28).stroke("#E5E7EB");
    doc.fillColor("#374151").fontSize(9).text(label, 52, y + 9, { width: 235 });
    doc.fillColor("#111827").fontSize(9).text(value, 307, y + 9, { width: 236 });
    doc.y = y + 28;
  }

  doc.moveDown(1);
  doc.fillColor("#6B7280").fontSize(8).text("임금 단가와 공제 항목은 외부 급여 시스템 또는 회사 정책 입력 후 확정 명세로 발행합니다.", 42, doc.y, {
    width: 511
  });

  doc.end();
  await new Promise<void>((resolve) => doc.on("end", resolve));
  return Buffer.concat(chunks);
}

export async function auditPayrollStatementDownload(actor: Actor, statement: Awaited<ReturnType<typeof getPayrollStatement>>, format: string) {
  await writeAuditLog({
    companyId: actor.companyId,
    actorUserId: actor.id,
    action: "payroll_statement.downloaded",
    targetType: "user",
    targetId: statement.row.user.id,
    payload: {
      month: statement.month,
      format
    }
  });
}
