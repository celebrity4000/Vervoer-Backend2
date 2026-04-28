import { Request, Response, NextFunction } from "express";
import { IMerchant, Merchant } from "../models/merchant.model.js";
import { Driver, IDriver } from "../models/driver.model.js";
import { IUser, User } from "../models/normalUser.model.js";
import { sendEmail, generateOTP, getOtpExpiry } from "../utils/mailer.utils.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { registerUserSchema } from "../validators/userValidators.js";
import { z } from "zod/v4";
import { ApiError } from "../utils/apierror.js";
import { jwtEncode } from "../utils/jwt.js";
import { verifyAuthentication } from "../middleware/verifyAuthhentication.js";
import axios from "axios";
import { asyncHandler } from "../utils/asynchandler.js";
import { BlacklistedToken } from "../models/blacklistedToken.model.js";
import { BankDetailsSchema } from "../models/bankDetails.model.js";
import { ApiResponse } from "../utils/apirespone.js";
import  uploadToCloudinary  from "../utils/cloudinary.js";
import { ZodError } from "zod";
import mongoose , {Model} from "mongoose";

// import 

export const registerUser = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const {
      phoneNumber,
      password,
      firstName,
      lastName,
      email,
      country,
      state,
      zipCode,
      userType,
      vehicleNumber, 
    } = registerUserSchema.parse(req.body);

    if (!password) {
      throw new ApiError(400, "PASSWORD_REQUIRED");
    }

    let existingUser = null;
    if (userType === "merchant") {
      existingUser = await Merchant.findOne({ $or: [{ phoneNumber }, { email }] });
    } else if (userType === "driver") {
      existingUser = await Driver.findOne({ $or: [{ phoneNumber }, { email }] });
    } else {
      existingUser = await User.findOne({ $or: [{ phoneNumber }, { email }] });
    }

    if (existingUser) {
      throw new ApiError(400, "USER_ALREADY_EXISTS");
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const otp = generateOTP();
    const otpExpiry = getOtpExpiry();

    let newUser = null;
    if (userType === "merchant") {
      newUser = await Merchant.create({
        phoneNumber,
        password: hashedPassword,
        firstName,
        lastName,
        email,
        country,
        state,
        zipCode,
        userType,
        otp,
        otpExpiry,
      });
    } else if (userType === "driver") {
      newUser = await Driver.create({
        phoneNumber,
        password: hashedPassword,
        firstName,
        lastName,
        email,
        country,
        state,
        zipCode,
        userType,
        otp,
        otpExpiry,
      });
    } else {
      newUser = await User.create({
        phoneNumber,
        password: hashedPassword,
        firstName,
        lastName,
        email,
        country,
        state,
        zipCode,
        userType,
        otp,
        otpExpiry,
        ...(vehicleNumber?.trim() && {
          vehicleNumber: vehicleNumber.trim().toUpperCase(),
        }),
      });
    }

    sendEmail(
      email,
      "Your Registration OTP",
      `Your OTP is: ${otp}. This OTP will expire in 5 minutes.`
    ).catch((error) => {
      console.error("Failed to send OTP email:", error);
    });

    const token = jwtEncode({
      userId: newUser._id,
      userType: userType,
    });

    res.status(201).json({
      success: true,
      message: "User registered successfully, OTP sent to email",
      token,
      data: {
        userId: newUser._id,
        email: newUser.email,
        phoneNumber: newUser.phoneNumber,
        userType: userType,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ApiError(400, "INVALID_DATA");
    }
    next(error);
  }
};

export const verifyOtp = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { otp } = req.body;

    if (!otp) {
      throw new ApiError(400, "OTP_REQUIRED");
    }

    const authResult = await verifyAuthentication(req);
    const user = authResult?.user;

    if (!user) {
      throw new ApiError(404, "USER_NOT_FOUND");
    }

    if (user.isVerified) {
      throw new ApiError(400, "USER_ALREADY_VERIFIED");
    }

    if (user.otp !== otp) {
      throw new ApiError(400, "INVALID_OTP");
    }

    if (user.otpExpiry && user.otpExpiry < new Date()) {
      throw new ApiError(400, "OTP_EXPIRED");
    }

    // Mark user as verified
    user.isVerified = true;
    user.otp = undefined;
    user.otpExpiry = undefined;
    await user.save();

    res.status(200).json({
      success: true,
      message: "Account verified successfully",
      data: {
        userId: user._id,
        email: user.email,
        phoneNumber: user.phoneNumber,
        isVerified: user.isVerified,
      },
    });
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new ApiError(401, "TOKEN_EXPIRED");
    } else if (error instanceof jwt.JsonWebTokenError) {
      throw new ApiError(401, "UNAUTHORIZED_ACCESS");
    }
    next(error);
  }
};


