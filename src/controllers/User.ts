import { Request, Response, NextFunction } from "express";
import { UserBaseSchemaFields } from "../models/user.model.js";
import { Merchant } from "../models/merchant.model.js";
import { Driver } from "../models/driver.model.js";
import { User } from "../models/normalUser.model.js";
import { sendEmail, generateOTP, getOtpExpiry } from "../utils/mailer.utils.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { registerUserSchema } from "../validators/userValidators.js";
import { z } from "zod/v4";
import { ApiError } from "../utils/apierror.js";

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
    } = registerUserSchema.parse(req.body);

    // const existingUser = await User.findOne({ phoneNumber });
    // if (existingUser) {
    //   res
    //     .status(400)
    //     .json({ success: false, message: "Phone number already registered" });
    //   return;
    // }

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
      // Regular user 
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
      });
    }

    await sendEmail(email, "Your Registration OTP", `Your OTP is: ${otp}`);

    const token = jwt.sign(
      { _id: newUser._id, userType: userType },
      process.env.JWT_SECRET as string,
      { expiresIn: "7d" }
    );

    res.status(201).json({
      success: true,
      message: "User registered successfully, OTP sent to email",
      token,
    });
  } catch (error) {
    if(error instanceof z.ZodError){
      throw new ApiError(400, "INVALID_DATA") ;
    }
    next(error);
  }
};

export const verifyOtp = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { otp } = req.body;
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
       res.status(401).json({ success: false, message: "Token missing" });
       return
    }

    const decoded: any = jwt.verify(token, process.env.JWT_SECRET as string);
    const user = await User.findById(decoded._id);
    if (!user) {
      res
      .status(404)
      .json({ success: false, message: "User not found" });
      return ;
    }

    if (user.isVerified) {
      res
      .status(400)
      .json({ success: false, message: "User already verified" });
      return
    }

    if (user.otp !== otp) {
      res.status(400).json({ success: false, message: "Invalid OTP" });
      return
    }

    if (user.otpExpiry && user.otpExpiry < new Date()) {
      res.status(400).json({ success: false, message: "OTP expired" });
      return ;
    }

    user.isVerified = true;
    user.otp = undefined;
    user.otpExpiry = undefined;
    await user.save();

    res
      .status(200)
      .json({ success: true, message: "Account verified successfully" });
  } catch (error) {
    next(error);
  }
};
