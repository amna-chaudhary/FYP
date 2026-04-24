const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

function otpEmailHtml(code, purpose) {
  const heading =
    purpose === "register"
      ? "Verify your email"
      : "Sign-in verification code";
  const lead =
    purpose === "register"
      ? "Welcome to EnergyCert Bot. Use the code below to finish setting up your account."
      : "We noticed a sign-in attempt from a new device. Use the code below to confirm it's you.";

  return `
  <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#f4fbfa;color:#0e1f1c">
    <div style="background:#fff;border-radius:18px;padding:36px;border:1px solid #dfe9e6">
      <div style="font-size:14px;font-weight:700;color:#00988b;letter-spacing:0.3px;text-transform:uppercase">
        EnergyCert Bot
      </div>
      <h1 style="font-size:22px;margin:18px 0 8px;color:#0e1f1c">${heading}</h1>
      <p style="color:#5a706c;line-height:1.6;margin:0 0 24px;font-size:15px">${lead}</p>
      <div style="background:#f4fbfa;border:1px dashed #c3d3cf;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px">
        <div style="font-size:13px;color:#5a706c;margin-bottom:6px">Your verification code</div>
        <div style="font-size:34px;font-weight:800;letter-spacing:8px;color:#00988b;font-family:'Courier New',monospace">${code}</div>
      </div>
      <p style="color:#5a706c;font-size:13px;line-height:1.6;margin:0">
        This code expires in ${process.env.OTP_EXPIRY_MINUTES || 10} minutes. If you didn't request it, you can safely ignore this email.
      </p>
    </div>
    <div style="text-align:center;color:#8a9c98;font-size:12px;margin-top:16px">
      © EnergyCert Bot · Automated message, please don't reply
    </div>
  </div>`;
}

async function sendOtpEmail(to, code, purpose = "register") {
  const fromName = process.env.MAIL_FROM_NAME || "EnergyCert Bot";
  const subject =
    purpose === "register"
      ? `${code} is your EnergyCert verification code`
      : `${code} is your sign-in code for EnergyCert`;

  const info = await transporter.sendMail({
    from: `"${fromName}" <${process.env.GMAIL_USER}>`,
    to,
    subject,
    html: otpEmailHtml(code, purpose),
    text: `Your EnergyCert verification code is ${code}. It expires in ${process.env.OTP_EXPIRY_MINUTES || 10} minutes.`,
  });

  return info;
}

module.exports = { sendOtpEmail };