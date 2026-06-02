import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

/**
 * The concrete transporter type both `createTransport` overloads we use (SMTP
 * and the no-op `jsonTransport`) are widened to. We only call `sendMail` and
 * read `info.message`, which every transport implements, so a single alias
 * keeps the field type stable across `@types/nodemailer` versions (whose
 * `Transporter` generic is not always defaulted).
 */
type MailTransport = ReturnType<typeof nodemailer.createTransport>;

/**
 * Web app base URL the emailed action links point at. The verification +
 * reset PAGES live on the public web app (apps/web), not the API.
 */
const DEFAULT_WEB_BASE_URL = 'https://ruletka.top';

/** Default SMTP submission port (STARTTLS). 465 implies implicit TLS. */
const DEFAULT_SMTP_PORT = 587;

/** Brand name shown in the email subject/body + as the From display name. */
const BRAND = 'Рулетка';

/**
 * Sends transactional email (account verification, password reset).
 *
 * Provider is SMTP via nodemailer, kept behind this small service with a
 * WORKING NO-OP DEFAULT: when `SMTP_HOST` is unset the transport is a local
 * `jsonTransport` that NEVER opens a socket — every "send" just serialises the
 * message and logs it at `debug`, so the app compiles and runs in dev/CI with
 * no mail server and {@link sendVerificationEmail} / {@link sendPasswordResetEmail}
 * never throw. Set `SMTP_HOST` (+ optional `SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`
 * and `MAIL_FROM`) to switch real delivery on.
 *
 * Callers (the auth flows) treat sending as BEST-EFFORT: a failure here is
 * logged and swallowed so a mail outage can never fail registration or reveal
 * whether an address exists.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  /** Configured SMTP host; empty/undefined → no-op (jsonTransport) mode. */
  private readonly host: string;

  /** The `From:` header used on every message. */
  private readonly from: string;

  /** Public web app base URL the action links are built from. */
  private readonly webBaseUrl: string;

  /** Built-once nodemailer transport (real SMTP or the no-op jsonTransport). */
  private readonly transporter: MailTransport;

  constructor(private readonly configService: ConfigService) {
    this.host = (this.configService.get<string>('SMTP_HOST') ?? '').trim();
    this.webBaseUrl = this.normalizeBaseUrl(
      (this.configService.get<string>('WEB_BASE_URL') ?? '').trim() || DEFAULT_WEB_BASE_URL,
    );
    this.from = (this.configService.get<string>('MAIL_FROM') ?? '').trim() || this.defaultFrom();

    this.transporter = this.isEnabled() ? this.buildSmtpTransport() : this.buildNoopTransport();

    if (!this.isEnabled()) {
      this.logger.log(
        'SMTP_HOST not set — Mailer DISABLED (dev no-op; emails are logged, not sent).',
      );
    }
  }

  /** Whether a real SMTP transport is configured (a host is present). */
  isEnabled(): boolean {
    return this.host.length > 0;
  }

  /**
   * Send the account-verification email carrying a one-time link to
   * `${WEB_BASE_URL}/verify-email?token=…`. Best-effort: resolves `true` on a
   * successful send, `false` if delivery failed (the caller does not surface
   * the distinction to the client). Never throws.
   */
  async sendVerificationEmail(to: string, token: string): Promise<boolean> {
    const link = this.buildLink('/verify-email', token);
    const subject = `${BRAND}: подтвердите ваш email`;
    const intro =
      'Спасибо за регистрацию! Подтвердите свой адрес электронной почты, чтобы активировать все возможности аккаунта.';
    return this.send({
      to,
      subject,
      text: this.verificationText(intro, link),
      html: this.actionEmailHtml({
        heading: 'Подтверждение email',
        intro,
        buttonLabel: 'Подтвердить email',
        link,
        footnote:
          'Ссылка действительна 24 часа. Если вы не создавали аккаунт, просто проигнорируйте это письмо.',
      }),
    });
  }

  /**
   * Send the password-reset email carrying a one-time link to
   * `${WEB_BASE_URL}/reset-password?token=…`. Best-effort (see
   * {@link sendVerificationEmail}); never throws.
   */
  async sendPasswordResetEmail(to: string, token: string): Promise<boolean> {
    const link = this.buildLink('/reset-password', token);
    const subject = `${BRAND}: сброс пароля`;
    const intro =
      'Мы получили запрос на сброс пароля для вашего аккаунта. Нажмите кнопку ниже, чтобы задать новый пароль.';
    return this.send({
      to,
      subject,
      text: this.verificationText(intro, link),
      html: this.actionEmailHtml({
        heading: 'Сброс пароля',
        intro,
        buttonLabel: 'Сбросить пароль',
        link,
        footnote:
          'Ссылка действительна 1 час. Если вы не запрашивали сброс пароля, проигнорируйте это письмо — ваш пароль останется прежним.',
      }),
    });
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /**
   * Deliver one message. In no-op mode the message is serialised by
   * `jsonTransport` and logged (no socket is opened). A real failure is logged
   * and swallowed (`false`) so callers can treat sending as best-effort.
   */
  private async send(message: {
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<boolean> {
    try {
      const info = await this.transporter.sendMail({ from: this.from, ...message });
      if (!this.isEnabled()) {
        // No-op transport: surface the message so a developer can grab the link
        // out of the logs without a mail server.
        this.logger.debug(
          `[mail:noop] to=${message.to} subject="${message.subject}" message=${String(
            (info as { message?: unknown }).message ?? '',
          )}`,
        );
      } else {
        this.logger.log(`Sent "${message.subject}" to ${message.to}`);
      }
      return true;
    } catch (err) {
      this.logger.warn(
        `Failed to send "${message.subject}" to ${message.to}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
  }

  /** Build the real SMTP transport from the configured env. */
  private buildSmtpTransport(): MailTransport {
    const port = this.resolvePort();
    return nodemailer.createTransport({
      host: this.host,
      port,
      // 465 ⇒ implicit TLS; otherwise STARTTLS upgrade on the submission port.
      secure: port === 465,
      auth: this.resolveAuth(),
    });
  }

  /**
   * No-op transport: `jsonTransport` serialises the message to JSON and resolves
   * WITHOUT touching the network — perfect for dev/CI with no mail server. Its
   * `createTransport` overload returns a different `Transporter` generic; we
   * widen it to {@link MailTransport} since we only use the shared `sendMail`.
   */
  private buildNoopTransport(): MailTransport {
    return nodemailer.createTransport({
      jsonTransport: true,
    }) as unknown as MailTransport;
  }

  /** SMTP credentials, or `undefined` when the server needs no auth. */
  private resolveAuth(): { user: string; pass: string } | undefined {
    const user = (this.configService.get<string>('SMTP_USER') ?? '').trim();
    const pass = this.configService.get<string>('SMTP_PASS') ?? '';
    if (user.length === 0) {
      return undefined;
    }
    return { user, pass };
  }

  /** Parse `SMTP_PORT` to a positive integer, falling back to 587. */
  private resolvePort(): number {
    const raw = (this.configService.get<string>('SMTP_PORT') ?? '').trim();
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SMTP_PORT;
  }

  /** Build an action link on the web app for `path` carrying the token. */
  private buildLink(path: string, token: string): string {
    return `${this.webBaseUrl}${path}?token=${encodeURIComponent(token)}`;
  }

  /** Strip a trailing slash so link concatenation never doubles `//`. */
  private normalizeBaseUrl(url: string): string {
    return url.replace(/\/+$/, '');
  }

  /**
   * Default `From:` when `MAIL_FROM` is unset — derive a no-reply address from
   * the web base URL's host so the dev no-op output still looks plausible.
   */
  private defaultFrom(): string {
    let host = 'ruletka.top';
    try {
      host = new URL(this.webBaseUrl).hostname || host;
    } catch {
      // keep the fallback host
    }
    return `${BRAND} <no-reply@${host}>`;
  }

  /** Plain-text body (a tasteful fallback for non-HTML mail clients). */
  private verificationText(intro: string, link: string): string {
    return `${intro}\n\n${link}\n\n— ${BRAND}`;
  }

  /**
   * Minimal, tasteful, table-based HTML email (inline styles only — the only
   * thing email clients reliably render). Dark header, single CTA button, muted
   * footnote, plus the raw URL as a copy-paste fallback.
   */
  private actionEmailHtml(opts: {
    heading: string;
    intro: string;
    buttonLabel: string;
    link: string;
    footnote: string;
  }): string {
    const { heading, intro, buttonLabel, link, footnote } = opts;
    const safeLink = this.escapeHtml(link);
    return `<!DOCTYPE html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${this.escapeHtml(heading)}</title>
  </head>
  <body style="margin:0;padding:0;background:#0b0b12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#e8e8f0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0b12;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#15151f;border-radius:16px;overflow:hidden;border:1px solid #26263a;">
            <tr>
              <td style="background:linear-gradient(135deg,#7c3aed,#db2777);padding:24px 32px;">
                <span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.01em;">${BRAND}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#ffffff;">${this.escapeHtml(heading)}</h1>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#c4c4d4;">${this.escapeHtml(intro)}</p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                  <tr>
                    <td style="border-radius:10px;background:linear-gradient(135deg,#7c3aed,#db2777);">
                      <a href="${safeLink}" target="_blank" rel="noopener" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">${this.escapeHtml(buttonLabel)}</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 8px;font-size:12px;color:#8a8a9e;">Если кнопка не работает, скопируйте ссылку в браузер:</p>
                <p style="margin:0 0 24px;font-size:12px;word-break:break-all;"><a href="${safeLink}" target="_blank" rel="noopener" style="color:#a78bfa;">${safeLink}</a></p>
                <p style="margin:0;font-size:12px;line-height:1.6;color:#6c6c80;">${this.escapeHtml(footnote)}</p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-size:11px;color:#4a4a5c;">© ${BRAND}</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  }

  /** Escape the handful of characters that matter inside HTML text/attrs. */
  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
