const nodemailer = require('nodemailer');

// Setup Transporter using local Postfix / Sendmail or SMTP
const transporter = nodemailer.createTransport({
    sendmail: true,
    newline: 'unix',
    path: '/usr/sbin/sendmail'
});

async function sendOtpEmail(toEmail, otpCode, type = 'login') {
    const subject = type === 'login' 
        ? `[MitraTukang] Kode OTP Masuk Akun: ${otpCode}` 
        : `[MitraTukang] Kode OTP Pendaftaran Akun: ${otpCode}`;

    const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 25px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff;">
            <div style="text-align: center; margin-bottom: 20px;">
                <h2 style="color: #d97706; margin: 0; font-size: 24px;">MitraTukang Platform</h2>
                <p style="color: #64748b; font-size: 13px; margin: 4px 0 0 0;">On-Demand Construction & Escrow Marketplace</p>
            </div>
            <div style="padding: 20px; background-color: #f8fafc; border-radius: 12px; text-align: center; margin-bottom: 20px;">
                <p style="font-size: 13px; color: #334155; margin-bottom: 10px;">Gunakan kode OTP berikut untuk melanjutkan verifikasi ${type === 'login' ? 'masuk' : 'pendaftaran'} akun Anda:</p>
                <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #0f172a; padding: 12px; background: #ffffff; border: 1px dashed #cbd5e1; border-radius: 8px; display: inline-block;">
                    ${otpCode}
                </div>
                <p style="font-size: 11px; color: #dc2626; margin-top: 10px; margin-bottom: 0;">⚠️ Kode ini hanya berlaku selama 10 menit. Jangan bagikan kode ini kepada siapapun.</p>
            </div>
            <p style="font-size: 11px; color: #94a3b8; text-align: center; margin: 0;">
                Jika Anda tidak meminta kode ini, abaikan pesan ini.<br>© 2026 MitraTukang. Kepatuhan UU PDP No. 27/2022.
            </p>
        </div>
    `;

    try {
        const info = await transporter.sendMail({
            from: '"MitraTukang Auth" <no-reply@mitratukang.id>',
            to: toEmail,
            subject: subject,
            html: htmlContent
        });
        console.log(`[MAIL DISPATCH] Email OTP ${otpCode} successfully sent to ${toEmail}. MessageId: ${info.messageId}`);
        return { success: true, messageId: info.messageId };
    } catch (err) {
        console.error('[MAIL ERROR] Failed sending email via sendmail:', err.message);
        return { success: false, error: err.message };
    }
}

module.exports = { sendOtpEmail };