// socialRegistration
export const socialRegisterSchema = z.object({
  provider: z.enum(["google", "facebook"]),
  token: z.string(),
  userType: z.enum(["user", "driver", "merchant"]),
});

export const socialRegister = asyncHandler(async (req: Request, res: Response) => {
 
  const { provider, token, userType } = socialRegisterSchema.parse(req.body);

  let socialUser;

  // Verify Google token
  if (provider === "google") {
    const response = await axios.get(
      `https://www.googleapis.com/oauth2/v3/tokeninfo?id_token=${token}`
    );
    socialUser = response.data;

  // Verify Facebook token
  } else if (provider === "facebook") {
    const response = await axios.get(
      `https://graph.facebook.com/me?fields=id,name,email&access_token=${token}`
    );
    socialUser = response.data;

  } else {
    throw new ApiError(400, "Unsupported provider");
  }

  if (!socialUser.email) {
    throw new ApiError(400, "Email not found in social profile");
  }

  let existingUser;
  if (userType === "merchant") {
    existingUser = await Merchant.findOne({ email: socialUser.email });
  } else if (userType === "driver") {
    existingUser = await Driver.findOne({ email: socialUser.email });
  } else {
    existingUser = await User.findOne({ email: socialUser.email });
  }

  let newUser;

  if (!existingUser) {
    const baseData = {
      email: socialUser.email,
      firstName: socialUser.name?.split(" ")[0] || "",
      lastName: socialUser.name?.split(" ")[1] || "",
      loginType: provider,
      socialId: socialUser.sub || socialUser.id,
      isVerified: true,
      userType: userType, 
    };

    if (userType === "merchant") {
      newUser = await Merchant.create(baseData);
    } else if (userType === "driver") {
      newUser = await Driver.create(baseData);
    } else {
      newUser = await User.create(baseData);
    }
  } else {
    newUser = existingUser;
  }

  const jwtToken = jwtEncode({ userId: newUser._id, userType });

  res.status(200).json({
    success: true,
    message: "Social login successful",
    token: jwtToken,
  });
});


export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  userType: z.enum(["user", "merchant", "driver"]),
});

export const loginUser = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const { email, password, userType } = loginSchema.parse(req.body);

    let existingUser: any = null;

    if (userType === "merchant") {
      existingUser = await Merchant.findOne({ email });
    } else if (userType === "driver") {
      existingUser = await Driver.findOne({ email });
    } else {
      existingUser = await User.findOne({ email });
    }

    if (!existingUser) {
      throw new ApiError(404, "User not found");
    }

    if (!existingUser.password) {
      throw new ApiError(400, "Password login not available for this account");
    }

    // ✅ Add this check
    if (!existingUser.isVerified) {
      throw new ApiError(403, "Please verify your email before logging in");
    }

    const isMatch = await bcrypt.compare(password, existingUser.password);
    if (!isMatch) {
      throw new ApiError(401, "Invalid email or password");
    }

    const token = jwtEncode({ userId: existingUser._id, userType });

    res.status(200).json({
      success: true,
      message: "Login successful",
      user: existingUser,
      userType,
      token,
    });
  }
);


// logout User
export const logoutUser = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ success: false, message: "No token provided" });
      return;
    }

    const token = authHeader.split(" ")[1];

    const decoded: any = jwt.decode(token);
    if (!decoded || !decoded.exp) {
      res.status(400).json({ success: false, message: "Invalid token" });
      return;
    }

    await BlacklistedToken.create({
      token,
      expiresAt: new Date(decoded.exp * 1000),
    });

    res.status(200).json({ success: true, message: "Logged out successfully" });
  }
);



