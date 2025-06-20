import { Request, Response, NextFunction } from "express";
import { User } from "../models/user.model.js";
import { ApiError } from "../utils/";

export const registerUser = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const {
      phoneNumber,
      password,
      confirmPassword,
      firstName,
      lastName,
      email,
      country,
      state,
      zipCode,
      userType,
    } = req.body;

    // Validate required fields
    if (
      !phoneNumber ||
      !password ||
      !confirmPassword ||
      !firstName ||
      !lastName ||
      !email ||
      !country ||
      !state ||
      !zipCode
    ) {
      throw new ApiError(400, "All fields are required.");
    }

    // Password match check
    if (password !== confirmPassword) {
      throw new ApiError(400, "Password and Confirm Password do not match.");
    }

    // Validate userType if provided
    const validUserTypes: UserType[] = ["user", "merchant", "driver"];
    if (userType && !validUserTypes.includes(userType)) {
      throw new ApiError(400, `Invalid userType. Allowed values are: ${validUserTypes.join(", ")}`);
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { phoneNumber }],
    });

    if (existingUser) {
      throw new ApiError(400, "User with given email or phone number already exists.");
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user
    const newUser = await User.create({
      phoneNumber,
      password: hashedPassword,
      firstName,
      lastName,
      email,
      country,
      state,
      zipCode,
      userType: userType || "user", // default to 'user' if not provided
    });

    // Respond with success
    res.status(201).json(
      new ApiResponse(201, newUser, "User registered successfully.")
    );
  }
);
