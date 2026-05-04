# WorkGuard Full Product Design

This document captures the long-term product design for WorkGuard. It is intentionally broader than the current MVP. The MVP should stay focused and usable, while this document preserves the full product direction for future phases.

## 1. Product Positioning

WorkGuard is not just an attendance app. It is an AI-assisted workforce management system that helps companies prevent labor risk before it becomes a dispute, audit issue, or wage claim.

Core positioning:

> 시프티처럼 쉽게 만들고, 시프티보다 똑똑하게 만든다.

Market contrast:

| Product | Market Meaning | WorkGuard Response |
| --- | --- | --- |
| Shiftee | Easy attendance and scheduling | Keep the ease, add labor-risk prevention |
| Flex | All-in-one HR platform | Stay narrower and deeper on work-time compliance |
| Douzone | ERP-grade stability | Offer simpler SaaS UX for smaller teams |
| WorkGuard | Labor-risk prevention SaaS | Show problems before they become legal/operational issues |

Primary message:

- 근태관리 말고, 법 위반부터 막으세요.
- 노동청 대응 준비, 자동으로 됩니다.
- 근무기록, 승인, 증빙, 리스크를 한 번에 관리합니다.

## 2. Competitive Baseline

Shiftee sets an important Korean market baseline:

- Easy employee UX.
- Mobile-first clock-in/clock-out.
- Broad attendance, schedule, leave, approval, and reporting features.
- Practical manager dashboard.
- Security and reliability image.

WorkGuard should not copy feature breadth for its own sake. The product should use Shiftee-level usability as the baseline, then differentiate with concrete Korean labor-risk workflows:

- Work-hour violation detection.
- Overtime, night work, holiday work separation.
- Break-time risk detection.
- Schedule-vs-actual mismatch detection.
- Unapproved overtime and missing evidence alerts.
- Labor office / dispute response reports.
- Immutable audit trail for corrections and approvals.
- Policy change awareness and future policy update workflow.

The competition is not "who has more menus." The competition is "who prevents more expensive problems with less user effort."

## 3. Target Customers

Primary target:

- 50-300 employee Korean companies.
- HR/admin team is small.
- Work-hour issues exist but full ERP or large HR suite feels heavy.
- IT, logistics, retail, manufacturing, field operations, and service businesses.

Secondary target:

- Series A-C startups with overtime and flexible work risk.
- Labor consultants who want a client-facing evidence/reporting tool.
- Franchise or multi-branch operators with repeated attendance exceptions.

Avoid early:

- Companies under 10 employees with low willingness to pay.
- Enterprises over 500 employees that require deep procurement and ERP integration from day one.
- Public-sector procurement-heavy accounts.

## 4. Full Product Modules

### Employee App

The employee app must be action-first, not menu-first.

First screen:

- 출근하기.
- 퇴근하기.
- 오늘 근무시간.
- 남은 기준 근무시간.
- 초과근로 예상.
- 휴가 신청.
- 누락 수정 요청.
- 근무 내역 보기.

Long-term employee features:

- Mobile PWA and native-app-ready layout.
- One-handed clock-in/clock-out.
- Today work card.
- Leave request within two taps.
- Missing clock-in/out correction request.
- Photo attachment for field evidence.
- Offline queue for poor network environments.
- Push notifications for approvals, rejections, schedule changes, and missing records.

### Manager App

The manager app must prioritize exceptions over normal records.

First screen:

- 지각 위험.
- 출퇴근 누락.
- 미승인 연장근무.
- 휴게 미부여 가능성.
- 주52시간 초과 위험.
- 스케줄 대비 실제 근무 이탈.
- 승인 대기.

Manager features:

- One-click approval and rejection.
- Mobile approval flow.
- Team risk dashboard.
- Schedule management.
- Overtime reason review.
- Correction request review.
- Recommended action text for each risk.

### HR / Labor App

HR and labor users need evidence, history, and reporting.

Features:

- Monthly work-hour report.
- Labor-risk PDF report.
- CSV exports.
- Approval history.
- Correction history.
- Audit log.
- Organization, team, user, role, and invitation management.
- Policy settings by company/team.
- Future labor consultant access mode.

### Field / Mobile Verification

This is a long-term module, not an MVP default.

Verification methods:

