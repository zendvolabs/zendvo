import nodemailer from "nodemailer";

const EMAIL_CONFIG = {
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: false,
  auth: {
    user: process.env.SMTP_USER || "your-email@example.com",
    pass: process.env.SMTP_PASS || "your-password",
  },
};

const transporter = nodemailer.createTransport(EMAIL_CONFIG);

export async function sendAdminAlert(data: {
  userIds: string[];
  ips: string[];
  phoneNumbers: string[];
  failureCount: number;
}) {
  const adminEmail = process.env.ADMIN_EMAIL || EMAIL_CONFIG.auth.user;
  const mailOptions = {
    from: `"Zendvo Security" <${EMAIL_CONFIG.auth.user}>`,
    to: adminEmail,
    subject: "🚨 SECURITY ALERT: Suspicious OTP Brute-force Detected",
    html: generateAdminAlertTemplate(data),
    text: `Suspicious Activity Alert!\n\nThreshold: ${data.failureCount} failed OTP attempts.\nIPs: ${data.ips.join(", ")}\nUser IDs: ${data.userIds.join(", ")}\nPhone Numbers: ${data.phoneNumbers.join(", ")}`,
  };

  try {
    if (process.env.NODE_ENV === "development") {
      console.log("!".repeat(50));
      console.log("🚨 ADMIN SECURITY ALERT (Development Mode)");
      console.log("!".repeat(50));
      console.log(`To Admin: ${adminEmail}`);
      console.log(`Failures: ${data.failureCount}`);
      console.log(`Involved IPs: ${data.ips.join(", ")}`);
      console.log("!".repeat(50));
      return {
        success: true,
        messageId: "dev-mode",
        message: "Admin alert logged to console",
      };
    }

    const info = await transporter.sendMail(mailOptions);
    return {
      success: true,
      messageId: info.messageId,
      message: "Admin security alert sent successfully",
    };
  } catch (error) {
    console.error("Error sending admin security alert:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      message: "Failed to send admin security alert",
      detail: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function sendVerificationEmail(
  email: string,
  otp: string,
  userName?: string,
) {
  const mailOptions = {
    from: `"Zendvo" <${EMAIL_CONFIG.auth.user}>`,
    to: email,
    subject: "Verify Your Email - Zendvo",
    html: generateEmailTemplate(otp, userName),
    text: `Your Zendvo verification code is: ${otp}\n\nThis code will expire in 10 minutes.\n\nIf you didn't request this code, please ignore this email.`,
  };

  try {
    if (process.env.NODE_ENV === "development") {
      console.log("=".repeat(50));
      console.log("📧 VERIFICATION EMAIL (Development Mode)");
      console.log("=".repeat(50));
      console.log(`To: ${email}`);
      console.log(`OTP Code: ${otp}`);
      console.log(`Expires: 10 minutes`);
      console.log("=".repeat(50));
      return {
        success: true,
        messageId: "dev-mode",
        message: "OTP logged to console (development mode)",
      };
    }

    const info = await transporter.sendMail(mailOptions);
    return {
      success: true,
      messageId: info.messageId,
      message: "Verification email sent successfully",
    };
  } catch (error) {
    console.error("Error sending verification email:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      message: "Failed to send verification email",
      detail: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function sendForgotPasswordEmail(
  email: string,
  token: string,
  userName?: string,
) {
  const resetLink = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/auth/reset-password?token=${token}`;
  const mailOptions = {
    from: `"Zendvo" <${EMAIL_CONFIG.auth.user}>`,
    to: email,
    subject: "Reset Your Password - Zendvo",
    html: generateForgotPasswordTemplate(resetLink, userName),
    text: `Reset your Zendvo password by clicking this link: ${resetLink}\n\nThis link will expire in 1 hour.\n\nIf you didn't request a password reset, please ignore this email.`,
  };

  try {
    if (process.env.NODE_ENV === "development") {
      console.log("=".repeat(50));
      console.log("📧 FORGOT PASSWORD EMAIL (Development Mode)");
      console.log("=".repeat(50));
      console.log(`To: ${email}`);
      console.log(`Reset Link: ${resetLink}`);
      console.log(`Expires: 1 hour`);
      console.log("=".repeat(50));
      return {
        success: true,
        messageId: "dev-mode",
        message: "Reset link logged to console (development mode)",
      };
    }

    const info = await transporter.sendMail(mailOptions);
    return {
      success: true,
      messageId: info.messageId,
      message: "Forgot password email sent successfully",
    };
  } catch (error) {
    console.error("Error sending forgot password email:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      message: "Failed to send forgot password email",
      detail: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function sendPasswordResetConfirmationEmail(
  email: string,
  userName?: string,
) {
  const mailOptions = {
    from: `"Zendvo" <${EMAIL_CONFIG.auth.user}>`,
    to: email,
    subject: "Password Changed - Zendvo",
    html: generatePasswordResetConfirmationTemplate(userName),
    text: `Your Zendvo password has been successfully changed.\n\nIf you did not perform this action, please contact support immediately.`,
  };

  try {
    if (process.env.NODE_ENV === "development") {
      console.log("=".repeat(50));
      console.log("📧 PASSWORD RESET CONFIRMATION (Development Mode)");
      console.log("=".repeat(50));
      console.log(`To: ${email}`);
      console.log("=".repeat(50));
      return {
        success: true,
        messageId: "dev-mode",
        message: "Reset confirmation logged to console (development mode)",
      };
    }

    const info = await transporter.sendMail(mailOptions);
    return {
      success: true,
      messageId: info.messageId,
      message: "Password reset confirmation email sent successfully",
    };
  } catch (error) {
    console.error("Error sending password reset confirmation email:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      message: "Failed to send password reset confirmation email",
      detail: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function sendSecurityAlertEmail(
  email: string,
  userName?: string,
) {
  const mailOptions = {
    from: `"Zendvo Security" <${EMAIL_CONFIG.auth.user}>`,
    to: email,
    subject: "Security Alert: Too Many Failed Verification Attempts",
    html: generateSecurityAlertTemplate(userName),
    text: `We detected too many failed verification attempts for your account. For your security, your account has been temporarily locked for 30 minutes. If this wasn't you, please contact support immediately.`,
  };

  try {
    if (process.env.NODE_ENV === "development") {
      console.log("=".repeat(50));
      console.log("🚨 SECURITY ALERT EMAIL (Development Mode)");
      console.log("=".repeat(50));
      console.log(`To: ${email}`);
      console.log("Reason: Too many failed verification attempts");
      console.log("Action: Account locked for 30 mins");
      console.log("=".repeat(50));
      return {
        success: true,
        messageId: "dev-mode",
        message: "Security alert logged to console (development mode)",
      };
    }

    const info = await transporter.sendMail(mailOptions);
    return {
      success: true,
      messageId: info.messageId,
      message: "Security alert email sent successfully",
    };
  } catch (error) {
    console.error("Error sending security alert email:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      message: "Failed to send security alert email",
      detail: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

function generateEmailTemplate(otp: string, userName?: string): string {
  return generateBaseTemplate({
    title: "Verify Your Email",
    userName,
    content: `
      <p style="margin: 0 0 20px; color: #4a5568; font-size: 16px; line-height: 1.6;">
        Thank you for signing up with Zendvo! To complete your registration, please verify your email address using the code below:
      </p>
      
      <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0;">
        <tr>
          <td align="center" style="background-color: #f7fafc; border: 2px dashed #667eea; border-radius: 8px; padding: 30px;">
            <div style="font-size: 36px; font-weight: 700; color: #667eea; letter-spacing: 8px; font-family: 'Courier New', monospace;">
              ${otp}
            </div>
          </td>
        </tr>
      </table>
      
      <p style="margin: 20px 0; color: #4a5568; font-size: 14px; line-height: 1.6;">
        <strong>⏰ This code will expire in 10 minutes.</strong>
      </p>
    `,
  });
}

function generateForgotPasswordTemplate(
  resetLink: string,
  userName?: string,
): string {
  return generateBaseTemplate({
    title: "Reset Your Password",
    userName,
    content: `
      <p style="margin: 0 0 20px; color: #4a5568; font-size: 16px; line-height: 1.6;">
        We received a request to reset your password. Click the button below to choose a new one:
      </p>
      
      <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0;">
        <tr>
          <td align="center">
            <a href="${resetLink}" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; padding: 16px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block; box-shadow: 0 4px 6px rgba(102, 126, 234, 0.25);">
              Reset Password
            </a>
          </td>
        </tr>
      </table>
      
      <p style="margin: 20px 0; color: #4a5568; font-size: 14px; line-height: 1.6;">
        <strong>⏰ This link will expire in 1 hour.</strong>
      </p>
      
      <p style="margin: 20px 0; color: #718096; font-size: 14px; line-height: 1.6;">
        If you're having trouble clicking the button, copy and paste this link into your browser:<br>
        <span style="word-break: break-all; color: #667eea;">${resetLink}</span>
      </p>
    `,
  });
}

function generatePasswordResetConfirmationTemplate(userName?: string): string {
  return generateBaseTemplate({
    title: "Password Changed",
    userName,
    content: `
      <p style="margin: 0 0 20px; color: #4a5568; font-size: 16px; line-height: 1.6;">
        This is a confirmation that your Zendvo password has been successfully changed.
      </p>
      
      <p style="margin: 20px 0; color: #4a5568; font-size: 16px; line-height: 1.6;">
        If you did not perform this action, please contact our security team immediately at support@zendvo.com.
      </p>

      <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0;">
        <tr>
          <td align="center">
            <a href="${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/auth/login" style="background-color: #f7fafc; border: 1px solid #e2e8f0; color: #4a5568; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500; font-size: 14px; display: inline-block;">
              Return to Login
            </a>
          </td>
        </tr>
      </table>
    `,
  });
}

function generateSecurityAlertTemplate(userName?: string): string {
  return generateBaseTemplate({
    title: "Security Alert: Account Locked",
    userName,
    content: `
      <p style="margin: 0 0 20px; color: #4a5568; font-size: 16px; line-height: 1.6;">
        We detected multiple failed verification attempts for your account. For your security, your account has been temporarily locked for <strong>30 minutes</strong>.
      </p>
      
      <div style="background-color: #fff5f5; border-left: 4px solid #fc8181; padding: 20px; margin: 30px 0; border-radius: 4px;">
        <p style="margin: 0; color: #c53030; font-size: 14px; line-height: 1.6;">
          <strong>Why did this happen?</strong><br>
          Our system noticed 5 consecutive incorrect OTP entries. This usually happens when someone is trying to guess your verification code.
        </p>
      </div>

      <p style="margin: 20px 0; color: #4a5568; font-size: 16px; line-height: 1.6;">
        If you did not attempt to verify your email recently, someone else might be trying to access your account. Please contact our support team immediately.
      </p>

      <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0;">
        <tr>
          <td align="center">
            <a href="mailto:support@zendvo.com" style="background-color: #f7fafc; border: 1px solid #e2e8f0; color: #4a5568; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500; font-size: 14px; display: inline-block;">
              Contact Support
            </a>
          </td>
        </tr>
      </table>
    `,
  });
}

function generateAdminAlertTemplate(data: {
  userIds: string[];
  ips: string[];
  phoneNumbers: string[];
  failureCount: number;
}): string {
  return generateBaseTemplate({
    title: "Suspicious Activity Detected",
    userName: "Administrator",
    content: `
      <div style="background-color: #fff5f5; border-left: 4px solid #c53030; padding: 20px; margin: 0 0 30px 0;">
        <h3 style="margin: 0 0 10px; color: #c53030; font-size: 18px;">Brute-force Threshold Reached</h3>
        <p style="margin: 0; color: #742a2a; font-size: 14px;">
          Our security system has detected <strong>${data.failureCount}</strong> consecutive OTP verification failures from a single source.
        </p>
      </div>

      <h4 style="color: #2d3748; margin: 20px 0 10px;">Security Metadata:</h4>
      <table width="100%" cellpadding="10" cellspacing="0" style="border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px; color: #4a5568;">
        <tr style="background-color: #f7fafc;">
          <td width="30%"><strong>Involved IPs</strong></td>
          <td style="word-break: break-all; font-family: monospace;">${data.ips.join(", ") || "Unknown"}</td>
        </tr>
        <tr>
          <td><strong>Targeted User IDs</strong></td>
          <td style="word-break: break-all; font-family: monospace;">${data.userIds.join(", ") || "None"}</td>
        </tr>
        <tr style="background-color: #f7fafc;">
          <td><strong>Phone Numbers</strong></td>
          <td>${data.phoneNumbers.join(", ") || "None"}</td>
        </tr>
        <tr>
          <td><strong>Timestamp</strong></td>
          <td>${new Date().toISOString()}</td>
        </tr>
      </table>

      <p style="margin: 30px 0 0; color: #4a5568; font-size: 14px; line-height: 1.6;">
        <strong>Recommended Action:</strong> Please investigate the involved IP addresses and consider temporary blacklisting if the activity persists across different accounts.
      </p>
    `,
  });
}

function generateBaseTemplate({
  title,
  userName,
  content,
}: {
  title: string;
  userName?: string;
  content: string;
}): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <tr>
            <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">Zendvo</h1>
              <p style="margin: 10px 0 0; color: #ffffff; font-size: 16px; opacity: 0.9;">Gifting Made Magical</p>
            </td>
          </tr>
          
          <tr>
            <td style="padding: 40px 30px;">
              <h2 style="margin: 0 0 20px; color: #1a202c; font-size: 24px; font-weight: 600;">
                ${userName ? `Hi ${userName},` : "Hello!"}
              </h2>
              ${content}
              
              <p style="margin: 20px 0 0; color: #718096; font-size: 14px; line-height: 1.6;">
                If you didn't request this action, please ignore this email or contact our support team if you have concerns.
              </p>
            </td>
          </tr>
          
          <tr>
            <td style="background-color: #f7fafc; padding: 30px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0 0 10px; color: #718096; font-size: 14px;">
                © ${new Date().getFullYear()} Zendvo. All rights reserved.
              </p>
              <p style="margin: 0; color: #a0aec0; font-size: 12px;">
                Transforming digital money transfers into memorable experiences
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

export async function sendActionOtpEmail(
  email: string,
  otp: string,
  action: string,
  userName?: string,
) {
  const actionLabels: Record<string, string> = {
    delete_account: "Account Deletion",
    disable_2fa: "Disable Two-Factor Authentication",
    change_email: "Change Email Address",
    change_password: "Change Password",
    withdraw_funds: "Withdraw Funds",
    default: "Sensitive Action",
  };

  const actionLabel = actionLabels[action] || "Sensitive Action";

  const mailOptions = {
    from: `"Zendvo" <${EMAIL_CONFIG.auth.user}>`,
    to: email,
    subject: `${actionLabel} Verification Code - Zendvo`,
    html: generateActionOtpTemplate(otp, actionLabel, userName),
    text: `Your Zendvo ${actionLabel} verification code is: ${otp}\n\nThis code will expire in 10 minutes.\n\nIf you didn't request this code, please ignore this email.`,
  };

  try {
    if (process.env.NODE_ENV === "development") {
      console.log("=".repeat(50));
      console.log(`ACTION OTP EMAIL (Development Mode)`);
      console.log("=".repeat(50));
      console.log(`Action: ${actionLabel}`);
      console.log(`To: ${email}`);
      console.log(`OTP Code: ${otp}`);
      console.log(`Expires: 10 minutes`);
      console.log("=".repeat(50));
      return {
        success: true,
        messageId: "dev-mode",
        message: "Action OTP logged to console (development mode)",
      };
    }

    const info = await transporter.sendMail(mailOptions);
    return {
      success: true,
      messageId: info.messageId,
      message: "Action OTP email sent successfully",
    };
  } catch (error) {
    console.error("Error sending action OTP email:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      message: "Failed to send action OTP email",
      detail: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

function generateActionOtpTemplate(
  otp: string,
  actionLabel: string,
  userName?: string,
): string {
  return generateBaseTemplate({
    title: `${actionLabel} Verification`,
    userName,
    content: `
      <p style="margin: 0 0 20px; color: #4a5568; font-size: 16px; line-height: 1.6;">
        You are attempting to <strong>${actionLabel}</strong> on your Zendvo account. 
        To proceed, please use the verification code below:
      </p>
      
      <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0;">
        <tr>
          <td align="center" style="background-color: #f7fafc; border: 2px dashed #667eea; border-radius: 8px; padding: 30px;">
            <div style="font-size: 36px; font-weight: 700; color: #667eea; letter-spacing: 8px; font-family: 'Courier New', monospace;">
              ${otp}
            </div>
          </td>
        </tr>
      </table>
      
      <p style="margin: 20px 0; color: #4a5568; font-size: 14px; line-height: 1.6;">
        <strong>⏰ This code will expire in 10 minutes.</strong>
      </p>
    `,
  });
}

export async function sendGiftConfirmationOTP(
  email: string,
  otp: string,
  userName?: string,
) {
  const mailOptions = {
    from: `"Zendvo" <${EMAIL_CONFIG.auth.user}>`,
    to: email,
    subject: "Gift Confirmation OTP - Zendvo",
    html: generateEmailTemplate(otp, userName),
    text: `Your gift confirmation code is: ${otp}\n\nThis code will expire in 10 minutes.\n\nIf you didn't request this code, please ignore this email.`,
  };

  try {
    if (process.env.NODE_ENV === "development") {
      console.log("=".repeat(50));
      console.log("📧 GIFT CONFIRMATION OTP (Development Mode)");
      console.log("=".repeat(50));
      console.log(`To: ${email}`);
      console.log(`OTP Code: ${otp}`);
      console.log(`Expires: 10 minutes`);
      console.log("=".repeat(50));
      return {
        success: true,
        messageId: "dev-mode",
        message: "Gift confirmation OTP logged to console (development mode)",
      };
    }

    const info = await transporter.sendMail(mailOptions);
    return {
      success: true,
      messageId: info.messageId,
      message: "Gift confirmation OTP email sent successfully",
    };
  } catch (error) {
    console.error("Error sending gift confirmation OTP:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      message: "Failed to send gift confirmation OTP",
    };
  }
}

export async function sendGiftCompletionToSender(
  senderEmail: string,
  senderName: string,
  shareLink: string,
  amount: number,
  currency: string,
  recipientName: string,
) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const fullShareLink = `${appUrl}${shareLink}`;
  const content = `
    <p style="margin: 0 0 20px; color: #4a5568; font-size: 16px; line-height: 1.6;">
      Your gift of <strong>${amount} ${currency}</strong> to <strong>${recipientName}</strong> has been successfully confirmed and is ready to share!
    </p>
    
    <div style="background-color: #f0f4ff; border-left: 4px solid #667eea; padding: 15px; margin: 20px 0; border-radius: 4px;">
      <p style="margin: 0 0 10px; color: #2d3748; font-size: 14px; font-weight: 600;">
        Your Gift Share Link:
      </p>
      <p style="margin: 0 0 15px; color: #4a5568; font-size: 14px; word-break: break-all;">
        ${fullShareLink}
      </p>
      <p style="margin: 0; color: #718096; font-size: 12px;">
        Share this link with friends and family. They can claim the gift when they're ready!
      </p>
    </div>
    
    <p style="margin: 20px 0 0; color: #718096; font-size: 14px; line-height: 1.6;">
      The recipient will receive a notification that a gift is waiting for them.
    </p>
  `;

  const mailOptions = {
    from: `"Zendvo" <${EMAIL_CONFIG.auth.user}>`,
    to: senderEmail,
    subject: "Gift Confirmed - Share Your Gift Link!",
    html: generateBaseTemplate({
      title: "Gift Confirmed",
      userName: senderName,
      content,
    }),
    text: `Your gift of ${amount} ${currency} to ${recipientName} has been confirmed.\n\nShare link: ${fullShareLink}\n\nShare this link to let others claim your gift!`,
  };

  try {
    if (process.env.NODE_ENV === "development") {
      console.log("=".repeat(50));
      console.log("📧 GIFT COMPLETION EMAIL (Development Mode)");
      console.log("=".repeat(50));
      console.log(`To: ${senderEmail}`);
      console.log(`Gift: ${amount} ${currency} to ${recipientName}`);
      console.log(`Share Link: ${fullShareLink}`);
      console.log("=".repeat(50));
      return {
        success: true,
        messageId: "dev-mode",
        message: "Gift completion email logged to console (development mode)",
      };
    }

    const info = await transporter.sendMail(mailOptions);
    return {
      success: true,
      messageId: info.messageId,
      message: "Gift confirmation email sent successfully",
    };
  } catch (error) {
    console.error("Error sending gift completion email:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      message: "Failed to send gift completion email",
    };
  }
}

export async function sendGiftNotificationToRecipient(
  recipientEmail: string,
  recipientName: string,
  senderName: string,
  amount: number,
  currency: string,
  unlockDatetime?: Date,
) {
  const unlockMessage = unlockDatetime
    ? `This gift will be unlocked on ${new Date(unlockDatetime).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })}.`
    : "This gift is available for you to claim now!";

  const content = `
    <p style="margin: 0 0 20px; color: #4a5568; font-size: 16px; line-height: 1.6;">
      Great news, <strong>${recipientName}</strong>! <strong>${senderName}</strong> has sent you a gift of <strong>${amount} ${currency}</strong>.
    </p>
    
    <div style="background-color: #f0fff4; border-left: 4px solid #48bb78; padding: 15px; margin: 20px 0; border-radius: 4px;">
      <p style="margin: 0 0 10px; color: #2d3748; font-size: 14px; font-weight: 600;">
        🎁 Gift Status
      </p>
      <p style="margin: 0; color: #22543d; font-size: 14px;">
        ${unlockMessage}
      </p>
    </div>
    
    <p style="margin: 20px 0 0; color: #718096; font-size: 14px; line-height: 1.6;">
      Log in to your Zendvo account to view and manage your gift. Thank you for using Zendvo!
    </p>
  `;

  const mailOptions = {
    from: `"Zendvo" <${EMAIL_CONFIG.auth.user}>`,
    to: recipientEmail,
    subject: `You've Received a Gift from ${senderName}!`,
    html: generateBaseTemplate({
      title: "Gift Received",
      userName: recipientName,
      content,
    }),
    text: `You've received a gift of ${amount} ${currency} from ${senderName}.\n\n${unlockMessage}\n\nLog in to your Zendvo account to view your gift.`,
  };

  try {
    if (process.env.NODE_ENV === "development") {
      console.log("=".repeat(50));
      console.log("📧 GIFT NOTIFICATION EMAIL (Development Mode)");
      console.log("=".repeat(50));
      console.log(`To: ${recipientEmail}`);
      console.log(`From: ${senderName}`);
      console.log(`Amount: ${amount} ${currency}`);
      console.log(`Unlock: ${unlockDatetime?.toISOString() || "Immediate"}`);
      console.log("=".repeat(50));
      return {
        success: true,
        messageId: "dev-mode",
        message: "Gift notification email logged to console (development mode)",
      };
    }

    const info = await transporter.sendMail(mailOptions);
    return {
      success: true,
      messageId: info.messageId,
      message: "Gift notification email sent successfully",
    };
  } catch (error) {
    console.error("Error sending gift notification email:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      message: "Failed to send gift notification email",
    };
  }
}

export async function sendAppreciationEmailToSender(options: {
  senderEmail: string;
  senderName?: string | null;
  recipientName?: string | null;
  message?: string | null;
  template?: string | null;
  /** Human-readable reaction label, e.g. "❤️ Heart". */
  reaction?: string | null;
  amount?: number;
  currency?: string;
}) {
  const { senderEmail, senderName, recipientName, message, template, reaction, amount, currency } = options;
  const note = message || template;
  const thankYouText = note
    ? reaction
      ? `${note} ${reaction}`
      : note
    : reaction
      ? `Reacted with ${reaction}`
      : "Thank you for the wonderful gift!";
  const displaySender = senderName || "Friend";
  const displayRecipient = recipientName || "The recipient";
  const giftContext = amount && currency ? ` for the ${amount} ${currency} gift` : "";

  const content = `
    <p style="margin: 0 0 20px; color: #4a5568; font-size: 16px; line-height: 1.6;">
      <strong>${displayRecipient}</strong> sent you an appreciation note${giftContext}!
    </p>

    <div style="background-color: #fffaf0; border-left: 4px solid #ed8936; padding: 20px; margin: 20px 0; border-radius: 4px;">
      <p style="margin: 0; color: #7b341e; font-size: 16px; font-style: italic; line-height: 1.6;">
        "${thankYouText}"
      </p>
    </div>

    <p style="margin: 20px 0 0; color: #718096; font-size: 14px; line-height: 1.6;">
      Thank you for making digital gifting magical with Zendvo!
    </p>
  `;

  const mailOptions = {
    from: `"Zendvo" <${EMAIL_CONFIG.auth.user}>`,
    to: senderEmail,
    subject: `💖 Thank You Note from ${displayRecipient}!`,
    html: generateBaseTemplate({
      title: "Appreciation Received",
      userName: displaySender,
      content,
    }),
    text: `${displayRecipient} sent you an appreciation note${giftContext}:\n\n"${thankYouText}"\n\nThank you for using Zendvo!`,
  };

  try {
    if (process.env.NODE_ENV === "development") {
      console.log("=".repeat(50));
      console.log("📧 APPRECIATION EMAIL (Development Mode)");
      console.log("=".repeat(50));
      console.log(`To: ${senderEmail}`);
      console.log(`From: ${displayRecipient}`);
      console.log(`Note: ${thankYouText}`);
      console.log("=".repeat(50));
      return {
        success: true,
        messageId: "dev-mode",
        message: "Appreciation email logged to console (development mode)",
      };
    }

    const info = await transporter.sendMail(mailOptions);
    return {
      success: true,
      messageId: info.messageId,
      message: "Appreciation email sent successfully",
    };
  } catch (error) {
    console.error("Error sending appreciation email:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      message: "Failed to send appreciation email",
    };
  }
}

