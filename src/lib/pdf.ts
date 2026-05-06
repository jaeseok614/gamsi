import fs from "node:fs";

import PDFDocument from "pdfkit";

import type { EvidencePackageData } from "@/lib/evidence-package";
import type { getDocumentRequestForActor } from "@/lib/groupware";
import type { getLaborRiskReport } from "@/lib/risks";
import { formatKstDateTime, formatMinutes } from "@/lib/time";
import { formatFileSize } from "@/lib/uploads";

type LaborRiskReport = Awaited<ReturnType<typeof getLaborRiskReport>>;
type GroupwareDocument = Awaited<ReturnType<typeof getDocumentRequestForActor>>;

const PAGE = {
  left: 42,
  right: 553,
  width: 511,
  bottom: 770
};

function findKoreanFont() {
  const candidates = [
    "/mnt/c/Windows/Fonts/NotoSansKR-VF.ttf",
    "/mnt/c/Windows/Fonts/malgun.ttf",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
  ];

  return candidates.find((path) => fs.existsSync(path)) ?? null;
}

function ensureSpace(doc: PDFKit.PDFDocument, height: number) {
  if (doc.y + height > PAGE.bottom) {
    doc.addPage();
  }
}

function sectionTitle(doc: PDFKit.PDFDocument, title: string, subtitle?: string) {
  ensureSpace(doc, 54);
  doc.moveDown(0.6);
  doc.fillColor("#1E3A8A").fontSize(14).text(title, PAGE.left, doc.y);
  if (subtitle) {
    doc.moveDown(0.25);
    doc.fillColor("#6B7280").fontSize(9).text(subtitle, PAGE.left, doc.y, { width: PAGE.width });
  }
  doc.moveDown(0.6);
}

function tableHeader(doc: PDFKit.PDFDocument, columns: string[], widths: number[]) {
  ensureSpace(doc, 30);
  const y = doc.y;
  doc.rect(PAGE.left, y, PAGE.width, 24).fill("#EEF2FF");
  doc.fillColor("#1E3A8A").fontSize(8);
  let x = PAGE.left + 6;
  columns.forEach((column, index) => {
    doc.text(column, x, y + 8, { width: widths[index] - 8, height: 12 });
    x += widths[index];
  });
  doc.y = y + 24;
}

function tableRow(doc: PDFKit.PDFDocument, cells: string[], widths: number[], options?: { fill?: string }) {
  ensureSpace(doc, 34);
  const y = doc.y;
  if (options?.fill) {
    doc.rect(PAGE.left, y, PAGE.width, 32).fill(options.fill);
  }
  doc.rect(PAGE.left, y, PAGE.width, 32).stroke("#E5E7EB");
  doc.fillColor("#111827").fontSize(8);
  let x = PAGE.left + 6;
  cells.forEach((cell, index) => {
    doc.text(cell, x, y + 7, {
      width: widths[index] - 8,
      height: 18,
      ellipsis: true
    });
    x += widths[index];
  });
  doc.y = y + 32;
}

function infoGrid(doc: PDFKit.PDFDocument, rows: Array<[string, string]>) {
  ensureSpace(doc, rows.length * 30 + 16);
  for (const [label, value] of rows) {
    const y = doc.y;
    doc.rect(PAGE.left, y, 116, 28).fill("#F9FAFB").stroke("#E5E7EB");
    doc.rect(PAGE.left + 116, y, PAGE.width - 116, 28).stroke("#E5E7EB");
    doc.fillColor("#374151").fontSize(8).text(label, PAGE.left + 8, y + 9, { width: 100 });
    doc.fillColor("#111827").fontSize(9).text(value, PAGE.left + 126, y + 8, { width: PAGE.width - 136 });
    doc.y = y + 28;
  }
}

function summaryBox(doc: PDFKit.PDFDocument, label: string, value: string, x: number, y: number, color: string) {
  doc.roundedRect(x, y, 120, 58, 4).stroke("#D1D5DB");
  doc.fillColor(color).fontSize(17).text(value, x + 12, y + 12, { width: 96 });
  doc.fillColor("#4B5563").fontSize(8).text(label, x + 12, y + 37, { width: 96 });
}

