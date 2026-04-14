import { Request, Response, NextFunction } from "express";
import { ApiError } from "../utils/apierror.js";
import z from "zod";
import { ApiResponse } from "../utils/apirespone.js";
import { asyncHandler } from "../utils/asynchandler.js";
import { DryCleaner } from "../models/merchant.model.js";
import uploadToCloudinary from "../utils/cloudinary.js";
import { jwtEncode } from "../utils/jwt.js";
import { IMerchant } from "../models/merchant.model.js";
import mongoose from "mongoose";

const addressSchema = z.object({
  street: z.string(),
  city: z.string(),
  state: z.string(),
  zipCode: z.string(),
  country: z.string(),
});

// Dry cleaner validation schema
const dryCleanerSchema = z.object({
  shopname: z.string(),
  address: addressSchema,
  rating: z.coerce.number().optional(),
  about: z.string().optional(),
  contactPerson: z.string(),
  phoneNumber: z.string(),
  hoursOfOperation: z.array(
    z.object({
      day: z.string(),
      open: z.string(),
      close: z.string(),
    })
  ),
  services: z.array(
    z.object({
      name: z.string(),
      category: z.string(),
      starchLevel: z.enum(["low", "medium", "high"]).optional(), // ✅ fixed
      washOnly: z.coerce.boolean().optional(),
      additionalservice: z.enum(["zipper", "button", "wash/fold"]).optional(),
      price: z.coerce.number().optional(),
    })
  ),
});

export const registerDryCleaner = asyncHandler(
  async (req: Request, res: Response) => {
    const { authUser } = req as any;

    if (authUser.userType !== "merchant") {
      throw new ApiError(403, "Unauthorized access");
    }

    const parseIfString = (field: any) =>
      typeof field === "string" ? JSON.parse(field) : field;

    req.body.hoursOfOperation = parseIfString(req.body.hoursOfOperation);
    req.body.services = parseIfString(req.body.services);
    req.body.address = parseIfString(req.body.address);

    const rData = dryCleanerSchema.parse(req.body);

    let contactPersonImgUrl: string | undefined;
    if (req.files && "contactPersonImg" in req.files) {
      const file = (req.files as any).contactPersonImg[0];
      const result = await uploadToCloudinary(file.buffer);
      contactPersonImgUrl = result.secure_url;
    }

    const shopImagesUrls: string[] = [];
    if (req.files && "shopimage" in req.files) {
      const files = (req.files as any).shopimage;
      for (const file of files) {
        const result = await uploadToCloudinary(file.buffer);
        shopImagesUrls.push(result.secure_url);
      }
    }

    const newDryCleaner = await DryCleaner.create({
      ...rData,
      contactPersonImg: contactPersonImgUrl,
      shopimage: shopImagesUrls,
      owner: authUser.user._id,
    });

    const merchantUser = authUser.user as IMerchant;
    merchantUser.haveDryCleaner = true;
    await merchantUser.save();

    const token = jwtEncode({
      userId: authUser.user._id,
      userType: "merchant",
    });

    res.status(201).json(
      new ApiResponse(
        201,
        { dryCleaner: newDryCleaner, token },
        "Dry Cleaner registered successfully."
      )
    );
  }
);

// ── Contact Person Edit ───────────────────────────────────────────────────────

const DryCleanerUpdateSchema = z.object({
  contactPerson: z.string().optional(),
  phoneNumber: z.string().optional(),
  contactPersonImg: z.string().optional(),
});

export const updateDryCleanerProfile = asyncHandler(
  async (req: Request, res: Response) => {
    const dryCleanerId = req.params.id;
    const { authUser } = req as any;

    if (authUser.userType !== "merchant") {
      throw new ApiError(403, "Unauthorized access");
    }

    const dryCleaner = await DryCleaner.findById(dryCleanerId);
    if (!dryCleaner) {
      throw new ApiError(404, "Dry Cleaner not found");
    }

    if (dryCleaner.owner.toString() !== authUser.user._id.toString()) {
      throw new ApiError(403, "Unauthorized to edit this dry cleaner");
    }

    const rData = DryCleanerUpdateSchema.parse(req.body);

    let contactPersonImgUrl: string | undefined;
    if (req.files && "contactPersonImg" in req.files) {
      const file = (req.files as any).contactPersonImg[0];
      const result = await uploadToCloudinary(file.buffer);
      contactPersonImgUrl = result.secure_url;
    }

    if (rData.contactPerson) dryCleaner.contactPerson = rData.contactPerson;
    if (rData.phoneNumber) dryCleaner.phoneNumber = rData.phoneNumber;
    if (contactPersonImgUrl) dryCleaner.contactPersonImg = contactPersonImgUrl;

    await dryCleaner.save();

    res.status(200).json(
      new ApiResponse(200, { dryCleaner }, "Dry Cleaner profile updated successfully.")
    );
  }
);

