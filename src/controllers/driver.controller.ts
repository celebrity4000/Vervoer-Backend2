import { Request, Response } from "express";
import { Driver } from "../models/driver.model.js";
import { ApiError } from "../utils/apierror.js";
import { ApiResponse } from "../utils/apirespone.js";
import uploadToCloudinary from "../utils/cloudinary.js";
import { asyncHandler } from "../utils/asynchandler.js";
import { verifyAuthentication } from "../middleware/verifyAuthhentication.js"; 
import { z } from "zod";
import bcrypt from "bcryptjs";
import { jwtEncode } from "../utils/jwt.js";

// Driver registration schema
const BasicDriverRegistrationSchema = z.object({
  phoneNumber: z.string().min(10),
  email: z.string().email(),
  password: z.string().min(6),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  country: z.string().optional(),
  state: z.string().optional(),
  zipCode: z.string().optional(),
  userType: z.literal("driver").default("driver"),
  loginType: z.enum(["normal", "google", "facebook"]).default("normal"),
  socialId: z.string().optional(),
});

// Step 2: Complete driver details schema
const CompleteDriverDetailsSchema = z.object({
  middleName: z.string().optional(),
  licenseNumber: z.string().min(1),
  expirationDate: z.string(),
  availability: z.string().transform((val) => val.split(",")),
  kidsFriendly: z.coerce.boolean().optional(),
  carSeatsAvailable: z.coerce.boolean().optional(),

  // vehicle info
  vehicleInfo: z.object({
    vehicleBrand: z.string().min(1),
    vehicleModel: z.string().min(1),
    vehicleYear: z.coerce.number().min(1900).max(new Date().getFullYear() + 1),
    noOfDoors: z.coerce.number().min(2).max(6),
    vehicleColor: z.string().min(1),
    noOfSeats: z.coerce.number().min(1).max(50),
    noOfBooster: z.coerce.number().min(0),
    vehicleNumber: z.string().min(1),
    registrationNumber: z.string().min(1),
    insuranceProviderCompany: z.string().min(1),
    insuranceNumber: z.string().min(1),
  }),

  // bank details
  bankDetails: z.object({
    accountHolderName: z.string().min(1),
    accountNumber: z.string().min(1),
    routingNumber: z.string().min(1),
    bankName: z.string().min(1),
  }),

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
// Function to remove password from driver object
const removePasswordFromDriver = (driver: any) => {
  const { password, ...driverWithoutPassword } = driver.toObject();
  return driverWithoutPassword;
};

// Update Vehicle Information
export const updateVehicleInfo = asyncHandler(async (req: Request, res: Response) => {
  try {
    console.log("=== UPDATE VEHICLE INFO DEBUG ===");
    console.log("Request body:", req.body);
    console.log("Request files:", req.files);
    console.log("==================================");

    const authResult = await verifyAuthentication(req);
    
    if (authResult.userType !== "driver") {
      throw new ApiError(403, "Only drivers can update vehicle information");
    }

    const driverId = String(authResult.user._id);
    console.log("Authenticated driver ID:", driverId);

    // Parse vehicleInfo if it's a string
    if (typeof req.body.vehicleInfo === "string") {
      req.body.vehicleInfo = JSON.parse(req.body.vehicleInfo);
    }

    const { vehicleInfo } = req.body;

    if (!vehicleInfo) {
      throw new ApiError(400, "Vehicle information is required");
    }

    const driver = await Driver.findById(driverId);
    if (!driver) {
      throw new ApiError(404, "Driver not found");
    }

    // Handle image uploads
    const uploadedImages: any = {};
    
    const vehicleImageFields = [
      "vehicleInspectionImage",
      "vehicleInsuranceImage", 
      "localCertificate"
    ];

    // Upload new images if provided
    for (const field of vehicleImageFields) {
      if (req.files && field in req.files) {
        const file = (req.files as any)[field][0];
        const result = await uploadToCloudinary(file.buffer);
        uploadedImages[field] = result.secure_url;
      }
    }

    // Update driver's vehicle information
    const updatedVehicleInfo = {
      vehicleBrand: vehicleInfo.vehicleBrand,
      vehicleModel: vehicleInfo.vehicleModel,
      vehicleYear: vehicleInfo.vehicleYear,
      noOfDoors: vehicleInfo.noOfDoors,
      vehicleColor: vehicleInfo.vehicleColor,
      noOfSeats: vehicleInfo.noOfSeats,
      noOfBooster: vehicleInfo.noOfBooster,
      vehicleNumber: vehicleInfo.vehicleNumber,
      registrationNumber: vehicleInfo.registrationNumber,
      insuranceProviderCompany: vehicleInfo.insuranceProviderCompany,
      insuranceNumber: vehicleInfo.insuranceNumber,
      // Keep existing images or use new ones
      vehicleInspectionImage: uploadedImages.vehicleInspectionImage || driver.vehicleInfo?.vehicleInspectionImage,
      vehicleInsuranceImage: uploadedImages.vehicleInsuranceImage || driver.vehicleInfo?.vehicleInsuranceImage,
      localCertificate: uploadedImages.localCertificate || driver.vehicleInfo?.localCertificate,
    };

    const updatedDriver = await Driver.findByIdAndUpdate(
      driverId,
      {
        vehicleInfo: updatedVehicleInfo,
      },
      { new: true, runValidators: true }
    );

    if (!updatedDriver) {
      throw new ApiError(500, "Failed to update vehicle information");
    }

    const driverResponse = removePasswordFromDriver(updatedDriver);

    res.status(200).json(
      new ApiResponse(
        200,
        { driver: driverResponse },
        "Vehicle information updated successfully"
      )
    );

  } catch (error: unknown) {
    console.error("=== VEHICLE UPDATE ERROR ===");
    console.error("Error:", error);
    console.error("============================");
    
    if (error instanceof ApiError) {
      throw error;
    }
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    throw new ApiError(500, `Vehicle info update failed: ${errorMessage}`);
  }
});

// update personal details, availability, and profile image
export const updateDriverPersonalInfo = asyncHandler(async (req: Request, res: Response) => {
  try {
    const authResult = await verifyAuthentication(req);
    
    if (authResult.userType !== "driver") {
      throw new ApiError(403, "Only drivers can update personal information");
    }

    const driverId = String(authResult.user._id);
    
    // Parse JSON fields if they're strings
    if (typeof req.body.availability === "string") {
      req.body.availability = JSON.parse(req.body.availability);
    }
    if (typeof req.body.backgroudCheck === "string") {
      req.body.backgroudCheck = JSON.parse(req.body.backgroudCheck);
    }

    const driver = await Driver.findById(driverId);
    if (!driver) {
      throw new ApiError(404, "Driver not found");
    }

    // Handle driver license image upload
    let driverLicenseImage = driver.driverLicenseImage;
    if (req.files && 'driverLicenseImage' in req.files) {
      const file = (req.files as any).driverLicenseImage[0];
      const result = await uploadToCloudinary(file.buffer);
      driverLicenseImage = result.secure_url;
    }

    const updatedDriver = await Driver.findByIdAndUpdate(
      driverId,
      {
        firstName: req.body.firstName,
        middleName: req.body.middleName,
        lastName: req.body.lastName,
        email: req.body.email,
        phoneNumber: req.body.phoneNumber,
        licenseNumber: req.body.licenseNumber,
        expirationDate: new Date(req.body.expirationDate),
        driverLicenseImage: driverLicenseImage,
        availability: req.body.availability,
        kidsFriendly: req.body.kidsFriendly === 'true',
        carSeatsAvailable: req.body.carSeatsAvailable === 'true',
        backgroudCheck: req.body.backgroudCheck,
        country: req.body.country,
        state: req.body.state,
        zipCode: req.body.zipCode,
      },
      { new: true, runValidators: true }
    );

    if (!updatedDriver) {
      throw new ApiError(500, "Failed to update driver information");
    }

    const driverResponse = removePasswordFromDriver(updatedDriver);

    res.status(200).json(
      new ApiResponse(
        200,
        { driver: driverResponse },
        "Driver personal information updated successfully"
      )
    );

  } catch (error: unknown) {
    console.error("Personal info update error:", error);
    
    if (error instanceof ApiError) {
      throw error;
    }
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    throw new ApiError(500, `Personal info update failed: ${errorMessage}`);
  }
});

// bank details update
export const createDriverBankDetails = asyncHandler(async (req: Request, res: Response) => {
  try {
    console.log("=== CREATE BANK DETAILS (Registration) ===");
    console.log("Request body:", req.body);
    console.log("Request files:", req.files);
    console.log("==========================================");

    const authResult = await verifyAuthentication(req);
    
    if (authResult.userType !== "driver") {
      throw new ApiError(403, "Only drivers can create bank details");
    }

    const driverId = String(authResult.user._id);
    
    // Validate required fields
    const { accountHolderName, accountNumber, routingNumber, bankName } = req.body;
    
    if (!accountHolderName || !accountNumber || !routingNumber || !bankName) {
      throw new ApiError(400, "All bank details fields are required");
    }
    
    const driver = await Driver.findById(driverId);
    
    if (!driver) {
      throw new ApiError(404, "Driver not found");
    }

    // Handle credit card image upload - required for registration
    if (!req.files || !('creditCardImage' in req.files)) {
      throw new ApiError(400, "Credit card image is required");
    }

    const file = (req.files as any).creditCardImage[0];
    const result = await uploadToCloudinary(file.buffer);
    const creditCardImage = result.secure_url;

    // Create bank details
    const bankDetails = {
      accountHolderName,
      accountNumber,
      routingNumber,
      bankName,
      creditCardImage,
    };

    const updatedDriver = await Driver.findByIdAndUpdate(
      driverId,
      {
        bankDetails: bankDetails,
      },
      { new: true, runValidators: true }
    );

    if (!updatedDriver) {
      throw new ApiError(500, "Failed to create bank details");
    }

    const driverResponse = removePasswordFromDriver(updatedDriver);

    res.status(201).json(
      new ApiResponse(
        201,
        { driver: driverResponse },
        "Bank details created successfully"
      )
    );

  } catch (error: unknown) {
    console.error("=== BANK DETAILS CREATE ERROR ===");
    console.error("Error:", error);
    console.error("=================================");
    
    if (error instanceof ApiError) {
      throw error;
    }
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    throw new ApiError(500, `Bank details creation failed: ${errorMessage}`);
  }
});

// Driver Attestation Controller
export const submitDriverAttestation = asyncHandler(async (req: Request, res: Response) => {
  try {
    console.log("=== SUBMIT DRIVER ATTESTATION DEBUG ===");
    console.log("Request body:", req.body);
    console.log("Request files:", req.files);
    console.log("=======================================");

    const authResult = await verifyAuthentication(req);
    
    if (authResult.userType !== "driver") {
      throw new ApiError(403, "Only drivers can submit attestation");
    }

    const driverId = String(authResult.user._id);
    console.log("Authenticated driver ID:", driverId);

    // Parse attestation if it's a string (for multipart form data)
    let attestationData = req.body;
    if (typeof req.body.attestation === "string") {
      attestationData = JSON.parse(req.body.attestation);
    }

    const driver = await Driver.findById(driverId);
    if (!driver) {
      throw new ApiError(404, "Driver not found");
    }

    // Handle electronic signature upload
    let electronicSignature = "";
    if (req.files && 'electronicSignature' in req.files) {
      const file = (req.files as any).electronicSignature[0];
      const result = await uploadToCloudinary(file.buffer);
      electronicSignature = result.secure_url;
    } else {
      throw new ApiError(400, "Electronic signature is required");
    }

    // Validate attestation data
    const attestationSchema = z.object({
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
    });

    const validatedAttestation = attestationSchema.parse(attestationData);

    // Check if all required attestations are true
    const allAttestationsTrue = Object.values(validatedAttestation).every(value => value === true);
    
    if (!allAttestationsTrue) {
      throw new ApiError(400, "All attestation items must be accepted to continue");
    }

    // Update driver with attestation data
    const updatedDriver = await Driver.findByIdAndUpdate(
      driverId,
      {
        attestation: {
          ...validatedAttestation,
          electronicSignature: electronicSignature,
          attestationDate: new Date().toISOString(),
        }
      },
      { new: true, runValidators: true }
    );

    if (!updatedDriver) {
      throw new ApiError(500, "Failed to update driver attestation");
    }

    const driverResponse = removePasswordFromDriver(updatedDriver);

    res.status(200).json(
      new ApiResponse(
        200,
        { driver: driverResponse },
        "Driver attestation submitted successfully"
      )
    );

  } catch (error: unknown) {
    console.error("=== ATTESTATION SUBMISSION ERROR ===");
    console.error("Error:", error);
    console.error("===================================");
    
    if (error instanceof z.ZodError) {
      throw new ApiError(400, `Validation failed: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
    }
    
    if (error instanceof ApiError) {
      throw error;
    }
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    throw new ApiError(500, `Attestation submission failed: ${errorMessage}`);
  }
});

// Get driver attestation status (optional - to check if already submitted)
export const getDriverAttestationStatus = asyncHandler(async (req: Request, res: Response) => {
  try {
    const authResult = await verifyAuthentication(req);
    
    if (authResult.userType !== "driver") {
      throw new ApiError(403, "Only drivers can access attestation status");
    }

    const driverId = String(authResult.user._id);
    
    const driver = await Driver.findById(driverId).select('attestation');
    if (!driver) {
      throw new ApiError(404, "Driver not found");
    }

    // Check if attestation is completed
    const isAttestationCompleted = driver.attestation && 
      driver.attestation.electronicSignature && 
      driver.attestation.attestationDate &&
      Object.values(driver.attestation).filter(val => typeof val === 'boolean').every(val => val === true);

    res.status(200).json(
      new ApiResponse(
        200,
        { 
          attestation: driver.attestation,
          isCompleted: isAttestationCompleted 
        },
        "Attestation status retrieved successfully"
      )
    );

  } catch (error: unknown) {
    console.error("Attestation status error:", error);
    
    if (error instanceof ApiError) {
      throw error;
    }
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    throw new ApiError(500, `Failed to get attestation status: ${errorMessage}`);
  }
});

export const uploadDriverProfilePhoto = asyncHandler(async (req: Request, res: Response) => {
  try {
    console.log("=== UPLOAD DRIVER PROFILE PHOTO DEBUG ===");
    console.log("Request files:", req.files);
    console.log("==========================================");

    const authResult = await verifyAuthentication(req);
    
    if (authResult.userType !== "driver") {
      throw new ApiError(403, "Only drivers can upload profile photos");
    }

    const driverId = String(authResult.user._id);
    console.log("Authenticated driver ID:", driverId);

    const driver = await Driver.findById(driverId);
    if (!driver) {
      throw new ApiError(404, "Driver not found");
    }

    // Check if profile image is provided
    if (!req.files || !('profileImage' in req.files)) {
      throw new ApiError(400, "Profile image is required");
    }

    const file = (req.files as any).profileImage[0];
    
    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.mimetype)) {
      throw new ApiError(400, "Invalid file type. Only JPEG, PNG, and WebP are allowed");
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      throw new ApiError(400, "File too large. Maximum size is 5MB");
    }

    console.log("Uploading to Cloudinary...");
    const result = await uploadToCloudinary(file.buffer);
    
    if (!result || !result.secure_url) {
      throw new ApiError(500, "Failed to upload image to cloud storage");
    }

    // Update driver's profile image
    const updatedDriver = await Driver.findByIdAndUpdate(
      driverId,
      {
        profileImage: result.secure_url,
        // Also update driveProfileImage if it's the same field
        driveProfileImage: result.secure_url,
        updatedAt: new Date(),
      },
      { new: true, runValidators: true }
    );

    if (!updatedDriver) {
      throw new ApiError(500, "Failed to update driver profile");
    }

    const driverResponse = removePasswordFromDriver(updatedDriver);

    res.status(200).json(
      new ApiResponse(
        200,
        { 
          driver: driverResponse,
          profileImageUrl: result.secure_url,
        },
        "Profile photo uploaded successfully"
      )
    );

  } catch (error: unknown) {
    console.error("=== PROFILE PHOTO UPLOAD ERROR ===");
    console.error("Error:", error);
    console.error("==================================");
    
    if (error instanceof ApiError) {
      throw error;
    }
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    throw new ApiError(500, `Profile photo upload failed: ${errorMessage}`);
  }
});


export const registerDriverBasic = asyncHandler(async (req: Request, res: Response) => {
  try {
    console.log("=== REGISTER DRIVER BASIC DEBUG ===");
    console.log("Request body:", req.body);
    console.log("Request files:", req.files);
    console.log("Content-Type:", req.headers['content-type']);
    console.log("=====================================");

    if (!req.body.phoneNumber || !req.body.email || !req.body.password || 
        !req.body.firstName || !req.body.lastName) {
      throw new ApiError(400, "Missing required fields: phoneNumber, email, password, firstName, lastName");
    }

    const requestData = {
      ...req.body,
      userType: req.body.userType || "driver",
      loginType: req.body.loginType || "normal"
    };

    console.log("Prepared request data:", requestData);

    const validatedData = BasicDriverRegistrationSchema.parse(requestData);
    console.log("Validation successful:", validatedData);

    console.log("Checking for existing driver...");
    const existingDriver = await Driver.findOne({
      $or: [
        { email: validatedData.email },
        { phoneNumber: validatedData.phoneNumber }
      ]
    });

    if (existingDriver) {
      console.log("Driver already exists:", existingDriver.email);
      throw new ApiError(400, "Driver with this email or phone number already exists");
    }

    console.log("Hashing password...");
    const hashedPassword = await bcrypt.hash(validatedData.password, 10);

    console.log("Creating driver...");
    const driverData = {
      phoneNumber: validatedData.phoneNumber,
      email: validatedData.email,
      password: hashedPassword,
      firstName: validatedData.firstName,
      lastName: validatedData.lastName,
      country: validatedData.country || "",
      state: validatedData.state || "",
      zipCode: validatedData.zipCode || "",
      userType: validatedData.userType,
      loginType: validatedData.loginType,
      socialId: validatedData.socialId || "",
      isVerified: false,

      licenseNumber: "",
      expirationDate: new Date(),
      driverLicenseImage: "",
      availability: [],
      vehicleInfo: {
        vehicleBrand: "",
        vehicleModel: "",
        vehicleYear: 0,
        noOfDoors: 0,
        vehicleColor: "",
        noOfSeats: 0,
        noOfBooster: 0,
        vehicleNumber: "",
        registrationNumber: "",
        vehicleInspectionImage: "",
        vehicleInsuranceImage: "",
        localCertificate: "",
        insuranceProviderCompany: "",
        insuranceNumber: "",
      },
      driverCertificationImage: "",
      bankDetails: {
        creditCardImage: "",
        accountHolderName: "",
        accountNumber: "",
        routingNumber: "",
        bankName: "",
      },
      attestation: {
        consentBackgroundCheck: false,
        completeASafetyHoldings: false,
        completeACheckInc: false,
        noDrivingUnderInfluence: false,
        noDiscriminateUser: false,
        willingVideoForSecurity: false,
        ongoingBackgroundAndLicenseCheck: false,
        obeyTrafficLaws: false,
        noAggressiveDriving: false,
        noUnsafeExperience: false,
        agreeToTerms: false,
        keepVehicleGoodCondition: false,
        completeOnboarding: false,
        noFightWithUser: false,
        infoProvidedIsTrue: false,
        electronicSignature: "",
        attestationDate: new Date(),
      },
    };

    console.log("Driver data prepared:", JSON.stringify(driverData, null, 2));

    const driver = await Driver.create(driverData);
    console.log("Driver created successfully:", driver._id);

    console.log("Generating JWT token...");
    const token = jwtEncode({ 
      userId: String(driver._id), 
      userType: driver.userType 
    });

    const driverResponse = removePasswordFromDriver(driver);

    console.log("Registration successful for:", driver.email);

    res.status(201).json(
      new ApiResponse(
        201, 
        { 
          driver: driverResponse, 
          token,
          message: "Basic registration completed. Please complete your profile."
        }, 
        "Driver registered successfully"
      )
    );

  } catch (error: unknown) {
    console.error("=== REGISTRATION ERROR ===");
    console.error("Error type:", error?.constructor?.name);
    console.error("Error:", error);
    
    if (error instanceof z.ZodError) {
      console.error("Validation errors:", error.errors);
      throw new ApiError(400, `Validation failed: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
    }
    
    if (error instanceof ApiError) {
      throw error;
    }

    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) {
      console.error("Duplicate key error:", 'keyValue' in error ? error.keyValue : 'unknown');
      throw new ApiError(400, "Driver with this email or phone number already exists");
    }

    console.error("=========================");
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    throw new ApiError(500, `Registration failed: ${errorMessage}`);
  }
});

//  Complete Driver Profile 
export const completeDriverProfile = asyncHandler(async (req: Request, res: Response) => {
  try {
    console.log("=== COMPLETE DRIVER PROFILE DEBUG ===");
    console.log("Request body:", req.body);
    console.log("Request files:", req.files);
    console.log("=====================================");

    const authResult = await verifyAuthentication(req);
    
    if (authResult.userType !== "driver") {
      throw new ApiError(403, "Only drivers can complete driver profiles");
    }

    const driverId = String(authResult.user._id);
    console.log("Authenticated driver ID:", driverId);

    if (typeof req.body.attestation === "string") {
      req.body.attestation = JSON.parse(req.body.attestation);
    }
    if (typeof req.body.vehicleInfo === "string") {
      req.body.vehicleInfo = JSON.parse(req.body.vehicleInfo);
    }
    if (typeof req.body.bankDetails === "string") {
      req.body.bankDetails = JSON.parse(req.body.bankDetails);
    }

    const validatedData = CompleteDriverDetailsSchema.parse(req.body);

    const driver = await Driver.findById(driverId);
    if (!driver) {
      throw new ApiError(404, "Driver not found");
    }

    const requiredImageFields = [
      "driverLicenseImage",
      "vehicleInspectionImage",
      "vehicleInsuranceImage",
      "driverCertificationImage",
      "creditCardImage",
      "localCertificate",
      "electronicSignature",
    ];

    const optionalImageFields = [
      "driveProfileImage",
      "profileImage"
    ];

    const uploadedImages: any = {};

    for (const field of requiredImageFields) {
      if (req.files && field in req.files) {
        const file = (req.files as any)[field][0];
        const result = await uploadToCloudinary(file.buffer);
        uploadedImages[field] = result.secure_url;
      } else {
        throw new ApiError(400, `${field} is required`);
      }
    }

    for (const field of optionalImageFields) {
      if (req.files && field in req.files) {
        const file = (req.files as any)[field][0];
        const result = await uploadToCloudinary(file.buffer);
        uploadedImages[field] = result.secure_url;
      }
    }

    const updatedDriver = await Driver.findByIdAndUpdate(
      driverId,
      {
        middleName: validatedData.middleName,
        licenseNumber: validatedData.licenseNumber,
        expirationDate: new Date(validatedData.expirationDate),
        driverLicenseImage: uploadedImages.driverLicenseImage,
        availability: validatedData.availability,
        kidsFriendly: validatedData.kidsFriendly || false,
        carSeatsAvailable: validatedData.carSeatsAvailable || false,
        driveProfileImage: uploadedImages.driveProfileImage,
        profileImage: uploadedImages.profileImage,

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
          attestationDate: new Date(validatedData.attestation.attestationDate),
        },

        isVerified: true,
      },
      { new: true, runValidators: true }
    );

    if (!updatedDriver) {
      throw new ApiError(500, "Failed to update driver profile");
    }

    const driverResponse = removePasswordFromDriver(updatedDriver);

    res.status(200).json(
      new ApiResponse(
        200,
        { driver: driverResponse },
        "Driver profile completed successfully"
      )
    );

  } catch (error: unknown) {
    console.error("=== PROFILE COMPLETION ERROR ===");
    console.error("Error:", error);
    console.error("================================");
    
    if (error instanceof z.ZodError) {
      throw new ApiError(400, `Validation failed: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
    }
    
    if (error instanceof ApiError) {
      throw error;
    }
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    throw new ApiError(500, `Profile completion failed: ${errorMessage}`);
  }
});

// Get Driver Profile
export const getDriverProfile = asyncHandler(async (req: Request, res: Response) => {
  try {
    const authResult = await verifyAuthentication(req);
    
    if (authResult.userType !== "driver") {
      throw new ApiError(403, "Only drivers can access driver profiles");
    }

    const driver = authResult.user as any;

    const isProfileComplete = driver.licenseNumber && 
                             driver.vehicleInfo?.vehicleBrand && 
                             driver.bankDetails?.accountHolderName &&
                             driver.attestation?.agreeToTerms;

    const driverResponse = removePasswordFromDriver(driver);

    res.status(200).json(
      new ApiResponse(
        200,
        { 
          driver: driverResponse,
          isProfileComplete 
        },
        "Driver profile retrieved successfully"
      )
    );

  } catch (error: unknown) {
    if (error instanceof ApiError) {
      throw error;
    }
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    throw new ApiError(500, `Failed to get driver profile: ${errorMessage}`);
  }
});

// Login Driver (for existing drivers)
export const loginDriver = asyncHandler(async (req: Request, res: Response) => {
  try {
    console.log("=== DRIVER LOGIN DEBUG ===");
    console.log("Request body:", req.body);
    console.log("==========================");

    const { email, password } = req.body;

    if (!email || !password) {
      throw new ApiError(400, "Email and password are required");
    }

    const driver = await Driver.findOne({ email, userType: "driver" });
    
    if (!driver) {
      throw new ApiError(401, "Invalid credentials");
    }

    const isPasswordValid = await bcrypt.compare(password, driver.password);
    
    if (!isPasswordValid) {
      throw new ApiError(401, "Invalid credentials");
    }

    const token = jwtEncode({ 
      userId: String(driver._id),
      userType: driver.userType 
    });

    const driverResponse = removePasswordFromDriver(driver);

    const driverTyped = driver as any;

    const isProfileComplete = driverTyped.licenseNumber && 
                             driverTyped.vehicleInfo?.vehicleBrand && 
                             driverTyped.bankDetails?.accountHolderName &&
                             driverTyped.attestation?.agreeToTerms;

    res.status(200).json(
      new ApiResponse(
        200,
        { 
          driver: driverResponse, 
          token,
          isProfileComplete
        },
        "Driver logged in successfully"
      )
    );

  } catch (error: unknown) {
    console.error("=== LOGIN ERROR ===");
    console.error("Error:", error);
    console.error("===================");
    
    if (error instanceof ApiError) {
      throw error;
    }
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    throw new ApiError(500, `Login failed: ${errorMessage}`);
  }
});