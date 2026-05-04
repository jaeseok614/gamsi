# WorkGuard Phase 2 Plan

## 1. Working Rule

Phase 2 is not a redesign. It is an expansion on top of the current MVP.

- 랜딩페이지 톤과 브랜드는 유지한다.
- 대시보드의 큰 구조는 유지한다.
- 출근/퇴근 버튼 위치는 유지한다.
- 관리자 리스크 대시보드는 유지하고 새 리스크만 추가한다.
- PDF, 리포트, 설정 화면은 유지한다.
- 새 기능은 기존 화면을 갈아엎지 않고 카드/섹션 형태로 확장한다.

## 2. Scope

This phase follows `docs/FULL_PRODUCT_DESIGN.md` and implements the near-term Shiftee-baseline UX additions that fit the current MVP.

Implemented scope:

1. Employee schedule visibility
2. Manager schedule registration
3. Leave request workflow
4. Missing clock-in/out correction request workflow
5. Risk engine expansion
6. Mobile PWA screen design draft

Explicit non-scope for this phase:

- GPS check-in
- Wi-Fi verification
- Beacon/QR verification
- Native push implementation
- Offline sync implementation

These remain long-term design items only.

## 3. UI Expansion Plan

### Employee Area

Keep the existing attendance card and fixed check-in/check-out buttons untouched.

Add below the current employee section:

- `이번 주 스케줄과 휴가` card
  - Today schedule summary
  - Upcoming schedule table
  - Leave request form
- `출퇴근 누락 수정` card
  - Missing clock-in request
  - Missing clock-out request
  - Recent request status list

### Manager Area

Keep the current team status, approval inbox, and risk dashboard structure.

Add:

- `오늘 스케줄` column in team status
- `스케줄 운영` card
  - Employee selector
  - Date/time based schedule creation
- `예정 스케줄` table

### Risk Dashboard

Keep the current dashboard structure and add only new signal types:

- `LATE_RISK`
- `MISSING_CHECK_IN_OUT`
- `BREAK_VIOLATION`
- `SCHEDULE_MISMATCH`

## 4. Data Model Changes

### New Model

- `WorkSchedule`
  - user/date unique schedule
  - start/end time
  - break minutes
  - shift name
  - note

### ApprovalRequest Extension

Use the existing approval inbox instead of creating a separate Phase 2 approval system.

Added approval support:

- `LEAVE`
- detailed adjustment metadata for missing clock-in/out

Added metadata:

- adjustment type
- target date
- requested clock time
- leave type
- leave date range
- leave duration

## 5. Workflow Summary

### Schedule

1. Manager selects employee, date, and shift time.
2. Schedule is upserted for that user/date.
3. Employee sees the schedule in the existing dashboard flow.

### Leave Request

1. Employee selects leave type, date range, and duration.
2. Request enters the existing approval inbox.
3. Manager approves or rejects in the same approval panel used for overtime.

### Missing Clock Correction

1. Employee selects missing clock-in or missing clock-out.
2. Employee enters target date and time.
3. Request enters the existing approval inbox.
4. If approved, a correction attendance event is created and the work session is recalculated.

## 6. Mobile PWA Screen Draft

This phase adds the design draft, not the full PWA runtime implementation.

### Screen A. Employee Home

- Top: today status pill
- Middle: fixed clock-in / clock-out CTA
- Below: today schedule, today work time, overtime warning
- Bottom cards: leave request, missing record correction

### Screen B. Request Sheet

- Tab 1: leave request
- Tab 2: missing clock correction
- Recent request timeline below

### Screen C. Manager Triage

- First row: pending approvals, late risks, missing records
- Second row: today schedules
- Approval cards optimized for thumb reach

### Screen D. Field Fail-safe

- Offline-ready CTA placeholders
- Last sync state
- Local queue placeholder
- Photo evidence slot reserved for Phase 3

## 7. Acceptance Checklist

- Existing brand/UI tone remains intact
- Core dashboard structure remains intact
- Check-in/check-out button location remains intact
- Risk dashboard remains intact with added risks
- Reports/settings stay unchanged
- Phase 2 features are added as cards/sections
- Prisma schema and seed reflect DB changes
- Validation runs: `npm run typecheck`, `npm run lint`, `npm run build`
