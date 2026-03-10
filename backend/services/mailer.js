/**
 * Email sender using nodemailer
 * Uses Gmail SMTP with App Password (SMTP_USER + SMTP_PASS env vars)
 */
const nodemailer = require('nodemailer');

function getTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    }
  });
}

async function sendPasswordResetEmail(toEmail, resetLink, userName) {
  const transporter = getTransporter();
  await transporter.sendMail({
    from: `"StockPilot" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject: 'Reset your StockPilot password',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:32px;background:#f9f9f9;border-radius:12px;">
        <h2 style="color:#00897B;margin-bottom:8px;">🔐 Password Reset</h2>
        <p style="color:#333;">Hi ${userName || 'there'},</p>
        <p style="color:#333;">We received a request to reset your StockPilot password. Click the button below to set a new password.</p>
        <div style="text-align:center;margin:32px 0;">
          <a href="${resetLink}" style="background:#00897B;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px;">
            Reset Password
          </a>
        </div>
        <p style="color:#888;font-size:13px;">This link expires in <strong>1 hour</strong>. If you didn't request this, you can safely ignore this email.</p>
        <hr style="border:none;border-top:1px solid #ddd;margin:24px 0;">
        <p style="color:#aaa;font-size:12px;text-align:center;">StockPilot — Your Personal Finance Dashboard</p>
      </div>
    `
  });
}

module.exports = { sendPasswordResetEmail };
