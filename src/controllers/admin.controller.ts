import { Request, Response , NextFunction} from "express";
import { ApiError } from "../utils/apierror.js";
import { ApiResponse } from "../utils/apirespone.js";
import jwt from "jsonwebtoken";
import { User } from "../models/normalUser.model.js";
import { Merchant } from "../models/merchant.model.js";
import { sendEmail,generateOTP,getOtpExpiry } from "../utils/mailer.utils.js";
import { BlacklistedToken } from "../models/blacklistedToken.model.js";
import { asyncHandler } from "../utils/asynchandler.js";
import { Admin } from "../models/adminBank.model.js";
import { z } from "zod";

// In-memory temporary store for OTP and expiry
let adminOtp: string | null = null;
let adminOtpExpiry: Date | null = null;

// send OTP to admin email
export const sendAdminOtp = async (req: Request, res: Response) => {
  const { email } = req.body;

  if (email !== process.env.ADMIN_EMAIL) {
    throw new ApiError(401, "Invalid admin email");
  }

  const otp = generateOTP();
  adminOtp = otp;
  adminOtpExpiry = getOtpExpiry();

  await sendEmail(email, "Your Admin Login OTP", `Your OTP is: ${otp}`);

  res.status(200).json({
    success: true,
    message: "OTP sent to admin email.",
  });
};

// verify OTP and generate token
export const verifyAdminOtp = (req: Request, res: Response) => {
  const { email, otp } = req.body;

  if (email !== process.env.ADMIN_EMAIL) {
    throw new ApiError(401, "Invalid admin email");
  }

  if (!adminOtp || !adminOtpExpiry) {
    throw new ApiError(400, "No OTP generated. Please request a new OTP.");
  }

  if (new Date() > adminOtpExpiry) {
    adminOtp = null;
    adminOtpExpiry = null;
    throw new ApiError(400, "OTP expired. Please request a new one.");
  }

  if (otp !== adminOtp) {
    throw new ApiError(400, "Invalid OTP");
  }

  // Clear OTP after successful login
  adminOtp = null;
  adminOtpExpiry = null;

  const token = jwt.sign(
    { role: "admin" },
    process.env.JWT_SECRET as string,
    { expiresIn: "1h" }
  );

  res.status(200).json({
    success: true,
    message: "Admin logged in successfully.",
    token,
  });
};

export const getAllUsers = async (req: Request, res: Response) => {
   const users = await User.find({}, "firstName email phoneNumber carLicensePlateImage");

  res.status(200).json(
    new ApiResponse(200, { users }, "Fetched all user data")
  );
};

export const getAllMerchants = async (req: Request, res: Response) => {
  const merchants = await Merchant.find();

  res.status(200).json(
    new ApiResponse(200, { merchants }, "Fetched all merchant data")
  );
}

export const deleteUser = async (req: Request, res: Response) => {
  const { userId } = req.params;

  const user = await User.findByIdAndDelete(userId);
  if (!user) {
    throw new ApiError(404, "User not found");
  }

  res.status(200).json(
    new ApiResponse(200, {}, "User deleted successfully")
  );
}

export const deleteMerchant = async (req: Request, res: Response) => {
  const { merchantId } = req.params;

  const merchant = await Merchant.findByIdAndDelete(merchantId);
  if (!merchant) {
    throw new ApiError(404, "Merchant not found");
  }

  res.status(200).json(
    new ApiResponse(200, {}, "Merchant deleted successfully")
  );
}


// logout 
export const logoutAdmin = async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new ApiError(401, "No token provided");
  }

  const token = authHeader.split(" ")[1];

  const decoded: any = jwt.decode(token);
  if (!decoded || !decoded.exp) {
    throw new ApiError(400, "Invalid token");
  }

  await BlacklistedToken.create({
    token,
    expiresAt: new Date(decoded.exp * 1000),
  });

  res.status(200).json(
    new ApiResponse(200, {}, "Admin logged out successfully")
  );
};


// bank details
const bankDetailsSchema = z.object({
  accountNumber: z.string().min(8, "Account Number is too short"),
  ifscCode: z.string().min(5, "IFSC code is too short"),
  accountHolderName: z.string().min(3, "Account Holder Name is required"),
  branch: z.string().min(2, "Branch is required"),
});

export const updateAdminBankDetails = asyncHandler(
  async (req: Request, res: Response) => {
    const { email } = req.body;

    if (email !== process.env.ADMIN_EMAIL) {
      throw new ApiError(401, "Invalid admin email");
    }

    const { accountNumber, ifscCode, accountHolderName, branch } =
      bankDetailsSchema.parse(req.body);

    let admin = await Admin.findOne({ email });

    if (!admin) {
      // If admin document doesn't exist, create one
      admin = await Admin.create({
        email,
        bankDetails: {
          accountNumber,
          ifscCode,
          accountHolderName,
          branch,
        },
      });
    } else {
      // Update existing bank details
      admin.bankDetails = {
        accountNumber,
        ifscCode,
        accountHolderName,
        branch,
      };
      await admin.save();
    }

    res.status(200).json({
      success: true,
      message: "Admin bank details updated successfully",
      bankDetails: admin.bankDetails,
    });
  }
);