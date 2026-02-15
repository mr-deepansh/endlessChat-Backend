import ejs from "ejs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const renderEmailTemplate = async (templateName, data) => {
  try {
    const templatePath = path.join(__dirname, "..", "views", "emails", `${templateName}.ejs`);
    const html = await ejs.renderFile(templatePath, data);
    return html;
  } catch (error) {
    console.error(`Error rendering email template ${templateName}:`, error);
    throw new Error(`Failed to render email template: ${templateName}`);
  }
};

export const generateForgotPasswordEmail = async (data) => {
  return await renderEmailTemplate("forgot-password", data);
};

export const generatePasswordResetSuccessEmail = async (data) => {
  return await renderEmailTemplate("password-reset-success", data);
};

export const generatePlainTextEmail = (templateName, data) => {
  switch (templateName) {
    case "forgot-password":
      return `
Hello ${data.name},

We received a request to reset the password for your account. If you made this request, please click the link below to reset your password:

${data.resetUrl}

This link will expire in 10 minutes for security reasons.

If you didn't request this password reset, please ignore this email. Your password will remain unchanged.

Best regards,
Social Media App Team
            `;

    case "password-reset-success":
      return `
Hello ${data.name},

Your password has been successfully reset. You can now log in to your account using your new password.

Login URL: ${data.loginUrl}

For your security, you have been logged out from all devices. You'll need to log in again with your new password.

Login Details:
- Username: ${data.username}
- Email: ${data.email}
- Reset Time: ${data.resetTime}

If you didn't reset your password or have any concerns, please contact our support team immediately.

Best regards,
Social Media App Team
            `;

    default:
      return "Email content not available";
  }
};
