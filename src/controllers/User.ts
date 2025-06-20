import { Request, Response, NextFunction } from "express";
import { User } from "../models/user.model.js";
import { sendEmail, generateOTP,getOtpExpiry } from "../utils/mailer.utils.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

export const registerUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { phoneNumber, password, firstName, lastName, email, country, state, zipCode, userType } = req.body;

    const existingUser = await User.findOne({ phoneNumber });
    if (existingUser) {
      res.status(400).json({ success: false, message: "Phone number already registered" });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const otp = generateOTP();
    const otpExpiry = getOtpExpiry();

    const newUser = await User.create({
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

    await sendEmail(email, "Your Registration OTP", `Your OTP is: ${otp}`);

    const token = jwt.sign(
      { _id: newUser._id, userType: newUser.userType },
      process.env.JWT_SECRET as string,
      { expiresIn: "7d" }
    );
   console.log("Saved OTP in DB:", newUser.otp);


    res.status(201).json({
      success: true,
      message: "User registered successfully, OTP sent to email",
      token,
    });
  } catch (error) {
    next(error);
  }
};


export const verifyOtp = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { otp } = req.body;
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).json({ success: false, message: "Token missing" });
    }

    const decoded: any = jwt.verify(token, process.env.JWT_SECRET as string);
    const user = await User.findById(decoded._id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (user.isVerified) {
      return res.status(400).json({ success: false, message: "User already verified" });
    }

    if (user.otp !== otp) {
      return res.status(400).json({ success: false, message: "Invalid OTP" });
    }

    if (user.otpExpiry && user.otpExpiry < new Date()) {
      return res.status(400).json({ success: false, message: "OTP expired" });
    }

    user.isVerified = true;
    user.otp = undefined;
    user.otpExpiry = undefined;
    await user.save();
    

    res.status(200).json({ success: true, message: "Account verified successfully" });
  } catch (error) {
    next(error);
  }
};