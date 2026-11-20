import { isSupabaseConfigured, sendSupabaseRecoveryEmail } from './supabase.ts';

export interface PasswordResetEmailParams {
  to: string;
  displayName: string;
  resetUrl: string;
  redirectTo?: string;
  code: string;
  expiresMinutes: number;
}

export interface EmailSendResult {
  delivered: boolean;
  provider: 'resend' | 'webhook' | 'supabase' | 'sandbox';
  subject: string;
  preview?: {
    to: string;
    subject: string;
    reset_url: string;
    code: string;
    expires_minutes: number;
  };
}

export function isEmailDeliveryConfigured(): boolean {
  return Boolean(
    process.env.RESEND_API_KEY?.trim() ||
    process.env.EMAIL_WEBHOOK_URL?.trim() ||
    isSupabaseConfigured()
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendPasswordResetEmail(params: PasswordResetEmailParams): Promise<EmailSendResult> {
  const subject = 'Reset your GYMBUD password';
  const safeName = escapeHtml(params.displayName || 'Athlete');
  const safeUrl = escapeHtml(params.resetUrl);
  const safeCode = escapeHtml(params.code);

  const html = `
    <div style="background:#070809;color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:32px 20px;">
      <div style="max-width:520px;margin:0 auto;background:#101214;border:1px solid #27272a;border-radius:16px;padding:32px;">
        <div style="font-size:22px;font-weight:800;letter-spacing:-0.02em;color:#ffffff;margin-bottom:8px;">GYMBUD</div>
        <p style="font-size:13px;color:#a3e635;font-weight:600;margin:0 0 20px 0;">Account Recovery &amp; Security</p>
        <p style="font-size:15px;line-height:1.6;color:#e4e4e7;margin:0 0 16px 0;">
          Hi ${safeName}, we received a request to reset the password for your GYMBUD account.
        </p>
        <div style="margin:24px 0;">
          <a href="${safeUrl}" style="display:inline-block;background:#a3e635;color:#070809;font-weight:700;font-size:14px;text-decoration:none;padding:12px 22px;border-radius:8px;">
            Reset Password
          </a>
        </div>
        <div style="background:#070809;border:1px solid #27272a;border-radius:10px;padding:16px;margin:20px 0;">
          <div style="font-size:12px;color:#a1a1aa;margin-bottom:6px;">Or enter this single-use 6-digit verification code in the app:</div>
          <div style="font-family:monospace;font-size:24px;font-weight:700;letter-spacing:0.18em;color:#a3e635;">${safeCode}</div>
        </div>
        <p style="font-size:12px;line-height:1.6;color:#a1a1aa;margin:0 0 8px 0;">
          This link and verification code expire in <strong>${params.expiresMinutes} minutes</strong> and can only be used once.
        </p>
        <p style="font-size:12px;line-height:1.6;color:#71717a;margin:0;">
          If you did not request a password reset, you can safely ignore this email. Your password will remain unchanged.
        </p>
      </div>
    </div>
  `.trim();

  const text = [
    `GYMBUD Password Reset`,
    ``,
    `Hi ${params.displayName || 'Athlete'},`,
    `We received a request to reset the password for your GYMBUD account.`,
    ``,
    `Reset Link: ${params.resetUrl}`,
    `Verification Code: ${params.code}`,
    ``,
    `This link and code expire in ${params.expiresMinutes} minutes and can only be used once.`,
    `If you did not request this, you can safely ignore this email.`,
  ].join('\n');

  const from = process.env.EMAIL_FROM?.trim() || 'GYMBUD Security <onboarding@resend.dev>';
  const resendKey = process.env.RESEND_API_KEY?.trim();
  const webhookUrl = process.env.EMAIL_WEBHOOK_URL?.trim();

  if (resendKey) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [params.to],
        subject,
        html,
        text,
      }),
    });
    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`Email delivery failed (${response.status}): ${errBody.slice(0, 180)}`);
    }
    return { delivered: true, provider: 'resend', subject };
  }

  if (webhookUrl) {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: params.to, subject, html, text }),
    });
    if (!response.ok) {
      throw new Error(`Email webhook delivery failed (${response.status})`);
    }
    return { delivered: true, provider: 'webhook', subject };
  }

  if (isSupabaseConfigured()) {
    const redirectOrigin = params.redirectTo || params.resetUrl.split('?')[0];
    const sbResult = await sendSupabaseRecoveryEmail(params.to, redirectOrigin);
    if (sbResult.delivered) {
      return { delivered: true, provider: 'supabase', subject };
    }
    if (sbResult.rateLimited) {
      throw new Error('Recovery email rate limit reached. Wait a moment before requesting another email (or add RESEND_API_KEY).');
    }
    throw new Error(sbResult.error || 'Supabase recovery email delivery failed.');
  }

  console.info(
    `[GYMBUD Mailer - Sandbox] To: ${params.to} | Subject: ${subject} | Expires: ${params.expiresMinutes}m | Reset URL: ${params.resetUrl}`
  );

  return {
    delivered: false,
    provider: 'sandbox',
    subject,
    preview: {
      to: params.to,
      subject,
      reset_url: params.resetUrl,
      code: params.code,
      expires_minutes: params.expiresMinutes,
    },
  };
}
