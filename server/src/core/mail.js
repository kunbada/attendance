// 이메일 발송 (Resend). 비밀번호 초기화 인증 코드를 보낼 때만 쓴다.
// RESEND_API_KEY 는 Cloudflare 비밀 값이다. 발신 주소를 따로 정하지 않으면 Resend 테스트 주소(onboarding@resend.dev)를 쓰는데,
// 이 주소는 Resend 가입 이메일로만 보낼 수 있다 (관리자 1명이면 충분). 도메인을 연결하면 MAIL_FROM 으로 바꿀 수 있다.
import { AppError } from './util.js';

export const mailConfigured = (env) => !!env.RESEND_API_KEY;

// 성공하면 true. 설정이 없으면 AppError, 발송 실패는 false
export async function sendMail(env, to, subject, text) {
  if (!mailConfigured(env)) throw new AppError('이메일 발송이 아직 설정되지 않았습니다. 배포가이드의 "관리자 비밀번호 초기화"를 참고해 주세요.');
  const base = env.RESEND_API_BASE || 'https://api.resend.com'; // RESEND_API_BASE 는 테스트용
  try {
    const res = await fetch(base + '/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM || 'Attendance <onboarding@resend.dev>', to: [to], subject, text })
    });
    if (!res.ok) console.error('mail failed', res.status, (await res.text()).slice(0, 200));
    return res.ok;
  } catch (e) {
    console.error('mail error', e && e.message);
    return false;
  }
}