export const forgotPasswordSchema = z.object({
  email: z.string().email(),
  userType: z.enum(["user", "merchant", "driver"]),
});

export const verifyOtpSchema = z.object({
  email: z.string().email(),
  otp: z.string().length(6),
  userType: z.enum(["user", "merchant", "driver"]),
});

export const resetPasswordSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  confirmPassword: z.string().min(6),
  userType: z.enum(["user", "merchant", "driver"]),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});


export const verifyForgotPasswordOtpSchema = z.object({
  email: z.string().email(),
  otp: z.string().length(6),
  userType: z.enum(["user", "merchant", "driver"]),
});


const getUserModel = (type: string): mongoose.Model<any> => {
  if (type === "merchant") return Merchant;
  if (type === "driver") return Driver;
  return User;
};

//  Send OTP to email
export const sendForgotPasswordOtp = asyncHandler( async (req: Request, res: Response, next: NextFunction) => {
    const { email, userType } = forgotPasswordSchema.parse(req.body);
    const UserModel = getUserModel(userType);

    const user = await UserModel.findOne({ email });
    if (!user) {
      throw new ApiError(404, "User not found");
    }
    const otp = generateOTP();
    const otpExpiry = getOtpExpiry();
    if(!user.otpExpiry||  !user.otp ||  new Date(user.otpExpiry) <= new Date()){
      console.log("Genrated OTP:" ,otp)
      user.otp = otp;
      user.otpExpiry = otpExpiry;
      await user.save();
    }
    console.log("The OTP is:", user.otp);
    await sendEmail(email, "Password Reset OTP", `Your OTP is: ${user.otp}`);

    res.status(200).json({ success: true, message: "OTP sent to email" });
});

// Verify OTP



export const verifyForgotPasswordOtpHandler = asyncHandler(async (req: Request, res: Response) => {
  const { email, otp, userType } = verifyForgotPasswordOtpSchema.parse(req.body);
  
  const UserModel = getUserModel(userType);
  const user = await UserModel.findOne({ email });
  
  if (!user) {
    throw new ApiError(404, "User not found");
  }
  
  if (user.otp !== otp) {
    throw new ApiError(400, "Invalid OTP");
  }
  
  if (user.otpExpiry && user.otpExpiry < new Date()) {
    throw new ApiError(400, "OTP expired");
  }
  
  user.otp = null;
  user.otpExpiry = null;
  user.isVerified = true;
  await user.save();
  
  res.status(200).json({ success: true, message: "OTP verified successfully" });
});
// Reset Password
export const resetForgottenPassword = asyncHandler(async (req: Request, res: Response) => {
  const { email, password, userType, confirmPassword } = resetPasswordSchema.parse(req.body);

  const UserModel = getUserModel(userType);
  const user = await UserModel.findOne({ email });

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  if (!user.isVerified) {
    throw new ApiError(403, "OTP verification required before resetting password");
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  user.password = hashedPassword;
  // user.isVerified = false; 

  await user.save();

  const newToken = jwtEncode({ userId: user._id, userType });
  res.status(200).json({ success: true, message: "Password reset successfully" });
});


// bank details
const bankDetailsSchema = z.object({
  accountNumber: z.string().min(6),
  ifscCode: z.string().min(4),
  accountHolderName: z.string(),
  branch: z.string(),
});
export const updateBankDetails = asyncHandler(
  async (req: Request, res: Response) => {
    const userInfo = await verifyAuthentication(req);

    const { accountNumber, ifscCode, accountHolderName, branch } =
      bankDetailsSchema.parse(req.body);

    userInfo.user.bankDetails = {
      accountNumber,
      ifscCode,
      accountHolderName,
      branch,
    };

    await userInfo.user.save();

    res.status(200).json({
      success: true,
      message: "Bank details updated successfully",
      bankDetails: userInfo.user.bankDetails,
    });
  }
);


// reset password
const resetPasswordSchemaUser= z.object({
  currentPassword: z.string().min(6),
  newPassword: z.string().min(6),
  confirmNewPassword: z.string().min(6),
});

export const resetUserPassword = asyncHandler(
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { user, userType } = await verifyAuthentication(req);

    const { currentPassword, newPassword, confirmNewPassword } =
      resetPasswordSchemaUser.parse(req.body);

    if (newPassword !== confirmNewPassword) {
      throw new ApiError(400, "NEW_PASSWORDS_DO_NOT_MATCH");
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);

    if (!isMatch) {
      throw new ApiError(400, "CURRENT_PASSWORD_IS_INCORRECT");
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;

    await user.save();

    res.status(200).json(
      new ApiResponse(200, null, "Password updated successfully.")
    );
  }
);

// profile pic

const imageUploadSchema = z.object({});

export const uploadProfileImage = asyncHandler(async (req: Request, res: Response) => {
  const user = req.authUser?.user;

  if (!user) {
    res.status(401).json({ success: false, message: "Unauthorized user" });
    return;
  }

  if (!req.files || !('profileImage' in req.files)) {
    res.status(400).json({ success: false, message: "No profile image uploaded" });
    return;
  }

  const file = (req.files as { [fieldname: string]: Express.Multer.File[] })['profileImage'][0];

  const result = await uploadToCloudinary(file.buffer);

  user.profileImage = result.secure_url;
  await user.save();

  res.status(200).json(
    new ApiResponse(200, user, "Profile image uploaded successfully")
  );
});




export const getUserProfile = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.authUser?.user?._id;
  const userType = req.authUser?.userType;

  if (!userId) {
    res.status(401).json({ success: false, message: "Unauthorized user" });
    return;
  }

  let user: any = null;

  if (userType === 'user') {
    user = await User.findById(userId).select("firstName lastName email phoneNumber country state zipCode profileImage vehicleNumber");
  } else if (userType === 'merchant') {
    user = await Merchant.findById(userId).select("firstName lastName email phoneNumber profileImage country state zipCode");
  } else if (userType === 'driver') {
    user = await Driver.findById(userId).select("firstName lastName email phoneNumber profileImage country state zipCode");
  }

  if (!user) {
    res.status(404).json({ success: false, message: "User not found" });
    return;
  }

  res.status(200).json(new ApiResponse(200, user, "User profile fetched successfully"));
});


const partialEditSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  phoneNumber: z.string().min(10).optional(),
  country: z.string().optional(),
  state: z.string().optional(),
  zipCode: z.string().optional(),
  vehicleNumber: z.string().optional(), 
});

export const editUserProfile = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req.authUser?.user as any)?._id;
  const userType = req.authUser?.userType;

  if (!userId || !userType) {
    throw new ApiError(401, "Unauthorized user");
  }

  let validatedData;
  try {
    validatedData = partialEditSchema.parse(req.body);
  } catch (zodError) {
    console.log("ZOD ERROR:", zodError);
    throw new ApiError(400, "INVALID_DATA");
  }

  const updateFields: Record<string, any> = { ...validatedData };

  if (req.files && "profileImage" in req.files) {
    const file = (req.files as { [key: string]: Express.Multer.File[] })["profileImage"]?.[0];
    if (file) {
      const result = await uploadToCloudinary(file.buffer);
      updateFields.profileImage = result.secure_url;
    }
  }

  let ModelToUpdate: Model<any>;
  if (userType === "merchant") ModelToUpdate = Merchant;
  else if (userType === "driver") ModelToUpdate = Driver;
  else ModelToUpdate = User;

  const updatedUser = await ModelToUpdate.findByIdAndUpdate(
    userId,
    { $set: updateFields },
    { new: true }
  ).select("firstName lastName email phoneNumber country state zipCode profileImage userType vehicleNumber");

  if (!updatedUser) {
    throw new ApiError(404, "User not found");
  }

  // ✅ THE FIX — actually send HTTP response
  res.status(200).json(new ApiResponse(200, updatedUser, "Profile updated successfully"));
});



const deleteAccountSchema = z.object({
  email: z.string().email("Invalid email address"),
});

