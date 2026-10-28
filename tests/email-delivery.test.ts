import { afterEach, describe, expect, it, vi } from "vitest";

import { loadConfig } from "@/core/config";
import { sendLoginCode } from "@/core/email-delivery";

const smtp = vi.hoisted(() => ({ sendMail: vi.fn(), close: vi.fn(), createTransport: vi.fn() }));
vi.mock("nodemailer", () => ({
  default: {
    createTransport: smtp.createTransport,
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("email delivery", () => {
  it("sends a non-tracked form-encoded message through Mailgun", async () => {
    const request = vi.fn().mockResolvedValue(new Response("queued", { status: 200 }));
    vi.stubGlobal("fetch", request);
    const config = loadConfig({
      NODE_ENV: "test",
      SPUR_ORGANIZATION_SLUG: "mail-test",
      SPUR_AUTH: "otp",
      SPUR_EMAIL_PROVIDER: "mailgun",
      SPUR_EMAIL_FROM: "Spur <login@mail.example.com>",
      MAILGUN_API_KEY: "key-secret",
      MAILGUN_DOMAIN: "mail.example.com",
      MAILGUN_BASE_URL: "https://api.eu.mailgun.net",
    });

    await sendLoginCode(config, { email: "person@example.com", code: "123456" });

    expect(request).toHaveBeenCalledOnce();
    const [url, options] = request.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.eu.mailgun.net/v3/mail.example.com/messages");
    expect(options.method).toBe("POST");
    const body = options.body as URLSearchParams;
    expect(body.get("to")).toBe("person@example.com");
    expect(body.get("text")).toContain("123456");
    expect(body.get("o:tracking-clicks")).toBe("no");
    expect(body.get("o:tracking-opens")).toBe("no");
    expect((options.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from("api:key-secret").toString("base64")}`,
    );
  });

  it("sends the same login message through standard SMTP", async () => {
    smtp.sendMail.mockResolvedValue({ messageId: "test" });
    smtp.createTransport.mockReturnValue({ sendMail: smtp.sendMail, close: smtp.close });
    const config = loadConfig({
      NODE_ENV: "test",
      SPUR_ORGANIZATION_SLUG: "mail-test",
      SPUR_AUTH: "otp",
      SPUR_EMAIL_PROVIDER: "smtp",
      SPUR_EMAIL_FROM: "Spur <login@example.com>",
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "587",
      SMTP_USERNAME: "smtp-user",
      SMTP_PASSWORD: "smtp-secret",
    });

    await sendLoginCode(config, { email: "person@example.com", code: "654321" });

    expect(smtp.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: "smtp-user", pass: "smtp-secret" },
    }));
    expect(smtp.sendMail).toHaveBeenCalledWith({
      from: "Spur <login@example.com>",
      to: "person@example.com",
      subject: "Your Spur login code",
      text: expect.stringContaining("654321"),
    });
    expect(smtp.close).toHaveBeenCalledOnce();
  });

  it("fails without exposing the provider response body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("sensitive provider detail", { status: 401 })));
    const config = loadConfig({
      NODE_ENV: "test",
      SPUR_ORGANIZATION_SLUG: "mail-test",
      SPUR_AUTH: "otp",
      MAILGUN_API_KEY: "key-secret",
      MAILGUN_DOMAIN: "mail.example.com",
      MAILGUN_FROM: "login@mail.example.com",
    });
    await expect(sendLoginCode(config, { email: "person@example.com", code: "123456" }))
      .rejects.not.toThrow(/sensitive provider detail/);
  });
});