// ── Edit Dry Cleaner Address ──────────────────────────────────────────────────

const addressSchemas = z.object({
  street: z.string(),
  city: z.string(),
  state: z.string(),
  zipCode: z.string(),
  country: z.string(),
});

const dryCleanerEditSchema = z.object({
  shopname: z.string().optional(),
  about: z.string().optional(),
  address: addressSchemas.optional(),
});

export const editDryCleanerAddress = asyncHandler(
  async (req: Request, res: Response) => {
    const dryCleanerId = req.params.id;
    const { authUser } = req as any;

    if (authUser.userType !== "merchant") {
      throw new ApiError(403, "Unauthorized access");
    }

    const rData = dryCleanerEditSchema.parse(req.body);

    const dryCleaner = await DryCleaner.findById(dryCleanerId);
    if (!dryCleaner) {
      throw new ApiError(404, "Dry cleaner not found");
    }

    if (dryCleaner.owner.toString() !== authUser.user._id.toString()) {
      throw new ApiError(403, "Unauthorized to edit this dry cleaner");
    }

    if (rData.shopname) dryCleaner.shopname = rData.shopname;
    if (rData.about) dryCleaner.about = rData.about;
    if (rData.address) dryCleaner.address = rData.address;

    await dryCleaner.save();

    res.status(200).json(
      new ApiResponse(200, { dryCleaner }, "Dry cleaner details updated successfully.")
    );
  }
);

// ── Edit Dry Cleaner Service ──────────────────────────────────────────────────

const serviceEditSchema = z.object({
  serviceId: z.string(),
  name: z.string().optional(),
  category: z.string().optional(),
  starchLevel: z.enum(["low", "medium", "high"]).optional(), // ✅ fixed
  washOnly: z.boolean().optional(),
  additionalservice: z.enum(["zipper", "button", "wash/fold"]).optional(),
  price: z.number().optional(),
});

export const editDryCleanerService = asyncHandler(async (req: Request, res: Response) => {
  const dryCleanerId = req.params.dryCleanerId;
  const { authUser } = req as any;

  if (authUser.userType !== "merchant") {
    throw new ApiError(403, "Unauthorized access");
  }

  if (!req.body || Object.keys(req.body).length === 0) {
    throw new ApiError(400, "Missing request body.");
  }

  console.log("Received body:", req.body);

  const rData = serviceEditSchema.parse(req.body);

  const dryCleaner = await DryCleaner.findById(dryCleanerId);
  if (!dryCleaner) {
    throw new ApiError(404, "Dry Cleaner not found");
  }

  if (dryCleaner.owner.toString() !== authUser.user._id.toString()) {
    throw new ApiError(403, "Unauthorized to edit this Dry Cleaner");
  }

  const service = dryCleaner.services.id(rData.serviceId);
  if (!service) {
    throw new ApiError(404, "Service not found");
  }

  if (rData.name) service.name = rData.name;
  if (rData.category) service.category = rData.category;
  if (rData.starchLevel) service.starchLevel = rData.starchLevel; // ✅ fixed
  if (typeof rData.washOnly === "boolean") service.washOnly = rData.washOnly;
  if (rData.additionalservice) service.additionalservice = rData.additionalservice;
  if (rData.price) service.price = rData.price;

  await dryCleaner.save();

  res.status(200).json(
    new ApiResponse(200, { dryCleaner }, "Service updated successfully.")
  );
});

// ── Edit Dry Cleaner Hours ────────────────────────────────────────────────────

const hoursArraySchema = z.array(
  z.object({
    day: z.string(),
    open: z.string(),
    close: z.string(),
  })
);

export const editDryCleanerHours = asyncHandler(async (req: Request, res: Response) => {
  const dryCleanerId = req.params.dryCleanerId;
  const { authUser } = req as any;

  if (authUser.userType !== "merchant") {
    throw new ApiError(403, "Unauthorized access");
  }

  const rDataArray = hoursArraySchema.parse(req.body);

  const dryCleaner = await DryCleaner.findById(dryCleanerId);
  if (!dryCleaner) {
    throw new ApiError(404, "Dry Cleaner not found");
  }

  if (dryCleaner.owner.toString() !== authUser.user._id.toString()) {
    throw new ApiError(403, "Unauthorized to edit this Dry Cleaner");
  }

  rDataArray.forEach((rData) => {
    const opHour = dryCleaner.hoursOfOperation.find(
      (op) => op.day && op.day === rData.day
    );
    if (opHour) {
      opHour.open = rData.open;
      opHour.close = rData.close;
    } else {
      dryCleaner.hoursOfOperation.push(rData);
    }
  });

  await dryCleaner.save();

  res.status(200).json(
    new ApiResponse(200, { dryCleaner }, "Operating hours updated successfully.")
  );
});