- GPS clock-in.
- Wi-Fi network verification.
- Beacon verification.
- QR location check.
- Photo evidence.
- Device/session fingerprinting.

Design constraints:

- Explicit consent.
- Clear retention policy.
- No hidden tracking.
- No screenshots, webcams, or invasive monitoring.
- Allow manual correction with reason and approval.

## 5. Risk Engine

The risk engine is WorkGuard's core differentiator. It should turn raw attendance data into clear operational risk.

### MVP / Near-Term Risk Types

- `WEEKLY_LIMIT`: 주52시간 초과 위험.
- `UNAPPROVED_OVERTIME`: 승인 없는 초과근로.
- `REPEATED_OVERTIME`: 반복 야근.
- `MISSING_EVIDENCE`: 초과근로 사유/승인 근거 부족.
- `ADJUSTMENT_SPIKE`: 근태 정정 요청 증가.

### Next Risk Types

- `LATE_RISK`: 스케줄 시작 후 출근 기록 없음.
- `MISSING_CHECK_IN_OUT`: 출근 또는 퇴근 기록 누락.
- `BREAK_VIOLATION`: 휴게시간 부족 가능성.
- `SCHEDULE_MISMATCH`: 스케줄 대비 실제 근무 이탈.
- `NIGHT_HOLIDAY_WORK`: 야간/휴일근로 확인 필요.
- `INCLUSIVE_WAGE_RISK`: 반복 초과근로와 승인/정산 부족으로 인한 포괄임금 오인 운영 위험.

### Long-Term Risk Types

- Suspicious clock-in pattern.
- Repeated same-minute corrections.
- Location mismatch pattern.
- Team-level overtime concentration.
- Manager approval bottleneck.
- Policy configuration drift.
- Legal policy update impact.

Risk output must always include:

- Risk level.
- Risk type.
- Affected employee/team.
- Evidence.
- Recommended manager action.
- Report inclusion flag.

Example manager-facing messages:

- "스케줄 시작 후 20분이 지났지만 출근 기록이 없습니다."
- "초과근로가 있으나 승인 완료 이력이 없습니다."
- "최근 2주간 반복 초과근로가 발생했습니다."
- "총 근무시간 대비 휴게시간이 부족할 수 있습니다."
- "포괄임금제 오인 운영으로 해석될 수 있는 패턴입니다."

## 6. Scheduling and Calculation

Scheduling is essential for competing with attendance tools while differentiating through compliance.

Schedule model should eventually support:

- Employee-specific shifts.
- Team schedules.
- Recurring schedules.
- Holidays.
- Night work windows.
- Break rules.
- Flexible work policy.
- Remote/field/business-trip state.

Calculation outputs:

- Gross presence time.
- Break minutes.
- Recognized work minutes.
- Overtime minutes.
- Night work minutes.
- Holiday work minutes.
- Unapproved work minutes.
- Schedule mismatch minutes.

Important rule:

The system should not automatically declare non-work from inactivity alone. Ambiguous cases should trigger confirmation, reason entry, and approval.

## 7. Leave and Correction Workflows

Leave and correction workflows are key to reducing friction.

Leave request:

- Leave type.
- Date or date range.
- Half-day option.
- Reason.
- Approval status.
- Approval history.

Correction request:

- Missing clock-in.
- Missing clock-out.
- Wrong break time.
- Wrong status.
- Field-work exception.
- Attachment metadata.
- Approval history.

Attachments:

- Photo evidence.
- Document evidence.
- Optional memo.
- Linked target request.
- Upload timestamp.

Long-term storage:

- Local filesystem for MVP.
- Object storage for production.
- Virus scanning for uploaded files.
- Retention policy by company.

## 8. Reporting and Audit

Reports are a paid-value feature, not a side feature.

Reports:

- Labor-risk PDF.
- Work-hour summary CSV.
- Overtime approval report.
- Correction history report.
- Audit log export.
- Schedule-vs-actual report.
- Break-time risk report.
- Night/holiday work report.

Labor office / dispute response report should include:

- Company information.
- Target period.
- Work-hour summary.
- Overtime details.
- Approval history.
- Correction history.
- Evidence/attachment summary.
- Risk signals.
- Audit log.
- Confirmation/signature section.

## 9. AI Features

