import { Request, Response } from "express";
import { ApiError } from "../utils/apierror.js";
import z from "zod";
import { ApiResponse } from "../utils/apirespone.js";
import { asyncHandler } from "../utils/asynchandler.js";
import { DryCleaner } from "../models/merchant.model.js";
import uploadToCloudinary from "../utils/cloudinary.js";
import { jwtEncode } from "../utils/jwt.js";
import { IMerchant } from "../models/merchant.model.js";
import mongoose from "mongoose";

// ── Shared Sub-Schemas ────────────────────────────────────────────────────────

const addressSchema = z.object({
  street: z.string(),
  city: z.string(),
  state: z.string(),
  zipCode: z.string(),
  country: z.string(),
});

// ── Shared Additional Service Schema (ARRAY) ──────────────────────────────────

const additionalServiceItemSchema = z.object({
  name: z.enum(["zipper", "button", "wash/fold"]),
  price: z.coerce.number().min(0, "Additional service price must be >= 0"),
});

const additionalServicesArraySchema = z
  .array(additionalServiceItemSchema)
  .optional()
  .transform((val) => {
    if (!val || val.length === 0) return undefined;
    return val.filter((s) => s.name); // drop any entries without a name
  });

// ── Register Dry Cleaner ──────────────────────────────────────────────────────