export const deleteAccount = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const { email } = deleteAccountSchema.parse(req.body);

    if (!req.authUser) {
      throw new ApiError(401, "UNAUTHORIZED_REQUEST");
    }

    const { user, userType } = req.authUser;
    const userId = user._id;

    let ModelToUse: Model<any>; // <-- fix type here

    if (userType === "merchant") {
      ModelToUse = Merchant;
    } else if (userType === "driver") {
      ModelToUse = Driver;
    } else {
      ModelToUse = User;
    }

    const foundUser = await ModelToUse.findById(userId);
    if (!foundUser) {
      throw new ApiError(404, "USER_NOT_FOUND");
    }

    if (foundUser.email !== email) {
      throw new ApiError(400, "EMAIL_DOES_NOT_MATCH");
    }

    await foundUser.deleteOne();

    res.status(200).json(
      new ApiResponse(200, null, "Account deleted successfully")
    );
  }
);


// bank details retrieval
export const getBankDetails = asyncHandler(async (req: Request, res: Response) => {
  const userInfo = await verifyAuthentication(req);

  let bankDetails;

  if (userInfo.userType === "driver") {
    const driver = await Driver.findById(userInfo.user._id).select("bankDetails");
    if (!driver || !driver.bankDetails) {
      res.status(404).json(new ApiResponse(404, null, "Bank details not found for driver"));
      return;
    }
    bankDetails = driver.bankDetails;

  } else if (userInfo.userType === "merchant") {
    const merchant = await Merchant.findById(userInfo.user._id).select("bankDetails");
    if (!merchant || !merchant.bankDetails) {
      res.status(404).json(new ApiResponse(404, null, "Bank details not found for merchant"));
      return;
    }
    bankDetails = merchant.bankDetails;

  } else {
    const user = await User.findById(userInfo.user._id).select("bankDetails");
    if (!user || !user.bankDetails) {
      res.status(404).json(new ApiResponse(404, null, "Bank details not found for user"));
      return;
    }
    bankDetails = user.bankDetails;
  }

  res.status(200).json(new ApiResponse(200, bankDetails, "Bank details retrieved successfully"));
});


const addSubAccountSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  label: z.string().min(1).max(50).optional(), // e.g. "Manager", "Cashier"
});
 
const removeSubAccountSchema = z.object({
  subAccountId: z.string().min(1),
});
 
const subAccountLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});
 
// ── Add Sub-Account (Merchant only) ───────────────────────────────────────
 
export const addMerchantSubAccount = asyncHandler(
  async (req: Request, res: Response) => {
    const { user, userType } = await verifyAuthentication(req);
 
    if (userType !== "merchant") {
      throw new ApiError(403, "Only merchants can add sub-accounts");
    }
 
    const merchant = await Merchant.findById(user._id);
    if (!merchant) throw new ApiError(404, "Merchant not found");
 
    const { email, password, label } = addSubAccountSchema.parse(req.body);
 
    // Check duplicate across main account and existing sub-accounts
    if (merchant.email === email) {
      throw new ApiError(400, "Email already used as primary account");
    }
 
    const alreadyExists = merchant.subAccounts?.some(
      (sa: any) => sa.email === email
    );
    if (alreadyExists) {
      throw new ApiError(400, "Sub-account with this email already exists");
    }
 
    const MAX_SUB_ACCOUNTS = 10;
    if ((merchant.subAccounts?.length ?? 0) >= MAX_SUB_ACCOUNTS) {
      throw new ApiError(400, `Maximum ${MAX_SUB_ACCOUNTS} sub-accounts allowed`);
    }
 
    const hashedPassword = await bcrypt.hash(password, 10);
 
    merchant.subAccounts = merchant.subAccounts ?? [];
    merchant.subAccounts.push({
      email,
      password: hashedPassword,
      label: label ?? "",
      createdAt: new Date(),
      isActive: true,
    });
 
    await merchant.save();
 
    // Return without exposing passwords
    const sanitized = merchant.subAccounts.map((sa: any) => ({
      _id: sa._id,
      email: sa.email,
      label: sa.label,
      isActive: sa.isActive,
      createdAt: sa.createdAt,
    }));
 
    res
      .status(201)
      .json(
        new ApiResponse(201, sanitized, "Sub-account added successfully")
      );
  }
);
 
// ── List Sub-Accounts ──────────────────────────────────────────────────────
 