For MVP and near-term versions, "AI" can remain rule-based and explainable. This is safer for labor and legal workflows.

Near-term AI:

- Rule-based risk comments.
- Overtime reason summarization.
- Missing evidence warning.
- Manager recommended action.
- Team risk summary.

Long-term AI:

- Policy impact analysis.
- Labor-risk trend detection.
- Natural-language report summary.
- Manager approval draft comments.
- Labor consultant review assistant.
- Risk simulation before schedule publishing.

AI constraints:

- Do not make final legal judgments.
- Show evidence behind each comment.
- Mark generated text as assistive.
- Keep human approval in the workflow.

## 10. Policy Update System

Long-term positioning should include "법을 몰라도 안전한 근태관리."

Policy system modules:

- Policy version table.
- Company policy mapping.
- Effective date.
- Rule explanation.
- Impacted employees/teams.
- Change notice.
- Admin acknowledgment.

Workflow:

1. New policy is registered.
2. Companies using affected settings are flagged.
3. Admin sees affected rules and recommended changes.
4. Risk engine uses new rule after effective date.
5. Reports include policy version used for calculation.

## 11. UX Principles

WorkGuard should copy the best part of easy attendance tools: repeated daily actions must stay simple.

Employee UX:

- Keep clock-in/clock-out location fixed.
- Keep today's work card visible.
- Avoid deep menus for common actions.
- Correction and leave request should be two to three taps.

Manager UX:

- Show problem situations first.
- Hide normal data unless needed.
- Provide recommended action.
- Allow one-click approve/reject.
- Keep risky/beta features visually separated.

Update policy:

- Do not move core buttons often.
- Expose new features gradually.
- Provide a short "what changed" summary.
- Keep old workflows available during transition when possible.

## 12. Integrations

Future integrations:

- Payroll.
- ERP.
- Groupware.
- Slack / Teams.
- Kakao 알림톡.
- Email.
- Calendar.
- Labor consultant portal.
- Accounting systems.

Integration rule:

WorkGuard should own the evidence and risk layer. Integrations should push/pull data without weakening audit history.

## 13. Security and Compliance

Core principles:

- No hidden monitoring.
- No screenshots.
- No webcam.
- No keylogging.
- Minimum necessary personal data.
- Clear user consent for location.
- Role-based access control.
- Audit logs for every sensitive change.
- Retention policy.
- Export controls.

Security features:

- RBAC.
- Session security.
- Company-level data isolation.
- Admin action audit.
- Attachment access control.
- Optional IP allowlist for admins.
- Future SSO/SAML.

## 14. Roadmap

### Phase 1: Current MVP

- Web check-in/check-out.
- Status changes.
- Overtime request and approval.
- Risk dashboard.
- Labor-risk PDF.
- Admin settings.
- Team/user management.
- Invitation flow.

### Phase 2: Shiftee-Baseline UX + Risk Expansion

- Employee action-first home.
- Schedule model.
- Leave requests.
- Missing clock-in/out correction.
- Attachment metadata and local upload.
- Late/missing/break/schedule mismatch risks.
- Unified approval inbox.

### Phase 3: Mobile-First Operations

- PWA layout.
- Push-ready notification model.
- Offline queue.
- Mobile approval flows.
- Photo evidence.
- Fast manager triage.

### Phase 4: Location Verification

- GPS check-in.
- Wi-Fi verification.
- Beacon/QR options.
- Consent and retention policy.
- Location mismatch risk.

### Phase 5: Advanced Compliance Intelligence

- Night/holiday work calculation.
- Inclusive wage risk.
- Policy versioning.
- Policy update workflow.
- Risk simulation before schedule publishing.

### Phase 6: Ecosystem Expansion

- Payroll integration.
- ERP/groupware integration.
- Labor consultant workspace.
- Multi-branch/franchise controls.
- SSO/SAML.

## 15. Product Rule

Do not become a surveillance tool.

WorkGuard should feel like:

- Simple for employees.
- Fast for managers.
- Defensible for HR.
- Useful for labor-risk prevention.

The durable strategy is:

> 시프티처럼 쉬운 근태 UX를 기준선으로 삼고, 한국형 노무 리스크 예방과 증빙 자동화를 제품의 구매 이유로 만든다.
