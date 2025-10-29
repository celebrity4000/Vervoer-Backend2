import sgMail from "@sendgrid/mail";
import dotenv from "dotenv";
dotenv.config();

// Initialize SendGrid with your API key
sgMail.setApiKey(process.env.SENDGRID_API_KEY as string);

export const sendEmail = async (to: string, subject: string, text: string) => {
  const msg = {
    to,
    from: process.env.SENDGRID_FROM_EMAIL as string, // Must be verified in SendGrid
    subject,
    text,
    // Optional: Add HTML version
    // html: `<strong>${text}</strong>`,
  };

  try {
    await sgMail.send(msg);
    console.log(`Email sent successfully to ${to}`);
  } catch (error: any) {
    console.error("SendGrid Error:", error);
    if (error.response) {
      console.error("Error details:", error.response.body);
    }
    throw error;
  }
};

export const generateOTP = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

export const getOtpExpiry = (): Date => {
  return new Date(Date.now() + 5 * 60 * 1000);
};

/**
 * 
 * @param startDate 
 * @param stopDate 
 * @param diff in Days
 */
export function getAllDate(startDate: Date, stopDate: Date, diff = 1) {
  const r: Date[] = [];
  for (let date = startDate; date <= stopDate;) {
    r.push(date);
    date = new Date(date);
    date.setDate(date.getDate() + diff);
  }
  return r;
}