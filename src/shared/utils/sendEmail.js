// src/shared/utils/sendEmail.js
import nodemailer from "nodemailer";

export const sendEmail = async ({ email, subject, message }) => {
  try {
    const transporter = nodemailer.createTransporter({
      service: process.env.EMAIL_SERVICE || "gmail",
      host: process.env.EMAIL_HOST || "smtp.gmail.com",
      port: process.env.EMAIL_PORT || 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USERNAME,
        pass: process.env.EMAIL_PASSWORD,
      },
    });
    const mailOptions = {
      from: {
        name: process.env.EMAIL_FROM_NAME || "Social Media Blog",
        address: process.env.EMAIL_FROM || process.env.EMAIL_USERNAME,
      },
      to: email,
      subject,
      html: message,
    };
    await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent successfully to ${email}`);
  } catch (error) {
    console.error(`❌ Failed to send email to ${email}:`, error.message);
    throw new Error("Email could not be sent");
  }
};
