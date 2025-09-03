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
import { Driver } from "../models/driver.model.js";

// In-memory temporary store for OTP and expiry
let adminOtp: string | null = null;
let adminOtpExpiry: Date | null = null;

// Authentication verification helper function
const verifyAuthentication = async (req: Request) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new ApiError(401, "No token provided");
  }

  const token = authHeader.split(" ")[1];
  const decoded: any = jwt.verify(token, process.env.JWT_SECRET as string);

  if (!decoded || decoded.role !== "admin") {
    throw new ApiError(403, "UNAUTHORIZED_ACCESS");
  }

  // Return admin user info - you might need to adjust this based on your actual admin model
  const admin = await Admin.findOne({ email: process.env.ADMIN_EMAIL });
  
  return {
    user: admin || { _id: "admin", email: process.env.ADMIN_EMAIL },
    userType: "admin"
  };
};

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
   const users = await User.find({}, "firstName email phoneNumber vehicleNumber");

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


// get bank details
export const getBankDetailsByAdmin = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const userType = req.query.userType;

  if (!["user", "merchant", "driver"].includes(userType as string)) {
    throw new ApiError(400, "Invalid userType. Must be user, merchant or driver");
  }

  let bankDetails;

  if (userType === "driver") {
    const driver = await Driver.findById(id).select("bankDetails");
    if (!driver || !driver.bankDetails) {
      throw new ApiError(404, "Bank details not found for driver");
    }
    bankDetails = driver.bankDetails;

  } else if (userType === "merchant") {
    const merchant = await Merchant.findById(id).select("bankDetails");
    if (!merchant || !merchant.bankDetails) {
      throw new ApiError(404, "Bank details not found for merchant");
    }
    bankDetails = merchant.bankDetails;

  } else {
    const user = await User.findById(id).select("bankDetails");
    if (!user || !user.bankDetails) {
      throw new ApiError(404, "Bank details not found for user");
    }
    bankDetails = user.bankDetails;
  }

  res.status(200).json(
    new ApiResponse(200, bankDetails, "Bank details fetched successfully")
  );
});



// Global pricing model/schema - create this as a new model
const GlobalPricingSchema = new mongoose.Schema({
  pricePerKm: {
    type: Number,
    required: true,
    min: [1, "Price per km must be at least ₹1"],
    max: [1000, "Price per km cannot exceed ₹1000"]
  },
  effectiveFrom: {
    type: Date,
    required: true,
    default: Date.now
  },
  setBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Admin", // Reference to admin who set the price
    required: true
  },
  reason: {
    type: String,
    default: "Global pricing update"
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { 
  timestamps: true 
});

// Ensure only one active pricing at a time
GlobalPricingSchema.index({ isActive: 1 });

export const GlobalPricing = mongoose.model("GlobalPricing", GlobalPricingSchema);

// Validation schema
const setPricingSchema = z.object({
  pricePerKm: z.number().positive("Price per km must be positive").max(1000, "Price per km cannot exceed ₹1000"),
  effectiveFrom: z.string().optional().refine((date) => {
    if (!date) return true;
    const parsedDate = new Date(date);
    return parsedDate >= new Date();
  }, "Effective date must be in the future or today"),
  reason: z.string().optional()
});

// Set global pricing for all drivers
export const setGlobalPricing = asyncHandler(async (req: Request, res: Response) => {
  try {
    console.log("=== SET GLOBAL PRICING DEBUG ===");
    console.log("Request body:", req.body);
    console.log("================================");

    const authResult = await verifyAuthentication(req);
    
    // Check if user is admin
    if (authResult.userType !== "admin") {
      throw new ApiError(403, "Only administrators can set global pricing");
    }

    const validatedData = setPricingSchema.parse(req.body);
    const effectiveDate = validatedData.effectiveFrom ? new Date(validatedData.effectiveFrom) : new Date();

    const session = await mongoose.startSession();
    let newPricing: any = null; 

    try {
      await session.withTransaction(async () => {
        // Deactivate all existing pricing
        await GlobalPricing.updateMany(
          { isActive: true },
          { 
            $set: { 
              isActive: false,
              deactivatedAt: new Date(),
              deactivatedBy: String(authResult.user._id)
            }
          },
          { session }
        );

        // Create new global pricing
        const pricingArray = await GlobalPricing.create([{
          pricePerKm: validatedData.pricePerKm,
          effectiveFrom: effectiveDate,
          setBy: String(authResult.user._id),
          reason: validatedData.reason || "Global pricing update",
          isActive: true
        }], { session });

        newPricing = pricingArray[0]; // Get the first (and only) element
      });

      await session.commitTransaction();

      // TypeScript now knows newPricing is not null here because the transaction succeeded
      if (!newPricing) {
        throw new ApiError(500, "Failed to create pricing record");
      }

      console.log(`Global pricing set to ₹${validatedData.pricePerKm}/km`);

      res.status(200).json(
        new ApiResponse(
          200,
          { 
            pricing: newPricing,
            appliesTo: "All drivers",
            effectiveFrom: effectiveDate
          },
          `Global pricing set to ₹${validatedData.pricePerKm}/km for all drivers`
        )
      );

    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }

  } catch (error: unknown) {
    console.error("=== SET GLOBAL PRICING ERROR ===");
    console.error("Error:", error);
    console.error("===============================");
    
    if (error instanceof z.ZodError) {
      throw new ApiError(400, `Validation failed: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
    }
    
    if (error instanceof ApiError) {
      throw error;
    }
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    throw new ApiError(500, `Failed to set global pricing: ${errorMessage}`);
  }
});

export const getCurrentPricePerKm = async (): Promise<number> => {
  try {
    const currentPricing = await GlobalPricing.findOne({ isActive: true });
    return currentPricing?.pricePerKm || 10; 
  } catch (error) {
    console.error("Error getting current price per km:", error);
    return 10; 
  }
};

export const getGlobalPricing = asyncHandler(async (req: Request, res: Response) => {
  try {
    // Find latest active global pricing
    const activePricing = await GlobalPricing.findOne({ isActive: true })
      .sort({ effectiveFrom: -1 }) // In case multiple, pick the latest
      .lean();

    if (!activePricing) {
      throw new ApiError(404, "No active global pricing found");
    }

    res.status(200).json(
      new ApiResponse(
        200,
        {
          pricePerKm: activePricing.pricePerKm,
          effectiveFrom: activePricing.effectiveFrom,
          setBy: activePricing.setBy,
          reason: activePricing.reason,
        },
        "Current global pricing fetched successfully"
      )
    );
  } catch (error: unknown) {
    console.error("=== GET GLOBAL PRICING ERROR ===");
    console.error(error);
    console.error("================================");

    if (error instanceof ApiError) {
      throw error;
    }

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    throw new ApiError(500, `Failed to fetch global pricing: ${errorMessage}`);
  }
});