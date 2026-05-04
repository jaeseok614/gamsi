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
