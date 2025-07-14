import { Request, Response } from "express";
import { ApiError } from "../utils/apierror.js";
import { ApiResponse } from "../utils/apirespone.js";
import jwt from "jsonwebtoken";
import { User } from "../models/normalUser.model.js";
import { DryCleaner, Merchant } from "../models/merchant.model.js";
import { sendEmail,generateOTP,getOtpExpiry } from "../utils/mailer.utils.js";
import { BlacklistedToken } from "../models/blacklistedToken.model.js";
import { asyncHandler } from "../utils/asynchandler.js";
import { Admin } from "../models/adminBank.model.js";
import { z } from "zod";
import { Garage, GarageBooking } from "../models/merchant.garage.model.js";
import { ParkingLotModel } from "../models/merchant.model.js";
import mongoose from "mongoose";
import { LotRentRecordModel } from "../models/merchant.model.js";
import { ResidenceModel } from "../models/merchant.residence.model.js";

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

export const getMerchantById = asyncHandler(async (req, res) => {
  const merchant = await Merchant.findById(req.params.id);
  if (!merchant) {
    throw new ApiError(404, "Merchant not found");
  }

  res.status(200).json(new ApiResponse(200, { merchant }));
});


// garage
export const getAllGarages = asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new ApiError(401, "No token provided");
  }

  const token = authHeader.split(" ")[1];
  const decoded: any = jwt.verify(token, process.env.JWT_SECRET as string);

  if (!decoded || decoded.role !== "admin") {
    throw new ApiError(403, "UNAUTHORIZED_ACCESS");
  }

  const garages = await Garage.find().populate("owner", "name email phoneNumber");

  res.status(200).json(
    new ApiResponse(200, garages, "All garages fetched successfully")
  );
});

export const getGarageById = asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new ApiError(401, "No token provided");
  }

  const token = authHeader.split(" ")[1];
  const decoded: any = jwt.verify(token, process.env.JWT_SECRET as string);

  if (!decoded || decoded.role !== "admin") {
    throw new ApiError(403, "UNAUTHORIZED_ACCESS");
  }

  const { id } = req.params;

  const garage = await Garage.findById(id).populate("owner", "name email phoneNumber");

  if (!garage) {
    throw new ApiError(404, "Garage not found");
  }

  res.status(200).json(
    new ApiResponse(200, garage, "Garage details fetched successfully")
  );
});

export const deleteGarageById = asyncHandler(async (req, res) => {
  const garageId = req.params.id;

  const garage = await Garage.findById(garageId);
  if (!garage) {
    throw new ApiError(404, "Garage not found");
  }

  await garage.deleteOne();

  res
    .status(200)
    .json(new ApiResponse(200, null, "Garage deleted successfully"));
});

// drycleaner
export const getAllDryCleaner = asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new ApiError(401, "No token provided");
  }
  const token = authHeader.split(" ")[1];
  const decoded: any = jwt.verify(token, process.env.JWT_SECRET as string);
  if (!decoded || decoded.role !== "admin") {
    throw new ApiError(403, "UNAUTHORIZED_ACCESS");
  }
  const dryCleaners = await DryCleaner.find();
  if (!dryCleaners || dryCleaners.length === 0) {
    throw new ApiError(404, "No dry cleaners found");
  }
  res.status(200).json(
    new ApiResponse(200, dryCleaners, "All dry cleaners fetched successfully")
  );
});

export const getGarageBookingSummary = asyncHandler(async (req, res) => {
  const { garageId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(garageId)) {
    throw new ApiError(400, "Invalid Garage ID");
  }

  const result = await GarageBooking.aggregate([
    {
      $match: { garageId: new mongoose.Types.ObjectId(garageId) },
    },
    {
      $group: {
        _id: "$garageId",
        totalBookings: { $sum: 1 },
        totalAmount: { $sum: "$totalAmount" },
        slotsBooked: { $addToSet: "$bookedSlot" },
      },
    },
  ]);

  if (!result.length) {
    res.status(200).json(
      new ApiResponse(200, {
        totalBookings: 0,
        totalAmount: 0,
        slotsBooked: [],
      }, "No bookings found for this garage.")
    );
    return;
  }

  const { totalBookings, totalAmount, slotsBooked } = result[0];

  res.status(200).json(
    new ApiResponse(200, {
      totalBookings,
      totalAmount,
      slotsBooked,
    }, "Garage booking summary fetched successfully.")
  );
});


// delete parking lot
export const adminDeleteParking = asyncHandler(async (req, res) => {
  try {
    const lotId = z.string().parse(req.params.id); // from params

    const lot = await ParkingLotModel.findById(lotId);
    if (!lot) throw new ApiError(404, "NOT_FOUND");

    await lot.deleteOne();

    res
      .status(200)
      .json(new ApiResponse(200, lot, "DELETE SUCCESSFUL (Admin)"));
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ApiError(400, "INVALID_ID");
    } else throw error;
  }
});

export const adminGetBookingsByParkingLot = asyncHandler(async (req: Request, res: Response) => {
  
  const lotId = z.string().min(10).parse(req.params.id); 

  const bookings = await LotRentRecordModel.find({ lotId }).sort({ rentFrom: -1 });

  if (!bookings || bookings.length === 0) {
    throw new ApiError(404, "No bookings found for this parking lot.");
  }

  res.status(200).json(new ApiResponse(200, bookings, "Bookings fetched successfully."));
});


export const adminDeleteResidence = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const residence = await ResidenceModel.findById(id);
  if (!residence) {
    throw new ApiError(404, "Residence not found");
  }

  await residence.deleteOne();

  res.status(200).json(new ApiResponse(200, null, "Residence deleted successfully"));
});