export const getMerchantSubAccounts = asyncHandler(
  async (req: Request, res: Response) => {
    const { user, userType } = await verifyAuthentication(req);
 
    if (userType !== "merchant") {
      throw new ApiError(403, "Only merchants can view sub-accounts");
    }
 
    const merchant = await Merchant.findById(user._id).select("subAccounts");
    if (!merchant) throw new ApiError(404, "Merchant not found");
 
    const sanitized = (merchant.subAccounts ?? []).map((sa: any) => ({
      _id: sa._id,
      email: sa.email,
      label: sa.label,
      isActive: sa.isActive,
      createdAt: sa.createdAt,
    }));
 
    res
      .status(200)
      .json(
        new ApiResponse(200, sanitized, "Sub-accounts fetched successfully")
      );
  }
);
 
// ── Toggle Sub-Account Active/Inactive ────────────────────────────────────
 
export const toggleSubAccountStatus = asyncHandler(
  async (req: Request, res: Response) => {
    const { user, userType } = await verifyAuthentication(req);
 
    if (userType !== "merchant") {
      throw new ApiError(403, "Only merchants can manage sub-accounts");
    }
 
    const { subAccountId } = removeSubAccountSchema.parse(req.body);
 
    const merchant = await Merchant.findById(user._id);
    if (!merchant) throw new ApiError(404, "Merchant not found");
 
    const subAccount = merchant.subAccounts?.id(subAccountId);
    if (!subAccount) throw new ApiError(404, "Sub-account not found");
 
    subAccount.isActive = !subAccount.isActive;
    await merchant.save();
 
    res.status(200).json(
      new ApiResponse(
        200,
        { _id: subAccount._id, isActive: subAccount.isActive },
        `Sub-account ${subAccount.isActive ? "activated" : "deactivated"}`
      )
    );
  }
);
 
// ── Remove Sub-Account ────────────────────────────────────────────────────
 
export const removeMerchantSubAccount = asyncHandler(
  async (req: Request, res: Response) => {
    const { user, userType } = await verifyAuthentication(req);
 
    if (userType !== "merchant") {
      throw new ApiError(403, "Only merchants can remove sub-accounts");
    }
 
    const { subAccountId } = removeSubAccountSchema.parse(req.body);
 
    const merchant = await Merchant.findById(user._id);
    if (!merchant) throw new ApiError(404, "Merchant not found");
 
    const before = merchant.subAccounts?.length ?? 0;
    merchant.subAccounts = merchant.subAccounts?.filter(
      (sa: any) => sa._id.toString() !== subAccountId
    );
 
    if ((merchant.subAccounts?.length ?? 0) === before) {
      throw new ApiError(404, "Sub-account not found");
    }
 
    await merchant.save();
 
    res
      .status(200)
      .json(new ApiResponse(200, null, "Sub-account removed successfully"));
  }
);
 
// ── Sub-Account Login ─────────────────────────────────────────────────────
// Sub-account holders log in with this endpoint; they receive a JWT scoped
// to the parent merchant with a subAccountId claim.
 
export const subAccountLogin = asyncHandler(
  async (req: Request, res: Response) => {
    const { email, password } = subAccountLoginSchema.parse(req.body);
 
    // Search all merchants for a matching sub-account email
    const merchant = await Merchant.findOne({
      "subAccounts.email": email,
    });
 
    if (!merchant) {
      throw new ApiError(404, "Invalid credentials");
    }
 
    const subAccount = merchant.subAccounts?.find(
      (sa: any) => sa.email === email
    );
 
    if (!subAccount) throw new ApiError(404, "Invalid credentials");
 
    if (!subAccount.isActive) {
      throw new ApiError(403, "This sub-account has been deactivated");
    }
 
    const isMatch = await bcrypt.compare(password, subAccount.password);
    if (!isMatch) throw new ApiError(401, "Invalid credentials");
 
    // Token carries merchant's ID + sub-account marker
    const token = jwtEncode({
      userId: merchant._id,
      userType: "merchant",
      subAccountId: subAccount._id,
      subAccountEmail: subAccount.email,
    });
 
    res.status(200).json(
      new ApiResponse(200, { token, merchantId: merchant._id }, "Sub-account login successful")
    );
  }
);
 
