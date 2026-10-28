import nodemailer from "nodemailer";

import type { SpurConfig } from "./config";
import { ConfigurationError } from "./errors";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
};

async function sendWithMailgun(config: SpurConfig, message: EmailMessage): Promise<void> {
  if (!config.mailgunApiKey || !config.mailgunDomain || !config.emailFrom) {
    throw new ConfigurationError("The Mailgun email provider is not configured.", "missing_credentials");
  }
  const body = new URLSearchParams({
    from: config.emailFrom,
    to: message.to,
    subject: message.subject,
    text: message.text,
    "o:tracking-clicks": "no",
    "o:tracking-opens": "no",
  });
  const response = await fetch(
    `${config.mailgunBaseUrl}/v3/${encodeURIComponent(config.mailgunDomain)}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`api:${config.mailgunApiKey}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "spur",
      },
      body,
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) {
    throw new Error(`The email provider rejected the message with status ${response.status}.`);
  }
}

async function sendWithSmtp(config: SpurConfig, message: EmailMessage): Promise<void> {
  if (!config.smtpHost || !config.emailFrom) {
    throw new ConfigurationError("The SMTP email provider is not configured.", "missing_credentials");
  }
  const transport = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    requireTLS: config.smtpRequireTls && !config.smtpSecure,
    auth: config.smtpUsername && config.smtpPassword
      ? { user: config.smtpUsername, pass: config.smtpPassword }
      : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  try {
    await transport.sendMail({ from: config.emailFrom, ...message });
  } finally {
    transport.close();
  }
}

/** Sends through the selected adapter; authentication never depends on a vendor API. */
export async function sendEmail(config: SpurConfig, message: EmailMessage): Promise<void> {
  if (config.emailProvider === "mailgun") return sendWithMailgun(config, message);
  if (config.emailProvider === "smtp") return sendWithSmtp(config, message);
  throw new ConfigurationError("Email delivery is not configured.", "missing_credentials");
}

export async function sendLoginCode(
  config: SpurConfig,
  input: { email: string; code: string },
): Promise<void> {
  await sendEmail(config, {
    to: input.email,
    subject: "Your Spur login code",
    text: `Your one-time Spur login code is ${input.code}. It expires in ${Math.ceil(config.otpLifetimeSeconds / 60)} minutes.\n\nIf you did not request this code, you can ignore this email.`,
  });
}