const dryCleanerSchema = z.object({
  shopname: z.string(),
  address: addressSchema,
  rating: z.coerce.number().optional(),
  about: z.string().optional(),
  contactPerson: z.string(),
  phoneNumber: z.string(),
  hoursOfOperation: z.array(
    z.object({ day: z.string(), open: z.string(), close: z.string() })
  ),
  services: z.array(
    z.object({
      name: z.string(),
      category: z.string(),
      starchLevel: z.enum(["low", "medium", "high"]).optional(),
      washOnly: z.coerce.boolean().optional(),
      additionalservice: additionalServicesArraySchema,
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

    const token = jwtEncode({ userId: authUser.user._id, userType: "merchant" });

    res.status(201).json(
      new ApiResponse(
        201,
        { dryCleaner: newDryCleaner, token },
        "Dry Cleaner registered successfully."
      )
    );
  }
);

// ── Update Contact Person Profile ─────────────────────────────────────────────

const dryCleanerUpdateSchema = z.object({
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
    if (!dryCleaner) throw new ApiError(404, "Dry Cleaner not found");

    if (dryCleaner.owner.toString() !== authUser.user._id.toString()) {
      throw new ApiError(403, "Unauthorized to edit this dry cleaner");
    }

    const rData = dryCleanerUpdateSchema.parse(req.body);

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

// ── Edit Shop Name, About & Address ──────────────────────────────────────────

const dryCleanerEditSchema = z.object({
  shopname: z.string().optional(),
  about: z.string().optional(),
  address: addressSchema.optional(),
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
    if (!dryCleaner) throw new ApiError(404, "Dry cleaner not found");

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

// ── Add a Service ─────────────────────────────────────────────────────────────

const addServiceZodSchema = z.object({
  name: z.string().min(1, "Service name is required"),
  category: z.string().min(1, "Category is required"),
  starchLevel: z.enum(["low", "medium", "high"]).optional().default("medium"),
  washOnly: z.coerce.boolean().optional().default(false),
  additionalservice: additionalServicesArraySchema,
  price: z.coerce.number().min(0.01, "Price must be greater than 0"),
});

export const addDryCleanerService = asyncHandler(
  async (req: Request, res: Response) => {
    const dryCleanerId = req.params.dryCleanerId;
    const { authUser } = req as any;

    if (authUser.userType !== "merchant") {
      throw new ApiError(403, "Unauthorized access");
    }

    console.log("📥 Raw body received:", JSON.stringify(req.body, null, 2));

    const rawBody = { ...req.body };

    // Normalize: if additionalservice is not a non-empty array, remove it
    if (
      !rawBody.additionalservice ||
      !Array.isArray(rawBody.additionalservice) ||
      rawBody.additionalservice.length === 0
    ) {
      delete rawBody.additionalservice;
    } else {
      // Filter out any entries missing a valid name
      rawBody.additionalservice = rawBody.additionalservice.filter(
        (s: any) => s && s.name
      );
      if (rawBody.additionalservice.length === 0) {
        delete rawBody.additionalservice;
      }
    }

    let rData;
    try {
      rData = addServiceZodSchema.parse(rawBody);
    } catch (zodError: any) {
      console.error("❌ Zod error:", JSON.stringify(zodError.errors, null, 2));
      throw new ApiError(
        400,
        `Validation failed: ${zodError.errors
          .map((e: any) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")}`
      );
    }

    const dryCleaner = await DryCleaner.findById(dryCleanerId);
    if (!dryCleaner) throw new ApiError(404, "Dry Cleaner not found");

    if (dryCleaner.owner.toString() !== authUser.user._id.toString()) {
      throw new ApiError(403, "Unauthorized to edit this Dry Cleaner");
    }

    const newService: any = {
      name: rData.name,
      category: rData.category,
      starchLevel: rData.starchLevel ?? "medium",
      washOnly: rData.washOnly ?? false,
      price: rData.price,
      // Only include additionalservice if there are valid entries
      ...(rData.additionalservice && rData.additionalservice.length > 0
        ? { additionalservice: rData.additionalservice }
        : {}),
    };

    dryCleaner.services.push(newService);
    await dryCleaner.save();

    console.log("✅ Service added:", rData.name);

    res.status(201).json(
      new ApiResponse(201, { dryCleaner }, "Service added successfully.")
    );
  }
);

// ── Edit a Service ────────────────────────────────────────────────────────────

const editServiceZodSchema = z.object({
  serviceId: z.string(),
  name: z.string().optional(),
  category: z.string().optional(),
  starchLevel: z.enum(["low", "medium", "high"]).optional(),
  washOnly: z.coerce.boolean().optional(),
  additionalservice: additionalServicesArraySchema,
  price: z.coerce.number().optional(),
});

export const editDryCleanerService = asyncHandler(
  async (req: Request, res: Response) => {
    const dryCleanerId = req.params.dryCleanerId;
    const { authUser } = req as any;

    if (authUser.userType !== "merchant") {
      throw new ApiError(403, "Unauthorized access");
    }

    if (!req.body || Object.keys(req.body).length === 0) {
      throw new ApiError(400, "Missing request body.");
    }

    console.log("📥 Edit service body:", JSON.stringify(req.body, null, 2));

    const rawBody = { ...req.body };

    // Normalize: same logic as add
    if (
      !rawBody.additionalservice ||
      !Array.isArray(rawBody.additionalservice) ||
      rawBody.additionalservice.length === 0
    ) {
      // Keep the key as empty array so we can detect explicit clearing below
      rawBody.additionalservice = [];
    } else {
      rawBody.additionalservice = rawBody.additionalservice.filter(
        (s: any) => s && s.name
      );
    }

    let rData;
    try {
      rData = editServiceZodSchema.parse(rawBody);
    } catch (zodError: any) {
      console.error("❌ Zod error:", JSON.stringify(zodError.errors, null, 2));
      throw new ApiError(
        400,
        `Validation failed: ${zodError.errors
          .map((e: any) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")}`
      );
    }

    const dryCleaner = await DryCleaner.findById(dryCleanerId);
    if (!dryCleaner) throw new ApiError(404, "Dry Cleaner not found");

    if (dryCleaner.owner.toString() !== authUser.user._id.toString()) {
      throw new ApiError(403, "Unauthorized to edit this Dry Cleaner");
    }

    const service = dryCleaner.services.id(rData.serviceId);
    if (!service) throw new ApiError(404, "Service not found");

    if (rData.name) service.name = rData.name;
    if (rData.category) service.category = rData.category;
    if (rData.starchLevel) service.starchLevel = rData.starchLevel;
    if (typeof rData.washOnly === "boolean") service.washOnly = rData.washOnly;
    if (rData.price) service.price = rData.price;

    // Always update additionalservice — set to array or clear to empty array
    (service as any).additionalservice =
      rData.additionalservice && rData.additionalservice.length > 0
        ? rData.additionalservice
        : [];

    await dryCleaner.save();

    res.status(200).json(
      new ApiResponse(200, { dryCleaner }, "Service updated successfully.")
    );
  }
);

// ── Delete a Service ──────────────────────────────────────────────────────────

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
    if (!dryCleaner) throw new ApiError(404, "Dry Cleaner not found");

    if (dryCleaner.owner.toString() !== authUser.user._id.toString()) {
      throw new ApiError(403, "Unauthorized to edit this Dry Cleaner");
    }

    const serviceIndex = dryCleaner.services.findIndex(
      (s: any) => s._id.toString() === rData.serviceId
    );

    if (serviceIndex === -1) throw new ApiError(404, "Service not found");

    dryCleaner.services.splice(serviceIndex, 1);
    await dryCleaner.save();

    res.status(200).json(
      new ApiResponse(200, { dryCleaner }, "Service deleted successfully.")
    );
  }
);

// ── Edit Operating Hours ──────────────────────────────────────────────────────

const hoursArraySchema = z.array(
  z.object({ day: z.string(), open: z.string(), close: z.string() })
);

export const editDryCleanerHours = asyncHandler(
  async (req: Request, res: Response) => {
    const dryCleanerId = req.params.dryCleanerId;
    const { authUser } = req as any;

    if (authUser.userType !== "merchant") {
      throw new ApiError(403, "Unauthorized access");
    }

    const rDataArray = hoursArraySchema.parse(req.body);

    const dryCleaner = await DryCleaner.findById(dryCleanerId);
    if (!dryCleaner) throw new ApiError(404, "Dry Cleaner not found");

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
  }
);

// ── Add Shop Images ───────────────────────────────────────────────────────────

export const updateDryCleanerShopImages = asyncHandler(
  async (req: Request, res: Response) => {
    const dryCleanerId = req.params.id;
    const { authUser } = req as any;

    if (authUser.userType !== "merchant") {
      throw new ApiError(403, "Unauthorized access");
    }

    const dryCleaner = await DryCleaner.findById(dryCleanerId);
    if (!dryCleaner) throw new ApiError(404, "Dry Cleaner not found");

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

// ── Delete a Shop Image ───────────────────────────────────────────────────────

export const deleteDryCleanerShopImage = asyncHandler(
  async (req: Request, res: Response) => {
    const dryCleanerId = req.params.id;
    const { imageUrl } = req.body;
    const { authUser } = req as any;

    if (authUser.userType !== "merchant") {
      throw new ApiError(403, "Unauthorized access");
    }

    const dryCleaner = await DryCleaner.findById(dryCleanerId);
    if (!dryCleaner) throw new ApiError(404, "Dry Cleaner not found");

    if (dryCleaner.owner.toString() !== authUser.user._id.toString()) {
      throw new ApiError(403, "Unauthorized to edit this dry cleaner");
    }

    const index = dryCleaner.shopimage.indexOf(imageUrl);
    if (index === -1) throw new ApiError(404, "Image not found in shopimage array");

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

// ── Merchant: Get Own Dry Cleaners ────────────────────────────────────────────

export const getownDrycleaner = asyncHandler(
  async (req: Request, res: Response) => {
    const { authUser } = req as any;

    if (!authUser || authUser.userType !== "merchant") {
      throw new ApiError(403, "Unauthorized access");
    }

    try {
      const dryCleaners = await DryCleaner.find({
        owner: authUser.user._id,
      }).select("-orders");

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
      throw new ApiError(500, "Failed to fetch dry cleaners");
    }
  }
);

// ── Merchant: Delete Own Dry Cleaner ─────────────────────────────────────────

export const deleteOwnDryCleaner = asyncHandler(
  async (req: Request, res: Response) => {
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
      throw new ApiError(
        404,
        "Dry Cleaner not found or you don't have permission to delete it"
      );
    }

    await dryCleaner.deleteOne();

    res
      .status(200)
      .json(new ApiResponse(200, null, "Dry Cleaner deleted successfully"));
  }
);

// ── Get Dry Cleaner Services ──────────────────────────────────────────────────

export const getDryCleanerServices = asyncHandler(
  async (req: Request, res: Response) => {
    const { dryCleanerId } = req.params;

    const dryCleaner = await DryCleaner.findById(dryCleanerId).select("services");
    if (!dryCleaner) throw new ApiError(404, "Dry cleaner not found");

    const starchMap: { [key: number]: string } = {
      1: "low",
      2: "low",
      3: "medium",
      4: "high",
      5: "high",
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