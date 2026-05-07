export function roleLabel(role?: string | null) {
  if (role === "MANAGER") {
    return "팀장";
  }
  if (role === "HR") {
    return "인사 담당";
  }
  if (role === "ADMIN") {
    return "관리자";
  }
  return "직원";
}

export function planTierLabel(tier?: string | null) {
  if (tier === "STARTER") {
    return "기본";
  }
  if (tier === "GROWTH") {
    return "성장";
  }
  if (tier === "ENTERPRISE") {
    return "기업";
  }
  return "체험";
}

export function approvalStatusLabel(status?: string | null) {
  if (status === "APPROVED") {
    return "승인";
  }
  if (status === "REJECTED") {
    return "반려";
  }
  return "대기";
}

export function approvalStatusTone(status?: string | null) {
  if (status === "APPROVED") {
    return "green";
  }
  if (status === "REJECTED") {
    return "red";
  }
  return "yellow";
}

export function payrollStatementStatusLabel(status?: string | null) {
  if (status === "LOCKED") {
    return "잠금 발행";
  }
  if (status === "PUBLISHED") {
    return "발행";
  }
  return "대기";
}

export function announcementCategoryLabel(category?: string | null) {
  if (category === "RESOURCE") {
    return "자료실";
  }
  if (category === "TEAM") {
    return "게시판";
  }
  if (category === "HR") {
    return "인사 안내";
  }
  return "공지";
}

export function documentCategoryLabel(category?: string | null) {
  if (category === "EXPENSE") {
    return "지출결의서";
  }
  if (category === "PURCHASE") {
    return "구매요청서";
  }
  return "품의서";
}

export function documentStatusLabel(status?: string | null) {
  return approvalStatusLabel(status);
}

export function documentStatusTone(status?: string | null) {
  return approvalStatusTone(status);
}

export function libraryCategoryLabel(category?: string | null) {
  if (category === "CONTRACT") {
    return "계약서";
  }
  if (category === "LEAVE") {
    return "휴가 정책";
  }
  if (category === "PAYROLL") {
    return "급여 안내";
  }
  if (category === "FORM") {
    return "서식";
  }
  return "회사 규정";
}

export function libraryScopeLabel(scope?: string | null) {
  if (scope === "TEAM") {
    return "부서";
  }
  if (scope === "HR") {
    return "인사/관리자";
  }
  return "전체";
}

export function workThreadStatusLabel(status?: string | null) {
  return status === "RESOLVED" ? "해결" : "미결";
}

export function workThreadStatusTone(status?: string | null) {
  return status === "RESOLVED" ? "green" : "yellow";
}

export function workThreadPriorityLabel(priority?: string | null) {
  if (priority === "LOW") {
    return "낮음";
  }
  if (priority === "HIGH") {
    return "높음";
  }
  if (priority === "URGENT") {
    return "긴급";
  }
  return "보통";
}

export function riskLevelLabel(level?: string | null) {
  if (level === "CRITICAL") {
    return "심각";
  }
  if (level === "HIGH") {
    return "높음";
  }
  if (level === "MEDIUM") {
    return "주의";
  }
  return "낮음";
}

export function monthCloseStatusLabel(status?: string | null) {
  return status === "CLOSED" ? "마감 완료" : "진행 중";
}

export function browserPermissionLabel(permission?: string | null) {
  if (permission === "granted") {
    return "허용됨";
  }
  if (permission === "denied") {
    return "차단됨";
  }
  return "미확인";
}

export function browserPermissionTone(permission?: string | null) {
  if (permission === "granted") {
    return "green";
  }
  if (permission === "denied") {
    return "red";
  }
  return "gray";
}

export function invitationStatusLabel(status?: string | null) {
  if (status === "ACCEPTED") {
    return "수락 완료";
  }
  if (status === "CANCELLED") {
    return "취소됨";
  }
  return "대기 중";
}

export function invitationStatusTone(status?: string | null) {
  if (status === "ACCEPTED") {
    return "green";
  }
  if (status === "CANCELLED") {
    return "gray";
  }
  return "yellow";
}

export function invitationEmailStatusLabel(status?: string | null) {
  if (status === "sent") {
    return "발송 완료";
  }
  if (status === "failed") {
    return "발송 실패";
  }
  return "미발송";
}

export function invitationEmailStatusTone(status?: string | null) {
  if (status === "sent") {
    return "green";
  }
  if (status === "failed") {
    return "red";
  }
  return "gray";
}

export function monthCloseReopenStatusLabel(status?: string | null) {
  if (status === "APPROVED") {
    return "승인";
  }
  if (status === "REJECTED") {
    return "반려";
  }
  return "대기 중";
}

export function monthCloseReopenStatusTone(status?: string | null) {
  if (status === "APPROVED") {
    return "green";
  }
  if (status === "REJECTED") {
    return "gray";
  }
  return "yellow";
}

export function sessionStatusLabel(status?: string | null) {
  if (status === "CLOSED") {
    return "종료";
  }
  if (status === "NEEDS_REVIEW") {
    return "확인 필요";
  }
  return "진행 중";
}

export function validationStatusLabel(status?: string | null) {
  return status === "PASS" ? "정상" : "확인 필요";
}

export function integrationDispatchStatusLabel(status?: string | null) {
  if (status === "sent") {
    return "전송 완료";
  }
  if (status === "queued") {
    return "전송 대기";
  }
  if (status === "failed") {
    return "전송 실패";
  }
  return "건너뜀";
}

export function integrationDispatchStatusTone(status?: string | null) {
  if (status === "sent") {
    return "green";
  }
  if (status === "queued") {
    return "yellow";
  }
  if (status === "failed") {
    return "red";
  }
  return "gray";
}

export function monthCloseMetricLabel(key?: string | null) {
  const labels: Record<string, string> = {
    pendingApprovals: "승인 대기",
    pendingLeaveApprovals: "휴가 승인 대기",
    pendingAdjustmentApprovals: "정정 승인 대기",
    openSessions: "미종결 세션",
    unresolvedOvertime: "미승인 연장",
    missingRecordRisks: "누락 리스크",
    scheduleMismatchSessions: "스케줄 이탈",
    leaveBalanceDeficitUsers: "연차 부족 인원",
    calculatedWorkMinutes: "인정 근로시간",
    overtimeMinutes: "연장 근로시간",
    approvedOvertimeMinutes: "승인 연장시간",
    nightWorkMinutes: "야간 근로시간",
    holidayWorkMinutes: "휴일 근로시간",
    additionalOvertimePremiumMinutes: "연장 가산 환산",
    additionalNightPremiumMinutes: "야간 가산 환산",
    additionalHolidayPremiumMinutes: "휴일 가산 환산",
    payableEquivalentMinutes: "급여 환산 시간",
    annualLeaveGrantedDays: "부여 연차",
    annualLeaveUsedThisMonth: "이번 달 사용 연차",
    annualLeaveUsedInCycle: "누적 사용 연차",
    annualLeavePendingDays: "승인 대기 연차",
    annualLeaveRemainingDays: "잔여 연차",
    pendingApprovalCount: "개인 승인 대기",
    pendingLeaveApprovalCount: "개인 휴가 대기",
    pendingAdjustmentApprovalCount: "개인 정정 대기",
    openSessionCount: "개인 미종결 세션",
    unresolvedOvertimeCount: "개인 미승인 연장",
    missingRecordCount: "개인 누락 리스크",
    scheduleMismatchCount: "개인 스케줄 이탈",
    readyCount: "마감 준비 완료 인원",
    actionRequiredCount: "추가 조치 필요 인원"
  };

  return labels[key ?? ""] ?? key ?? "-";
}