// ── Update Shop Images ────────────────────────────────────────────────────────

export const updateDryCleanerShopImages = asyncHandler(
  async (req: Request, res: Response) => {
    const dryCleanerId = req.params.id;
    const { authUser } = req as any;

    if (authUser.userType !== "merchant") {
      throw new ApiError(403, "Unauthorized access");
    }

    const dryCleaner = await DryCleaner.findById(dryCleanerId);
    if (!dryCleaner) {
      throw new ApiError(404, "Dry Cleaner not found");
    }

    if (dryCleaner.owner.toString() !== authUser.user._id.toString()) {
      throw new ApiError(403, "Unauthorized to edit this dry cleaner");
    }

    if (!req.files || !Array.isArray((req.files as any).shopimage)) {
      throw new ApiError(400, "No images provided.");
    }

    const uploadedUrls: string[] = [];

    for (const file of (req.files as any).shopimage) {
      const result = await uploadToCloudinary(file.buffer);
      uploadedUrls.push(result.secure_url);
    }

    dryCleaner.shopimage.push(...uploadedUrls);

    await dryCleaner.save();

    res.status(200).json(
      new ApiResponse(200, { dryCleaner }, "Shop images updated successfully.")
    );
  }
);

// ── Delete Shop Image ─────────────────────────────────────────────────────────

export const deleteDryCleanerShopImage = asyncHandler(
  async (req: Request, res: Response) => {
    const dryCleanerId = req.params.id;
    const { imageUrl } = req.body;
    const { authUser } = req as any;

    if (authUser.userType !== "merchant") {
      throw new ApiError(403, "Unauthorized access");
    }

    const dryCleaner = await DryCleaner.findById(dryCleanerId);
    if (!dryCleaner) {
      throw new ApiError(404, "Dry Cleaner not found");
    }

    if (dryCleaner.owner.toString() !== authUser.user._id.toString()) {
      throw new ApiError(403, "Unauthorized to edit this dry cleaner");
    }

    const index = dryCleaner.shopimage.indexOf(imageUrl);
    if (index === -1) {
      throw new ApiError(404, "Image not found in shopimage array");
    }

    dryCleaner.shopimage.splice(index, 1);

    await dryCleaner.save();

    res.status(200).json(
      new ApiResponse(200, { dryCleaner }, "Shop image deleted successfully.")
    );
  }
);

// ── Get All Dry Cleaners ──────────────────────────────────────────────────────

export const getAllDryCleaners = asyncHandler(
  async (req: Request, res: Response) => {
    const dryCleaners = await DryCleaner.find().select("-orders");

    if (!dryCleaners || dryCleaners.length === 0) {
      throw new ApiError(404, "No dry cleaners found");
    }

    res.status(200).json(
      new ApiResponse(200, { dryCleaners }, "All dry cleaners fetched successfully.")
    );
  }
);

// ── Merchant Get Own Dry Cleaner ──────────────────────────────────────────────

export const getownDrycleaner = asyncHandler(async (req: Request, res: Response) => {
  const { authUser } = req as any;

  console.log("Authenticated User:", authUser);

  if (!authUser || authUser.userType !== "merchant") {
    throw new ApiError(403, "Unauthorized access");
  }

  try {
    const dryCleaners = await DryCleaner.find({ owner: authUser.user._id }).select("-orders");

    console.log("Found Dry Cleaners:", dryCleaners.length);

    res.status(200).json(
      new ApiResponse(
        200,
        { dryCleaners: dryCleaners || [] },
        dryCleaners && dryCleaners.length > 0
          ? "Your dry cleaners fetched successfully."
          : "No dry cleaners found for this merchant"
      )
    );
  } catch (error) {
    console.error("Error fetching dry cleaners:", error);
    throw new ApiError(500, "Failed to fetch dry cleaners");
  }
});

// ── Delete Own Dry Cleaner ────────────────────────────────────────────────────

export const deleteOwnDryCleaner = asyncHandler(async (req: Request, res: Response) => {
  const { authUser } = req as any;
  const dryCleanerId = req.params.id;

  if (!mongoose.Types.ObjectId.isValid(dryCleanerId)) {
    throw new ApiError(400, "Invalid Dry Cleaner ID");
  }

  if (!authUser || authUser.userType !== "merchant") {
    throw new ApiError(403, "Unauthorized access");
  }

  const dryCleaner = await DryCleaner.findOne({
    _id: dryCleanerId,
    owner: authUser.user._id,
  });

  if (!dryCleaner) {
    throw new ApiError(404, "Dry Cleaner not found or you don't have permission to delete it");
  }

  await dryCleaner.deleteOne();

  res.status(200).json(new ApiResponse(200, null, "Dry Cleaner deleted successfully"));
});