function documentId(date: Date) {
  return `WG-${date.toISOString().slice(0, 10).replaceAll("-", "")}-${date.getTime().toString().slice(-5)}`;
}

function approvalTypeLabel(type: string) {
  if (type === "LEAVE") {
    return "휴가";
  }
  if (type === "ADJUSTMENT") {
    return "근태 정정";
  }
  return "초과근로";
}

function leaveTypeLabel(type?: string | null) {
  return {
    ANNUAL: "연차",
    SICK: "병가",
    OFFICIAL: "공가",
    UNPAID: "무급"
  }[type ?? ""] ?? "휴가";
}

function leaveDurationLabel(duration?: string | null) {
  return {
    FULL_DAY: "종일",
    HALF_DAY_AM: "오전 반차",
    HALF_DAY_PM: "오후 반차",
    HOURLY: "시간차"
  }[duration ?? ""] ?? "종일";
}

function adjustmentTypeLabel(type?: string | null) {
  return {
    GENERAL: "일반",
    MISSING_CHECK_IN: "출근 누락",
    MISSING_CHECK_OUT: "퇴근 누락"
  }[type ?? ""] ?? "정정";
}

function approvalDetailText(request: LaborRiskReport["approvalRequests"][number]) {
  if (request.type === "LEAVE") {
    const hourlyText =
      request.leaveDuration === "HOURLY" && request.requestedLeaveMinutes
        ? ` / ${formatMinutes(request.requestedLeaveMinutes)}`
        : "";
    return `${leaveTypeLabel(request.leaveType)} ${request.leaveStartDate?.toISOString().slice(0, 10) ?? "-"} ~ ${request.leaveEndDate?.toISOString().slice(0, 10) ?? "-"} (${leaveDurationLabel(request.leaveDuration)}${hourlyText})`;
  }

  if (request.type === "ADJUSTMENT") {
    return `${adjustmentTypeLabel(request.adjustmentType)} / ${request.targetDate?.toISOString().slice(0, 10) ?? "-"} / ${request.requestedAt ? formatKstDateTime(request.requestedAt) : "-"}`;
  }

  return request.requestedMinutes ? formatMinutes(request.requestedMinutes) : "-";
}

