import nodemailer from "nodemailer";

type InvitationEmailInput = {
  to: string;
  name: string;
  companyName: string;
  role: string;
  inviteUrl: string;
};

type NotificationEmailInput = {
  to: string;
  subject: string;
  intro: string;
  lines: string[];
  actionLabel?: string;
  actionUrl?: string;
};

type PasswordResetEmailInput = {
  to: string;
  name: string;
  companyName: string;
  resetUrl: string;
};

export function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

export function absoluteUrl(path: string) {
  const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
  return new URL(path, baseUrl).toString();
}

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
          }
        : undefined
  });
}

export function buildInviteUrl(token: string) {
  return absoluteUrl(`/invite/${token}`);
}

export async function sendInvitationEmail(input: InvitationEmailInput) {
  if (!smtpConfigured()) {
    return {
      sent: false,
      status: "not_configured",
      error: "SMTP_HOST 또는 SMTP_FROM이 설정되지 않았습니다."
    };
  }

  const transporter = createTransport();

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: input.to,
      subject: `[워크가드] ${input.companyName} 워크스페이스 초대`,
      text: [
        `${input.name}님, ${input.companyName} 워크가드 워크스페이스에 초대되었습니다.`,
        "",
        `역할: ${input.role}`,
        `초대 링크: ${input.inviteUrl}`,
        "",
        "이 링크에서 비밀번호를 설정하면 워크가드에 참여할 수 있습니다."
      ].join("\n"),
      html: `
        <div style="font-family:Arial,'Noto Sans KR',sans-serif;line-height:1.6;color:#111827">
          <h2 style="color:#1E3A8A">워크가드 초대</h2>
          <p><strong>${input.name}</strong>님, <strong>${input.companyName}</strong> 워크스페이스에 초대되었습니다.</p>
          <p>역할: <strong>${input.role}</strong></p>
          <p>
            <a href="${input.inviteUrl}" style="display:inline-block;background:#1E3A8A;color:#fff;padding:10px 14px;border-radius:8px;text-decoration:none;font-weight:700">
              초대 수락하기
            </a>
          </p>
          <p style="color:#6B7280;font-size:13px">버튼이 열리지 않으면 아래 링크를 브라우저에 붙여넣으세요.</p>
          <p style="word-break:break-all;color:#374151">${input.inviteUrl}</p>
        </div>
      `
    });

    return {
      sent: true,
      status: "sent",
      error: null
    };
  } catch (error) {
    return {
      sent: false,
      status: "failed",
      error: error instanceof Error ? error.message : "메일 발송에 실패했습니다."
    };
  }
}

export async function sendNotificationEmail(input: NotificationEmailInput) {
  if (!smtpConfigured()) {
    return {
      sent: false,
      status: "not_configured",
      error: "SMTP_HOST 또는 SMTP_FROM이 설정되지 않았습니다."
    };
  }

  const transporter = createTransport();

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: input.to,
      subject: input.subject,
      text: [input.intro, "", ...input.lines, input.actionUrl ? `링크: ${input.actionUrl}` : ""].filter(Boolean).join("\n"),
      html: `
        <div style="font-family:Arial,'Noto Sans KR',sans-serif;line-height:1.6;color:#111827">
          <h2 style="color:#1E3A8A">${input.subject}</h2>
          <p>${input.intro}</p>
          <ul style="padding-left:18px">
            ${input.lines.map((line) => `<li>${line}</li>`).join("")}
          </ul>
          ${
            input.actionUrl
              ? `<p><a href="${input.actionUrl}" style="display:inline-block;background:#1E3A8A;color:#fff;padding:10px 14px;border-radius:8px;text-decoration:none;font-weight:700">${
                  input.actionLabel ?? "바로 확인하기"
                }</a></p>`
              : ""
          }
        </div>
      `
    });

    return {
      sent: true,
      status: "sent",
      error: null
    };
  } catch (error) {
    return {
      sent: false,
      status: "failed",
      error: error instanceof Error ? error.message : "메일 발송에 실패했습니다."
    };
  }
}

export async function sendPasswordResetEmail(input: PasswordResetEmailInput) {
  if (!smtpConfigured()) {
    return {
      sent: false,
      status: "not_configured",
      error: "SMTP_HOST 또는 SMTP_FROM이 설정되지 않았습니다."
    };
  }

  const transporter = createTransport();

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: input.to,
      subject: `[워크가드] ${input.companyName} 비밀번호 재설정`,
      text: [
        `${input.name}님, 워크가드 비밀번호 재설정을 요청하셨습니다.`,
        "",
        `재설정 링크: ${input.resetUrl}`,
        "",
        "링크는 1시간 동안만 유효합니다. 본인이 요청하지 않았다면 이 메일을 무시하세요."
      ].join("\n"),
      html: `
        <div style="font-family:Arial,'Noto Sans KR',sans-serif;line-height:1.6;color:#111827">
          <h2 style="color:#1E3A8A">비밀번호 재설정</h2>
          <p><strong>${input.name}</strong>님, 워크가드 비밀번호 재설정을 요청하셨습니다.</p>
          <p>
            <a href="${input.resetUrl}" style="display:inline-block;background:#1E3A8A;color:#fff;padding:10px 14px;border-radius:8px;text-decoration:none;font-weight:700">
              비밀번호 다시 설정하기
            </a>
          </p>
          <p style="color:#6B7280;font-size:13px">링크는 1시간 동안만 유효합니다. 본인이 요청하지 않았다면 이 메일을 무시하세요.</p>
          <p style="word-break:break-all;color:#374151">${input.resetUrl}</p>
        </div>
      `
    });

    return {
      sent: true,
      status: "sent",
      error: null
    };
  } catch (error) {
    return {
      sent: false,
      status: "failed",
      error: error instanceof Error ? error.message : "메일 발송에 실패했습니다."
    };
  }
}
