import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();

export const sendEmail = async (to: string, subject: string, text: string) => {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    secure: true,
    port: 465,
    auth: {
      user: process.env.gmail,
      pass: process.env.google_App_password,
    },
  });

  await transporter.sendMail({
    from: process.env.gmail,
    to,
    subject,
    text,
  });
};

export const generateOTP = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

export const getOtpExpiry = (): Date => {
  return new Date(Date.now() + 5 * 60 * 1000);
};