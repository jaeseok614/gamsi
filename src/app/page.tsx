import { AlertTriangle, ArrowRight, BarChart3, CheckCircle2, FileText, ShieldCheck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

const problems = [
  "직원 근로시간 기록이 정확하지 않음",
  "초과근로 승인 없이 야근 발생",
  "노동청 점검 시 대응 자료 부족",
  "포괄임금제 적용과 증빙이 불안함"
];

const features = [
  {
    icon: CheckCircle2,
    title: "근로시간 기록",
    copy: "출근, 퇴근, 상태 변경, 휴게 기록을 한 곳에 모아 일별 근로시간 산정 근거를 남깁니다."
  },
  {
    icon: ShieldCheck,
    title: "초과근로 관리",
    copy: "초과근로 사유 제출, 관리자 승인, 반려 이력을 모두 저장해 나중에 설명 가능한 기록을 만듭니다."
  },
  {
    icon: AlertTriangle,
    title: "리스크 알림",
    copy: "주52시간 임박, 무승인 근무, 반복 야근, 증빙 부족을 관리자에게 먼저 보여줍니다."
  },
  {
    icon: FileText,
    title: "노무 대응 리포트",
    copy: "근로시간 요약, 승인 이력, 수정 로그, 리스크 신호를 CSV로 내려받아 점검 대응에 활용합니다."
  }
];

export default function LandingPage() {
  return (
    <>
      <header className="site-header">
        <div className="container nav">
          <Link className="brand" href="/">
            <Image src="/logo.jpg" alt="워크가드 로고" width={34} height={34} priority />
            <span>워크가드</span>
          </Link>
          <nav className="nav-links" aria-label="주요 메뉴">
            <a href="#problem">문제</a>
            <a href="#solution">해결</a>
            <a href="#features">기능</a>
            <Link className="button secondary" href="/login">
              데모 보기
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="container hero-grid">
            <div>
              <div className="eyebrow">
                <ShieldCheck size={16} />
                노무 리스크 관리 SaaS
              </div>
              <h1>
                근태 관리가 아니라,
                <br />
                노무 리스크를 줄입니다
              </h1>
              <p>
                초과근로, 포괄임금제, 근로시간 분쟁까지 모두 대비하는 근로시간 관리 SaaS입니다.
                기록을 넘어 승인, 증빙, 리스크 알림까지 연결합니다.
              </p>
              <div className="hero-actions">
                <Link className="button" href="/login">
                  무료로 시작하기 <ArrowRight size={18} />
                </Link>
                <Link className="button ghost" href="/login">
                  데모 보기
                </Link>
              </div>
            </div>

            <div className="hero-panel" aria-label="리스크 대시보드 미리보기">
              <div className="hero-panel-inner">
                <div className="actions-row" style={{ justifyContent: "space-between", marginBottom: 18 }}>
                  <strong>오늘의 리스크</strong>
                  <span className="status-pill yellow">주의 4건</span>
                </div>
                <div className="risk-preview">
                  <div className="preview-row">
                    <span className="preview-dot" style={{ background: "#EF4444" }} />
                    <div>
                      <strong>무승인 초과근로</strong>
                      <p className="muted">승인 완료 이력 없이 2시간 발생</p>
                    </div>
                    <span className="status-pill red">위험</span>
                  </div>
                  <div className="preview-row">
                    <span className="preview-dot" style={{ background: "#F59E0B" }} />
                    <div>
                      <strong>반복 야근 발생</strong>
                      <p className="muted">최근 2주간 3회 이상 초과근로</p>
                    </div>
                    <span className="status-pill yellow">주의</span>
                  </div>
                  <div className="preview-row">
                    <span className="preview-dot" style={{ background: "#3B82F6" }} />
                    <div>
                      <strong>노동청 대응 리포트</strong>
                      <p className="muted">승인 이력과 수정 로그를 자동 정리</p>
                    </div>
                    <span className="status-pill">준비됨</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="problem" className="section">
          <div className="container">
            <h2 className="section-title">이런 문제, 인사 담당자가 혼자 떠안고 있습니다</h2>
            <div className="grid-4">
              {problems.map((problem) => (
                <div className="card" key={problem}>
                  <AlertTriangle color="#F59E0B" size={24} />
                  <h3 style={{ marginTop: 16 }}>{problem}</h3>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="solution" className="section" style={{ background: "#ffffff" }}>
          <div className="container split">
            <div>
              <h2 className="section-title">워크가드는 문제 있는 기록부터 보여줍니다</h2>
              <p className="section-copy">
                일반 근태 솔루션은 출퇴근 시간을 보여주는 데서 멈춥니다. 워크가드는 주52시간 임박, 무승인
                근무, 반복 야근, 증빙 부족처럼 노무 리스크로 이어질 가능성이 높은 항목을 먼저 정리합니다.
              </p>
            </div>
            <div className="panel stack">
              <div className="actions-row" style={{ justifyContent: "space-between" }}>
                <span className="status-pill red">위험</span>
                <strong>조치 필요 3건</strong>
              </div>
              <div className="actions-row" style={{ justifyContent: "space-between" }}>
                <span>승인 대기</span>
                <strong>5건</strong>
              </div>
              <div className="actions-row" style={{ justifyContent: "space-between" }}>
                <span>주52시간 초과 위험</span>
                <strong>2명</strong>
              </div>
              <div className="actions-row" style={{ justifyContent: "space-between" }}>
                <span>증빙 부족</span>
                <strong>4건</strong>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="section">
          <div className="container">
            <h2 className="section-title">기능이 아니라 불안을 줄이는 구조로 설계했습니다</h2>
            <div className="grid-4">
              {features.map((feature) => {
                const Icon = feature.icon;
                return (
                  <div className="card" key={feature.title}>
                    <Icon color="#1E3A8A" size={26} />
                    <h3 style={{ marginTop: 16 }}>{feature.title}</h3>
                    <p>{feature.copy}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="section" style={{ background: "#ffffff" }}>
          <div className="container split">
            <div>
              <h2 className="section-title">노동청 점검과 분쟁 대응 자료를 한 번에</h2>
              <p className="section-copy">
                근로시간 요약, 초과근로 내역, 승인 이력, 수정 로그를 연결해 나중에 설명 가능한 리포트를
                제공합니다.
              </p>
              <div className="hero-actions">
                <Link className="button" href="/login">
                  무료 체험 시작 <ArrowRight size={18} />
                </Link>
              </div>
            </div>
            <div className="panel">
              <div className="actions-row" style={{ justifyContent: "space-between", marginBottom: 18 }}>
                <strong>
                  <BarChart3 size={18} /> 노무 리스크 리포트
                </strong>
                <span className="status-pill green">생성 가능</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>항목</th>
                      <th>상태</th>
                      <th>근거</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>초과근로 승인</td>
                      <td>
                        <span className="status-pill green">완료</span>
                      </td>
                      <td>승인자, 승인일시 저장</td>
                    </tr>
                    <tr>
                      <td>수정 로그</td>
                      <td>
                        <span className="status-pill">기록</span>
                      </td>
                      <td>변경 주체와 사유 저장</td>
                    </tr>
                    <tr>
                      <td>리스크 코멘트</td>
                      <td>
                        <span className="status-pill yellow">주의</span>
                      </td>
                      <td>반복 야근 패턴 감지</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