export async function renderLaborRiskPdf(report: LaborRiskReport) {
  const doc = new PDFDocument({
    size: "A4",
    margin: 42,
    bufferPages: true,
    info: {
      Title: "근로시간 및 초과근로 리스크 점검 자료",
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

  const highRiskCount = report.signals.filter((signal) => signal.level === "HIGH" || signal.level === "CRITICAL").length;
  const pendingApprovals = report.approvalRequests.filter((request) => request.status === "PENDING").length;
  const totalWorkMinutes = report.sessions.reduce((sum, session) => sum + session.calculatedWorkMinutes, 0);
  const totalOvertimeMinutes = report.sessions.reduce((sum, session) => sum + session.overtimeMinutes, 0);
  const approvedOvertimeMinutes = report.sessions.reduce((sum, session) => sum + session.approvedOvertimeMinutes, 0);

  doc.rect(0, 0, doc.page.width, 112).fill("#1E3A8A");
  doc.fillColor("#FFFFFF").fontSize(22).text("근로시간 및 초과근로 리스크 점검 자료", PAGE.left, 36);
  doc.fillColor("#DBEAFE").fontSize(10).text("노동청 점검·분쟁 대응 참고자료", PAGE.left, 67);
  doc.fillColor("#FFFFFF").fontSize(9).text(`문서번호: ${documentId(report.generatedAt)}`, PAGE.left, 88);

  doc.y = 138;
  sectionTitle(doc, "1. 사업장 및 문서 정보");
  infoGrid(doc, [
    ["사업장명", report.company.name],
    ["대상 기간", `${report.period.month} (${report.period.start.toISOString().slice(0, 10)} ~ ${report.period.end.toISOString().slice(0, 10)})`],
    ["생성일시", formatKstDateTime(report.generatedAt)],
    ["주간 기준", `주 ${formatMinutes(report.company.weeklyLimitMinutes)} / 기본 휴게 ${report.company.defaultBreakMinutes}분`],
    ["자료 성격", "시스템 기록 기반 점검 대응 참고자료"]
  ]);

  sectionTitle(doc, "2. 요약 지표", "초과근로 승인, 증빙 부족, 반복 야근 등 노무 리스크를 한눈에 확인합니다.");
  const y = doc.y;
  summaryBox(doc, "활성 리스크", `${report.signals.length}건`, PAGE.left, y, "#1E3A8A");
  summaryBox(doc, "위험 이상", `${highRiskCount}건`, PAGE.left + 130, y, "#EF4444");
  summaryBox(doc, "승인 대기", `${pendingApprovals}건`, PAGE.left + 260, y, "#F59E0B");
  summaryBox(doc, "월 초과근로", formatMinutes(totalOvertimeMinutes), PAGE.left + 390, y, "#111827");
  doc.y = y + 76;

  sectionTitle(doc, "3. 근로시간 집계", "월별 근로시간, 초과근로, 승인 초과근로를 직원별로 집계합니다.");
  tableHeader(doc, ["일자", "직원", "부서", "인정근로", "초과", "승인초과", "상태"], [68, 74, 76, 72, 58, 72, 91]);
  for (const session of report.sessions.slice(0, 24)) {
    tableRow(doc, [
      session.workDate.toISOString().slice(0, 10),
      session.user.name,
      session.user.team?.name ?? "-",
      formatMinutes(session.calculatedWorkMinutes),
      formatMinutes(session.overtimeMinutes),
      formatMinutes(session.approvedOvertimeMinutes),
      session.status
    ], [68, 74, 76, 72, 58, 72, 91]);
  }
  if (report.sessions.length === 0) {
    tableRow(doc, ["대상 기간 근로시간 기록 없음", "", "", "", "", "", ""], [68, 74, 76, 72, 58, 72, 91]);
  }
  tableRow(doc, ["합계", "", "", formatMinutes(totalWorkMinutes), formatMinutes(totalOvertimeMinutes), formatMinutes(approvedOvertimeMinutes), ""], [68, 74, 76, 72, 58, 72, 91], {
    fill: "#F9FAFB"
  });

  doc.addPage();
  sectionTitle(doc, "4. 노무 리스크 상세", "리스크 수준, 유형, 대상자, 근거 문구를 정리합니다.");
  tableHeader(doc, ["수준", "유형", "대상", "근무일", "점검 내용"], [52, 92, 84, 68, 215]);
  for (const signal of report.signals.slice(0, 28)) {
    tableRow(doc, [
      signal.level,
      signal.type,
      `${signal.user.name} / ${signal.user.team?.name ?? "-"}`,
      signal.session?.workDate.toISOString().slice(0, 10) ?? "-",
      `${signal.title}: ${signal.message}`
    ], [52, 92, 84, 68, 215]);
  }
  if (report.signals.length === 0) {
    tableRow(doc, ["-", "-", "-", "-", "현재 활성 리스크가 없습니다."], [52, 92, 84, 68, 215]);
  }

  sectionTitle(doc, "5. 승인 및 정정 이력", "휴가, 누락 수정, 초과근로 요청과 첨부 증빙을 함께 보관합니다.");
  tableHeader(doc, ["요청일", "요청자", "유형", "상세", "상태", "첨부"], [74, 70, 54, 160, 52, 101]);
  for (const request of report.approvalRequests.slice(0, 18)) {
    tableRow(doc, [
      formatKstDateTime(request.createdAt),
      request.requester.name,
      approvalTypeLabel(request.type),
      approvalDetailText(request),
      request.status,
      request.attachments.length > 0 ? `${request.attachments.length}개 / ${request.attachments.map((attachment) => attachment.originalName).join(", ")}` : "-"
    ], [74, 70, 54, 160, 52, 101]);
  }
  if (report.approvalRequests.length === 0) {
    tableRow(doc, ["-", "-", "-", "-", "-", "대상 기간 승인 요청이 없습니다."], [74, 70, 54, 160, 52, 101]);
  }

  sectionTitle(doc, "6. 스케줄 대비 실제 근무 이탈", "스케줄과 실제 출퇴근 시각 차이를 검토합니다.");
  tableHeader(doc, ["일자", "직원", "근무명", "스케줄", "실제", "차이"], [68, 74, 88, 92, 92, 97]);
  for (const row of report.scheduleVarianceRows.slice(0, 16)) {
    tableRow(doc, [
      row.workDate.toISOString().slice(0, 10),
      row.user.name,
      row.schedule.shiftName,
      `${formatKstDateTime(row.schedule.scheduledStartAt)} / ${formatKstDateTime(row.schedule.scheduledEndAt)}`,
      `${row.checkInAt ? formatKstDateTime(row.checkInAt) : "-"} / ${row.checkOutAt ? formatKstDateTime(row.checkOutAt) : "-"}`,
      formatMinutes(row.scheduleMismatchMinutes)
    ], [68, 74, 88, 92, 92, 97]);
  }
  if (report.scheduleVarianceRows.length === 0) {
    tableRow(doc, ["-", "-", "-", "-", "-", "스케줄 이탈 내역이 없습니다."], [68, 74, 88, 92, 92, 97]);
  }

  sectionTitle(doc, "7. 휴게 부족 가능성", "총 체류시간 대비 휴게 기록이 부족한 세션을 점검합니다.");
  tableHeader(doc, ["일자", "직원", "부서", "총 체류", "기록 휴게", "기준 휴게"], [74, 76, 86, 86, 86, 103]);
  for (const row of report.breakRiskRows.slice(0, 16)) {
    tableRow(doc, [
      row.workDate.toISOString().slice(0, 10),
      row.user.name,
      row.user.team?.name ?? "-",
      formatMinutes(row.grossMinutes),
      `${row.breakMinutes}분`,
      `${row.requiredBreakMinutes}분`
    ], [74, 76, 86, 86, 86, 103]);
  }
  if (report.breakRiskRows.length === 0) {
    tableRow(doc, ["-", "-", "-", "-", "-", "휴게 부족 가능성이 없습니다."], [74, 76, 86, 86, 86, 103]);
  }

  sectionTitle(doc, "8. 수정 및 감사 로그", "누가 언제 어떤 기록을 생성·수정·승인했는지 확인합니다.");
  tableHeader(doc, ["시간", "수행자", "액션", "대상"], [94, 76, 180, 161]);
  for (const log of report.auditLogs.slice(0, 18)) {
    tableRow(doc, [
      formatKstDateTime(log.createdAt),
      log.actor?.name ?? "시스템",
      log.action,
      log.targetType
    ], [94, 76, 180, 161]);
  }

  sectionTitle(doc, "9. 확인란");
  ensureSpace(doc, 84);
  const signY = doc.y;
  doc.rect(PAGE.left, signY, PAGE.width, 74).stroke("#D1D5DB");
  doc.fillColor("#374151").fontSize(9).text("본 자료는 워크가드 시스템에 기록된 근로시간, 승인 이력, 수정 로그를 바탕으로 자동 생성되었습니다.", PAGE.left + 12, signY + 12, {
    width: PAGE.width - 24
  });
  doc.fillColor("#111827").fontSize(10).text("확인자: ____________________", PAGE.left + 12, signY + 44);
  doc.text("확인일: ____________________", PAGE.left + 300, signY + 44);

  const pageRange = doc.bufferedPageRange();
  for (let i = pageRange.start; i < pageRange.start + pageRange.count; i += 1) {
    doc.switchToPage(i);
    doc.fillColor("#9CA3AF").fontSize(8).text(`WorkGuard · ${i + 1} / ${pageRange.count}`, PAGE.left, 812, {
      align: "center",
      width: PAGE.width
    });
  }

  const output = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.end();

  return output;
}

export async function renderEvidencePackagePdf(data: EvidencePackageData) {
  const doc = new PDFDocument({
    size: "A4",
    margin: 42,
    bufferPages: true,
    info: {
      Title: "직원별 근태 증빙 패키지",
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

  const totalWorkMinutes = data.sessions.reduce((sum, session) => sum + session.calculatedWorkMinutes, 0);
  const totalOvertimeMinutes = data.sessions.reduce((sum, session) => sum + session.overtimeMinutes, 0);
  const attachmentCount = data.approvalRequests.reduce((sum, request) => sum + request.attachments.length, 0);
  const resolvedRisks = data.riskSignals.filter((signal) => signal.resolvedAt).length;

  doc.rect(0, 0, doc.page.width, 112).fill("#111827");
  doc.fillColor("#FFFFFF").fontSize(22).text("직원별 근태 증빙 패키지", PAGE.left, 34);
  doc.fillColor("#D1D5DB").fontSize(10).text("노동청 제출·분쟁 대응용 요약본", PAGE.left, 66);
  doc.fillColor("#FFFFFF").fontSize(9).text(`문서번호: ${documentId(data.generatedAt)}`, PAGE.left, 88);

  doc.y = 138;
  sectionTitle(doc, "1. 기본 정보");
  infoGrid(doc, [
    ["회사", data.company.name],
    ["직원", `${data.user.name} / ${data.user.email}`],
    ["팀", data.user.team?.name ?? "소속 없음"],
    ["대상 월", data.month],
    ["생성일시", formatKstDateTime(data.generatedAt)]
  ]);

  sectionTitle(doc, "2. 요약 지표");
  const y = doc.y;
  summaryBox(doc, "근태 이벤트", `${data.attendanceEvents.length}건`, PAGE.left, y, "#1E3A8A");
  summaryBox(doc, "인정 근로", formatMinutes(totalWorkMinutes), PAGE.left + 130, y, "#111827");
  summaryBox(doc, "초과근로", formatMinutes(totalOvertimeMinutes), PAGE.left + 260, y, "#F59E0B");
  summaryBox(doc, "첨부 증빙", `${attachmentCount}개`, PAGE.left + 390, y, "#166534");
  doc.y = y + 76;

  sectionTitle(doc, "3. 일자별 근태", "출근, 퇴근, 인정 근로시간, 초과근로를 일자별로 정리합니다.");
  tableHeader(doc, ["일자", "출근", "퇴근", "총 체류", "휴게", "인정", "상태"], [72, 78, 78, 70, 58, 70, 85]);
  for (const session of data.sessions.slice(0, 24)) {
    tableRow(doc, [
      session.workDate.toISOString().slice(0, 10),
      session.checkInAt ? formatKstDateTime(session.checkInAt) : "-",
      session.checkOutAt ? formatKstDateTime(session.checkOutAt) : "-",
      formatMinutes(session.grossMinutes),
      `${session.breakMinutes}분`,
      formatMinutes(session.calculatedWorkMinutes),
      session.status
    ], [72, 78, 78, 70, 58, 70, 85]);
  }
  if (data.sessions.length === 0) {
    tableRow(doc, ["대상 월 근무 세션이 없습니다.", "", "", "", "", "", ""], [72, 78, 78, 70, 58, 70, 85]);
  }

  sectionTitle(doc, "4. 출퇴근 이벤트와 현장 인증", "QR 등 현장 인증 metadata가 있으면 함께 표시합니다.");
  tableHeader(doc, ["시각", "구분", "상태", "소스", "검증", "사유"], [98, 58, 62, 62, 94, 137]);
  for (const event of data.attendanceEvents.slice(0, 24)) {
    const metadata = event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
      ? (event.metadata as Record<string, unknown>)
      : {};
    const verification =
      metadata.verificationMethod === "qr"
        ? `QR / ${typeof metadata.locationName === "string" ? metadata.locationName : "-"}`
        : "-";
    tableRow(doc, [
      formatKstDateTime(event.occurredAt),
      event.eventType,
      event.status ?? "-",
      event.source,
      verification,
      event.reason ?? "-"
    ], [98, 58, 62, 62, 94, 137]);
  }
  if (data.attendanceEvents.length === 0) {
    tableRow(doc, ["출퇴근 이벤트가 없습니다.", "", "", "", "", ""], [98, 58, 62, 62, 94, 137]);
  }

  doc.addPage();
  sectionTitle(doc, "5. 승인·정정·휴가 이력");
  tableHeader(doc, ["요청일", "유형", "상태", "검토자", "검토일", "첨부", "사유"], [82, 58, 52, 66, 78, 46, 129]);
  for (const request of data.approvalRequests.slice(0, 22)) {
    tableRow(doc, [
      formatKstDateTime(request.createdAt),
      approvalTypeLabel(request.type),
      request.status,
      request.reviewer?.name ?? "-",
      request.reviewedAt ? formatKstDateTime(request.reviewedAt) : "-",
      `${request.attachments.length}개`,
      request.reason
    ], [82, 58, 52, 66, 78, 46, 129]);
  }
  if (data.approvalRequests.length === 0) {
    tableRow(doc, ["승인·정정·휴가 이력이 없습니다.", "", "", "", "", "", ""], [82, 58, 52, 66, 78, 46, 129]);
  }

  sectionTitle(doc, "6. 리스크 및 해결 이력", `해결 완료 ${resolvedRisks}건 / 전체 ${data.riskSignals.length}건`);
  tableHeader(doc, ["발생", "수준", "유형", "상태", "제목", "해결 메모"], [82, 48, 80, 68, 118, 115]);
  for (const signal of data.riskSignals.slice(0, 20)) {
    tableRow(doc, [
      formatKstDateTime(signal.detectedAt),
      signal.level,
      signal.type,
      signal.status,
      signal.title,
      signal.resolutionNote ?? "-"
    ], [82, 48, 80, 68, 118, 115]);
  }
  if (data.riskSignals.length === 0) {
    tableRow(doc, ["리스크 이력이 없습니다.", "", "", "", "", ""], [82, 48, 80, 68, 118, 115]);
  }

  sectionTitle(doc, "7. 월마감 및 감사 로그");
  infoGrid(doc, [
    ["월마감 상태", data.monthClose?.status ?? "미마감"],
    ["마감 시각", data.monthClose?.lockedAt ? formatKstDateTime(data.monthClose.lockedAt) : "-"],
    ["마감자", data.monthClose?.lockedBy?.name ?? "-"],
    ["재오픈", data.monthClose?.reopenReason ?? "-"]
  ]);
  tableHeader(doc, ["시각", "수행자", "액션", "대상"], [96, 76, 184, 155]);
  for (const log of data.auditLogs.slice(0, 14)) {
    tableRow(doc, [
      formatKstDateTime(log.createdAt),
      log.actor?.name ?? "시스템",
      log.action,
      log.targetType
    ], [96, 76, 184, 155]);
  }

  sectionTitle(doc, "8. 확인란");
  ensureSpace(doc, 74);
  const signY = doc.y;
  doc.rect(PAGE.left, signY, PAGE.width, 66).stroke("#D1D5DB");
  doc.fillColor("#374151").fontSize(9).text("본 패키지는 시스템 원본 기록, 승인 이력, 첨부 증빙, 리스크 해결 이력을 함께 묶은 제출용 자료입니다.", PAGE.left + 12, signY + 12, {
    width: PAGE.width - 24
  });
  doc.fillColor("#111827").fontSize(10).text("확인자: ____________________", PAGE.left + 12, signY + 42);
  doc.text("확인일: ____________________", PAGE.left + 300, signY + 42);

  const pageRange = doc.bufferedPageRange();
  for (let i = pageRange.start; i < pageRange.start + pageRange.count; i += 1) {
    doc.switchToPage(i);
    doc.fillColor("#9CA3AF").fontSize(8).text(`WorkGuard Evidence · ${i + 1} / ${pageRange.count}`, PAGE.left, 812, {
      align: "center",
      width: PAGE.width
    });
  }

  const output = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.end();

  return output;
}

function documentStatusText(status: string) {
  if (status === "APPROVED") {
    return "승인";
  }
  if (status === "REJECTED") {
    return "반려";
  }
  return "진행 중";
}

function documentCategoryText(category: string) {
  if (category === "EXPENSE") {
    return "지출결의서";
  }
  if (category === "PURCHASE") {
    return "구매요청서";
  }
  return "품의서";
}

export async function renderDocumentRequestPdf(document: GroupwareDocument) {
  const doc = new PDFDocument({ size: "A4", margin: 42, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));

  const fontPath = findKoreanFont();
  if (fontPath) {
    doc.font(fontPath);
  }

  doc.fillColor("#111827").fontSize(20).text(documentCategoryText(document.category), PAGE.left, 46, {
    width: PAGE.width
  });
  doc.moveDown(0.4);
  doc.fillColor("#6B7280").fontSize(10).text(document.documentNumber ?? "문서번호 미정", PAGE.left, doc.y);
  doc.moveDown(1);

  infoGrid(doc, [
    ["제목", document.title],
    ["상태", documentStatusText(document.status)],
    ["상신자", `${document.requester.name} · ${document.requester.team?.name ?? "소속 없음"}`],
    ["상신일", formatKstDateTime(document.createdAt)],
    ["현재 결재자", document.reviewer?.name ?? "-"],
    ["금액", document.amount ? `${document.amount.toLocaleString("ko-KR")}원` : "-"]
  ]);

  sectionTitle(doc, "본문");
  doc.fillColor("#111827").fontSize(10).text(document.body, PAGE.left, doc.y, {
    width: PAGE.width,
    lineGap: 4
  });

  sectionTitle(doc, "결재선");
  tableHeader(doc, ["순서", "단계", "결재자", "상태", "처리일", "메모"], [42, 90, 76, 58, 92, 153]);
  for (const step of document.approvalSteps) {
    tableRow(doc, [
      String(step.stepOrder),
      step.label,
      step.approver?.name ?? "-",
      documentStatusText(step.status),
      step.reviewedAt ? formatKstDateTime(step.reviewedAt) : "-",
      step.reviewNote ?? "-"
    ], [42, 90, 76, 58, 92, 153]);
  }

  sectionTitle(doc, "첨부");
  if (document.attachments.length > 0) {
    tableHeader(doc, ["파일명", "형식", "크기", "등록자", "등록일"], [184, 92, 58, 76, 101]);
    for (const attachment of document.attachments) {
      tableRow(doc, [
        attachment.originalName,
        attachment.mimeType,
        formatFileSize(attachment.sizeBytes),
        attachment.uploadedBy.name,
        formatKstDateTime(attachment.createdAt)
      ], [184, 92, 58, 76, 101]);
    }
  } else {
    tableRow(doc, ["첨부 파일이 없습니다.", "", "", "", ""], [184, 92, 58, 76, 101]);
  }

  sectionTitle(doc, "확인란");
  ensureSpace(doc, 70);
  const signY = doc.y;
  doc.rect(PAGE.left, signY, PAGE.width, 62).stroke("#D1D5DB");
  doc.fillColor("#111827").fontSize(10).text("최종 확인자: ____________________", PAGE.left + 12, signY + 18);
  doc.text("확인일: ____________________", PAGE.left + 300, signY + 18);

  const pageRange = doc.bufferedPageRange();
  for (let i = pageRange.start; i < pageRange.start + pageRange.count; i += 1) {
    doc.switchToPage(i);
    doc.fillColor("#9CA3AF").fontSize(8).text(`WorkGuard Document · ${i + 1} / ${pageRange.count}`, PAGE.left, 812, {
      align: "center",
      width: PAGE.width
    });
  }

  const output = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.end();

  return output;
}