// ── Get Dry Cleaner Services ──────────────────────────────────────────────────

export const getDryCleanerServices = asyncHandler(
  async (req: Request, res: Response) => {
    const { dryCleanerId } = req.params;

    const dryCleaner = await DryCleaner.findById(dryCleanerId).select("services");

    if (!dryCleaner) {
      throw new ApiError(404, "Dry cleaner not found");
    }

    // ✅ Defensive transform — convert any old numeric starchLevel to string
    const starchMap: { [key: number]: string } = {
      1: "low", 2: "low", 3: "medium", 4: "high", 5: "high",
    };

    const services = dryCleaner.services.map((s: any) => {
      const sObj = s.toObject();
      if (typeof sObj.starchLevel === "number") {
        sObj.starchLevel = starchMap[sObj.starchLevel] || "medium";
      }
      return sObj;
    });

    res.status(200).json(
      new ApiResponse(200, services, "Dry cleaner services fetched successfully")
    );
  }
);

// ── Add Dry Cleaner Service ───────────────────────────────────────────────────

const addServiceSchema = z.object({
  name: z.string().min(1, "Service name is required"),
  category: z.string().min(1, "Category is required"),
  starchLevel: z.enum(["low", "medium", "high"]).optional().default("medium"), // ✅ fixed
  washOnly: z.coerce.boolean().optional().default(false),
  additionalservice: z
    .string()
    .transform((v) => (v.trim() === "" ? undefined : v.trim()))
    .pipe(z.enum(["zipper", "button", "wash/fold"]).optional())
    .optional(),
  price: z.coerce.number().min(0.01, "Price must be greater than 0"),
});

export const addDryCleanerService = asyncHandler(
  async (req: Request, res: Response) => {
    const dryCleanerId = req.params.dryCleanerId;
    const { authUser } = req as any;

    if (authUser.userType !== "merchant") {
      throw new ApiError(403, "Unauthorized access");
    }

    console.log("Add service body:", req.body);

    let rData;
    try {
      rData = addServiceSchema.parse(req.body);
    } catch (zodError: any) {
      console.error("Zod validation error:", JSON.stringify(zodError.errors, null, 2));
      throw new ApiError(
        400,
        `Validation failed: ${zodError.errors.map((e: any) => e.message).join(", ")}`
      );
    }

    const dryCleaner = await DryCleaner.findById(dryCleanerId);
    if (!dryCleaner) {
      throw new ApiError(404, "Dry Cleaner not found");
    }

    if (dryCleaner.owner.toString() !== authUser.user._id.toString()) {
      throw new ApiError(403, "Unauthorized to edit this Dry Cleaner");
    }

    dryCleaner.services.push({
      name: rData.name,
      category: rData.category,
      starchLevel: rData.starchLevel ?? "medium", // ✅ fixed
      washOnly: rData.washOnly ?? false,
      additionalservice: rData.additionalservice as any,
      price: rData.price,
    } as any);

    await dryCleaner.save();

    console.log("Service added successfully:", rData.name);

    res.status(201).json(
      new ApiResponse(201, { dryCleaner }, "Service added successfully.")
    );
  }
);

// ── Delete Dry Cleaner Service ────────────────────────────────────────────────

const deleteServiceSchema = z.object({
  serviceId: z.string().min(1, "Service ID is required"),
});

export const deleteDryCleanerService = asyncHandler(
  async (req: Request, res: Response) => {
    const dryCleanerId = req.params.dryCleanerId;
    const { authUser } = req as any;

    if (authUser.userType !== "merchant") {
      throw new ApiError(403, "Unauthorized access");
    }

    const rData = deleteServiceSchema.parse(req.body);

    const dryCleaner = await DryCleaner.findById(dryCleanerId);
    if (!dryCleaner) {
      throw new ApiError(404, "Dry Cleaner not found");
    }

    if (dryCleaner.owner.toString() !== authUser.user._id.toString()) {
      throw new ApiError(403, "Unauthorized to edit this Dry Cleaner");
    }

    const serviceIndex = dryCleaner.services.findIndex(
      (s: any) => s._id.toString() === rData.serviceId
    );

    if (serviceIndex === -1) {
      throw new ApiError(404, "Service not found");
    }

    dryCleaner.services.splice(serviceIndex, 1);
    await dryCleaner.save();

    res.status(200).json(
      new ApiResponse(200, { dryCleaner }, "Service deleted successfully.")
    );
  }
);