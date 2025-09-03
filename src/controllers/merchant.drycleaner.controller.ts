import { Request, Response ,NextFunction} from "express";
import { ApiError } from "../utils/apierror.js";
import z from "zod";
import { ApiResponse } from "../utils/apirespone.js";
import { asyncHandler } from "../utils/asynchandler.js";
import { DryCleaner } from "../models/merchant.model.js";
import uploadToCloudinary from "../utils/cloudinary.js";
import { jwtEncode } from "../utils/jwt.js";
import { IMerchant } from "../models/merchant.model.js";
import { verifyAuthentication } from "../middleware/verifyAuthhentication.js";
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
      strachLevel: z.union([z.string(), z.number()]).optional(),
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

    // Parse JSON strings from multipart/form-data fields if needed
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









// contactperon edit
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

    // Validate body fields
    const rData = DryCleanerUpdateSchema.parse(req.body);

    // Upload image if present
    let contactPersonImgUrl: string | undefined;
    if (req.files && "contactPersonImg" in req.files) {
      const file = (req.files as any).contactPersonImg[0];
      const result = await uploadToCloudinary(file.buffer);
      contactPersonImgUrl = result.secure_url;
    }

    // Update only provided fields
    if (rData.contactPerson) dryCleaner.contactPerson = rData.contactPerson;
    if (rData.phoneNumber) dryCleaner.phoneNumber = rData.phoneNumber;
    if (contactPersonImgUrl) dryCleaner.contactPersonImg = contactPersonImgUrl;

    await dryCleaner.save();

    res.status(200).json(
      new ApiResponse(200, { dryCleaner }, "Dry Cleaner profile updated successfully.")
    );
  }
);


// Edit dry cleaner address
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


// dry clearner service
 const serviceEditSchema = z.object({
  serviceId: z.string(),
  name: z.string().optional(),
  category: z.string().optional(),
  strachLevel: z.number().min(1).max(5).optional(),
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
  if (rData.strachLevel) service.strachLevel = rData.strachLevel;
  if (typeof rData.washOnly === "boolean") service.washOnly = rData.washOnly;
  if (rData.additionalservice) service.additionalservice = rData.additionalservice;
  if (rData.price) service.price = rData.price;

  await dryCleaner.save();

  res.status(200).json(
    new ApiResponse(200, { dryCleaner }, "Service updated successfully.")
  );
});


// dry cleaner hours of operation
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

  rDataArray.forEach(rData => {
    const opHour = dryCleaner.hoursOfOperation.find(op => op.day && op.day === rData.day);
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



// shop imgage update
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

    // Replace all existing shop images
    // dryCleaner.shopimage = uploadedUrls;

    // Append new images to existing ones
    dryCleaner.shopimage.push(...uploadedUrls);


    await dryCleaner.save();

    res.status(200).json(
      new ApiResponse(200, { dryCleaner }, "Shop images updated successfully.")
    );
  }
);


// delete shop image
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

    // Check if image exists in the array
    const index = dryCleaner.shopimage.indexOf(imageUrl);
    if (index === -1) {
      throw new ApiError(404, "Image not found in shopimage array");
    }

    // Remove the image URL from the array
    dryCleaner.shopimage.splice(index, 1);

    await dryCleaner.save();

    res.status(200).json(
      new ApiResponse(200, { dryCleaner }, "Shop image deleted successfully.")
    );
  }
);


// get all dry cleaner
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

// merchant get it's own dry cleaner
export const getownDrycleaner = asyncHandler(async (req: Request, res: Response) => {
  const { authUser } = req as any;

  console.log('Authenticated User:', authUser);

  if (!authUser || authUser.userType !== "merchant") {
    throw new ApiError(403, "Unauthorized access");
  }

  try {
    // FIX HERE -> authUser.user._id
    const dryCleaners = await DryCleaner.find({ owner: authUser.user._id }).select("-orders");

    console.log('Found Dry Cleaners:', dryCleaners.length);

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
    console.error('Error fetching dry cleaners:', error);
    throw new ApiError(500, "Failed to fetch dry cleaners");
  }
});

// order by the user
const orderSchema = z.object({
  serviceName: z.string(),
  quantity: z.number().min(1),
  price: z.number().min(0),
});

// export const placeOrderToDryCleaner = asyncHandler(
//   async (req: Request, res: Response) => {
//     const { authUser } = req as any;

//     if (authUser.userType !== "user") {
//       throw new ApiError(403, "Only users can place orders.");
//     }

//     const dryCleanerId = req.params.dryCleanerId;

//     // Validate request body
//     const rData = orderSchema.parse(req.body);

//     const dryCleaner = await DryCleaner.findById(dryCleanerId);
//     if (!dryCleaner) {
//       throw new ApiError(404, "Dry cleaner not found");
//     }

//     const newOrder = {
//       serviceName: rData.serviceName,
//       quantity: rData.quantity,
//       price: rData.price,
//       status: "active",
//     };

//     dryCleaner.orders.push(newOrder);
//     await dryCleaner.save();

//     res.status(201).json(
//       new ApiResponse(201, { dryCleaner }, "Order placed successfully.")
//     );
//   }
// );




// delete own dry cleaner
export const deleteOwnDryCleaner = asyncHandler(async (req: Request, res: Response) => {
  const { authUser } = req as any;
  const dryCleanerId = req.params.id;

  if (!mongoose.Types.ObjectId.isValid(dryCleanerId)) {
    throw new ApiError(400, "Invalid Dry Cleaner ID");
  }

  // Ensure user is authenticated and is a merchant
  if (!authUser || authUser.userType !== "merchant") {
    throw new ApiError(403, "Unauthorized access");
  }

  // Find the Dry Cleaner with the given ID and owned by this merchant
  const dryCleaner = await DryCleaner.findOne({
    _id: dryCleanerId,
    owner: authUser.user._id  // Ensure ownership
  });

  if (!dryCleaner) {
    throw new ApiError(404, "Dry Cleaner not found or you don't have permission to delete it");
  }

  // Delete the Dry Cleaner
  await dryCleaner.deleteOne();

  res.status(200).json(new ApiResponse(200, null, "Dry Cleaner deleted successfully"));
});


// service dry cleaner
export const getDryCleanerServices = asyncHandler(
  async (req: Request, res: Response) => {
    const { dryCleanerId } = req.params;

    // Find dry cleaner by ID
    const dryCleaner = await DryCleaner.findById(dryCleanerId).select("services");

    if (!dryCleaner) {
      throw new ApiError(404, "Dry cleaner not found");
    }

    res.status(200).json(
      new ApiResponse(
        200,
        dryCleaner.services,
        "Dry cleaner services fetched successfully"
      )
    );
  }
);



