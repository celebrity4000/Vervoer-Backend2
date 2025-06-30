import { Request, Response } from "express";
import { Driver } from "../models/driver.model.js";
import { ApiError } from "../utils/apierror.js";
import { ApiResponse } from "../utils/apirespone.js";
import uploadToCloudinary from "../utils/cloudinary.js";
import { asyncHandler } from "../utils/asynchandler.js";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { jwtEncode } from "../utils/jwt.js";  // your existing JWT helper

// Driver registration schema
const DriverRegistrationSchema = z.object({
  phoneNumber: z.string().min(10),
  email: z.string().email(),
  password: z.string().min(6),
  firstName: z.string(),
  middleName: z.string().optional(),
  userType: z.literal("driver"),
  lastName: z.string(),
  dob: z.string(),
  gender: z.string(),
  licenseNumber: z.string(),
  expirationDate: z.string(),
  availability: z.string().transform((val) => val.split(",")),
  kidsFriendly: z.coerce.boolean().optional(),
  carSeatsAvailable: z.coerce.boolean().optional(),
  isBooked: z.coerce.boolean().optional(),

  // vehicle info
  vehicleInfo: z.object({
    vehicleBrand: z.string(),
    vehicleModel: z.string(),
    vehicleYear: z.coerce.number(),
    noOfDoors: z.coerce.number(),
    vehicleColor: z.string(),
    noOfSeats: z.coerce.number(),
    noOfBooster: z.coerce.number(),
    vehicleNumber: z.string(),
    registrationNumber: z.string(),
    insuranceProviderCompany: z.string(),
    insuranceNumber: z.string(),
  }),

  // bank details
  bankDetails: z.object({
    accountHolderName: z.string(),
    accountNumber: z.string(),
    routingNumber: z.string(),
    bankName: z.string(),
  }),

  address: z.string(),
  state: z.string(),
  country: z.string(),
  zipCode: z.string(),

  attestation: z.object({
    consentBackgroundCheck: z.coerce.boolean(),
    completeASafetyHoldings: z.coerce.boolean(),
    completeACheckInc: z.coerce.boolean(),
    noDrivingUnderInfluence: z.coerce.boolean(),
    noDiscriminateUser: z.coerce.boolean(),
    willingVideoForSecurity: z.coerce.boolean(),
    ongoingBackgroundAndLicenseCheck: z.coerce.boolean(),
    obeyTrafficLaws: z.coerce.boolean(),
    noAggressiveDriving: z.coerce.boolean(),
    noUnsafeExperience: z.coerce.boolean(),
    agreeToTerms: z.coerce.boolean(),
    keepVehicleGoodCondition: z.coerce.boolean(),
    completeOnboarding: z.coerce.boolean(),
    noFightWithUser: z.coerce.boolean(),
    infoProvidedIsTrue: z.coerce.boolean(),
    attestationDate: z.string(),
  }),
});

// Register driver controller
export const registerDriver = asyncHandler(async (req: Request, res: Response) => {
  if (typeof req.body.attestation === "string") {
    req.body.attestation = JSON.parse(req.body.attestation);
  }
  if (typeof req.body.vehicleInfo === "string") {
    req.body.vehicleInfo = JSON.parse(req.body.vehicleInfo);
  }
  if (typeof req.body.bankDetails === "string") {
    req.body.bankDetails = JSON.parse(req.body.bankDetails);
  }

  const validatedData = DriverRegistrationSchema.parse(req.body);

  const hashedPassword = await bcrypt.hash(validatedData.password, 10);

  const imageFields = [
    "driverLicenseImage",
    "vehicleInspectionImage",
    "vehicleInsuranceImage",
    "driverCertificationImage",
    "creditCardImage",
    "localCertificate",
    "driveProfileImage",
    "electronicSignature",
  ];

  const uploadedImages: any = {};
  for (const field of imageFields) {
    if (req.files && field in req.files) {
      const file = (req.files as any)[field][0];
      const result = await uploadToCloudinary(file.buffer);
      uploadedImages[field] = result.secure_url;
    } else {
      throw new ApiError(400, `${field} is required`);
    }
  }

  const driver = await Driver.create({
    userType: validatedData.userType,
    phoneNumber: validatedData.phoneNumber,
    email: validatedData.email,
    password: hashedPassword,
    firstName: validatedData.firstName,
    middleName: validatedData.middleName,
    lastName: validatedData.lastName,
    licenseNumber: validatedData.licenseNumber,
    expirationDate: validatedData.expirationDate,
    driverLicenseImage: uploadedImages.driverLicenseImage,
    availability: validatedData.availability,
    kidsFriendly: validatedData.kidsFriendly || false,
    carSeatsAvailable: validatedData.carSeatsAvailable || false,
    driveProfileImage: uploadedImages.driveProfileImage,
    isBooked: validatedData.isBooked || false,

    vehicleInfo: {
      ...validatedData.vehicleInfo,
      vehicleInspectionImage: uploadedImages.vehicleInspectionImage,
      vehicleInsuranceImage: uploadedImages.vehicleInsuranceImage,
      localCertificate: uploadedImages.localCertificate,
    },

    driverCertificationImage: uploadedImages.driverCertificationImage,

    bankDetails: {
      ...validatedData.bankDetails,
      creditCardImage: uploadedImages.creditCardImage,
    },

    attestation: {
      ...validatedData.attestation,
      electronicSignature: uploadedImages.electronicSignature,
    },

    address: validatedData.address,
    state: validatedData.state,
    country: validatedData.country,
    zipCode: validatedData.zipCode,
  });

  res.status(201).json(new ApiResponse(201, { driver }, "Driver registered successfully"));
});

// login driver 

export const loginDriver = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new ApiError(400, "Email and password are required");
  }

  const driver = await Driver.findOne({ email });
  if (!driver) {
    throw new ApiError(401, "Invalid credentials");
  }

  const isPasswordValid = await bcrypt.compare(password, driver.password);
  if (!isPasswordValid) {
    throw new ApiError(401, "Invalid credentials");
  }

  // Generate JWT token
  const token = jwtEncode({ id: driver._id, userType: "driver" });

  res.status(200).json(new ApiResponse(200, { token }, "Login successful"));
});
