import nodemailer from 'nodemailer';
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
  provider: 'resend' | 'smtp' | 'webhook' | 'supabase' | 'sandbox';
  subject: string;
  fallback_reason?: string;
  preview?: {
    to: string;
    subject: string;
    reset_url: string;
    code: string;
    expires_minutes: number;
  };
}

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

function getSmtpConfig(): SmtpConfig | null {
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || '').trim();
  let host = (process.env.SMTP_HOST || '').trim();

  if (!user || !pass) return null;
  if (!host) {
    if (/@(gmail|googlemail)\.com$/i.test(user)) {
      host = 'smtp.gmail.com';
    } else {
      return null;
    }
  }

  const port = Number(process.env.SMTP_PORT) || (host === 'smtp.gmail.com' ? 465 : 587);
  const secure = process.env.SMTP_SECURE !== undefined
    ? process.env.SMTP_SECURE === 'true'
    : port === 465;

  return { host, port, secure, user, pass };
}

export function isSmtpConfigured(): boolean {
  return Boolean(getSmtpConfig());
}

export function isEmailDeliveryConfigured(): boolean {
  return Boolean(
    process.env.RESEND_API_KEY?.trim() ||
    isSmtpConfigured() ||
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

  const rawFrom = process.env.EMAIL_FROM?.trim() || '';
  const hasCustomResendDomain = Boolean(rawFrom && !/onboarding@resend\.dev/i.test(rawFrom));
  const resendFrom = rawFrom || 'GYMBUD Security <onboarding@resend.dev>';
  const resendKey = process.env.RESEND_API_KEY?.trim();
  const smtpCfg = getSmtpConfig();
  const webhookUrl = process.env.EMAIL_WEBHOOK_URL?.trim();
  const failures: string[] = [];
  let resendSandboxBlocked = false;

  const tryResend = async (): Promise<EmailSendResult | null> => {
    if (!resendKey) return null;
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: resendFrom,
          to: [params.to],
          subject,
          html,
          text,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (response.ok) {
        const okData = (await response.json().catch(() => ({}))) as { id?: string };
        console.info(`[GYMBUD Mailer] Resend sent email id=${okData.id || 'ok'} to=${params.to}`);
        return { delivered: true, provider: 'resend', subject };
      }
      const errBody = await response.text().catch(() => '');
      console.warn(`[GYMBUD Mailer] Resend rejected (${response.status}) for ${params.to}: ${errBody.slice(0, 220)}`);
      if (response.status === 403 && errBody.toLowerCase().includes('only send testing emails')) {
        resendSandboxBlocked = true;
        failures.push(
          'Resend testing sender (onboarding@resend.dev) can only email the Resend account owner unless EMAIL_FROM uses a verified domain'
        );
      } else {
        failures.push(`Resend (${response.status}): ${errBody.slice(0, 140)}`);
      }
    } catch (err: any) {
      console.warn('[GYMBUD Mailer] Resend request error:', err?.message || err);
      failures.push(`Resend network error: ${err?.message || 'timeout'}`);
    }
    return null;
  };

  const trySmtp = async (): Promise<EmailSendResult | null> => {
    if (!smtpCfg) return null;
    try {
      const transporter = nodemailer.createTransport({
        host: smtpCfg.host,
        port: smtpCfg.port,
        secure: smtpCfg.secure,
        auth: {
          user: smtpCfg.user,
          pass: smtpCfg.pass,
        },
        connectionTimeout: 8000,
        greetingTimeout: 8000,
      });
      const smtpFrom = rawFrom && !/onboarding@resend\.dev/i.test(rawFrom)
        ? rawFrom
        : `GYMBUD Security <${smtpCfg.user}>`;
      const info = await transporter.sendMail({
        from: smtpFrom,
        to: params.to,
        subject,
        html,
        text,
      });
      console.info(`[GYMBUD Mailer] SMTP sent email messageId=${info.messageId || 'ok'} to=${params.to}`);
      return { delivered: true, provider: 'smtp', subject };
    } catch (err: any) {
      console.warn('[GYMBUD Mailer] SMTP delivery error:', err?.message || err);
      failures.push(`SMTP error: ${err?.message || 'delivery failed'}`);
      return null;
    }
  };

  // Prefer verified custom Resend domain, otherwise prefer SMTP (delivers 6-digit code to ANY recipient email)
  if (hasCustomResendDomain) {
    const r = await tryResend();
    if (r) return r;
  }

  const smtpResult = await trySmtp();
  if (smtpResult) return smtpResult;

  if (!hasCustomResendDomain) {
    const r = await tryResend();
    if (r) return r;
  }

  if (webhookUrl) {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: resendFrom,
          to: params.to,
          subject,
          html,
          text,
          code: params.code,
          reset_url: params.resetUrl,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (response.ok) {
        return { delivered: true, provider: 'webhook', subject };
      }
      failures.push(`Webhook delivery failed (${response.status})`);
    } catch (err: any) {
      failures.push(`Webhook error: ${err?.message || 'network error'}`);
    }
  }

  if (isSupabaseConfigured()) {
    const redirectOrigin = params.redirectTo || params.resetUrl.split('?')[0];
    const sbResult = await sendSupabaseRecoveryEmail(params.to, redirectOrigin);
    if (sbResult.delivered) {
      console.info(`[GYMBUD Mailer] Supabase recovery email triggered for ${params.to}`);
      return {
        delivered: true,
        provider: 'supabase',
        subject,
        ...(resendSandboxBlocked
          ? {
              fallback_reason:
                'Resend is in testing mode (onboarding@resend.dev), so recovery was routed via Supabase Auth link email.',
            }
          : {}),
      };
    }
    if (sbResult.rateLimited) {
      failures.push(
        'Recovery email rate limit reached (Supabase allows 2 emails/hr on default SMTP). Wait briefly, configure SMTP_* / verified Resend EMAIL_FROM, or ask an Admin to update your password.'
      );
    } else {
      failures.push(sbResult.error || 'Supabase recovery email delivery failed.');
    }
  }

  if (failures.length > 0) {
    throw new Error(failures.join(' · '));
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
