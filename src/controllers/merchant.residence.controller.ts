import { Request, Response } from "express";
import { Merchant } from "../models/merchant.model.js";
import { ResidenceModel } from "../models/merchant.residence.model.js";
import { ApiError } from "../utils/apierror.js";
import { ApiResponse } from "../utils/apirespone.js";
import { asyncHandler } from "../utils/asynchandler.js";
import { verifyAuthentication } from "../middleware/verifyAuthhentication.js";
import uploadToCloudinary from "../utils/cloudinary.js";
import { residenceSchema, updateResidenceSchema, type ResidenceData } from "../zodTypes/merchantData.js";

export const addResidence = asyncHandler(async (req: Request, res: Response) => {
  try {
    const verifiedAuth = await verifyAuthentication(req);
    
    if (verifiedAuth?.userType !== "merchant") {
      throw new ApiError(400, "INVALID_USER");
    }

    const owner = verifiedAuth.user;
    // Validate request body against schema
    const validatedData = residenceSchema.parse({
      ...req.body,
      // Ensure gpsLocation has proper structure
      gpsLocation: {
        type: "Point",
        coordinates: req.body.gpsLocation?.coordinates || [0, 0]
      }
    }) as ResidenceData;

    // Handle file uploads
    let imageURLs: string[] = [];
    if (req.files) {
      const files = Array.isArray(req.files) ? req.files : req.files.images;
      imageURLs = await Promise.all(
        files.map((file: any) => uploadToCloudinary(file.buffer))
      ).then((results) => results.map((result) => result.secure_url));
    }

    // Create new residence with validated data
    const newResidence = await ResidenceModel.create({
      ...validatedData,
      images: imageURLs,
      owner,
      // Ensure proper GeoJSON format for MongoDB
      gpsLocation: {
        type: "Point",
        coordinates: validatedData.gpsLocation.coordinates
      }
    });

    // Update merchant's residences array
    await Merchant.findByIdAndUpdate(
      owner,
      { $addToSet: { residences: newResidence._id } },
      { new: true }
    );

    res
      .status(201)
      .json(new ApiResponse(201, newResidence, "Residence added successfully"));
      return ;
  } catch (error: any) {
    throw new ApiError(400, error?.message || "Error adding residence");
  }
});

export const updateResidence = asyncHandler(async (req: Request, res: Response) => {
  try {
    const { residenceId } = req.params;
    const verifiedAuth = await verifyAuthentication(req);
    
    if (verifiedAuth?.userType !== "merchant") {
      throw new ApiError(400, "INVALID_USER");
    }

    const owner = verifiedAuth.user;
    
    // Validate update data against schema (all fields optional)
    const updates = updateResidenceSchema.parse(req.body)

    // Find the residence and verify ownership
    const residence = await ResidenceModel.findOne({
      _id: residenceId,
      owner: owner
    });

    if (!residence) {
      throw new ApiError(404, "Residence not found or access denied");
    }

    // Handle file uploads if new images are provided
    if (req.files) {
      const files = Array.isArray(req.files) ? req.files : req.files.images;
      const newImageURLs = await Promise.all(
        files.map((file: any) => uploadToCloudinary(file.buffer))
      ).then((results) => results.map((result) => result.secure_url));
      
      // Combine new images with existing ones
      updates.images = [...residence.images, ...newImageURLs];
    }

    // gpsLocation is already validated and formatted by the schema

    // Update the residence
    const updatedResidence = await ResidenceModel.findByIdAndUpdate(
      residenceId,
      { $set: updates },
      { new: true, runValidators: true }
    );

    res
      .status(200)
      .json(new ApiResponse(200, updatedResidence, "Residence updated successfully"));
  } catch (error: any) {
    throw new ApiError(400, error?.message || "Error updating residence");
  }
});

export const getResidenceById = asyncHandler(async (req: Request, res: Response) => {
  try {
    const { residenceId } = req.params;
    
    const residence = await ResidenceModel.findById(residenceId)
      .populate('owner', 'username email phone')
      .lean();

    if (!residence) {
      throw new ApiError(404, "Residence not found");
    }

    res
      .status(200)
      .json(new ApiResponse(200, residence, "Residence retrieved successfully"));
  } catch (error: any) {
    throw new ApiError(400, error?.message || "Error retrieving residence");
  }
});

export const deleteResidence = asyncHandler(async (req: Request, res: Response) => {
  try {
    const { residenceId } = req.params;
    const verifiedAuth = await verifyAuthentication(req);
    
    if (verifiedAuth?.userType !== "merchant") {
      throw new ApiError(400, "INVALID_USER");
    }

    const owner = verifiedAuth.user;

    // Find and delete the residence
    const deletedResidence = await ResidenceModel.findOneAndDelete({
      _id: residenceId,
      owner: owner
    });

    if (!deletedResidence) {
      throw new ApiError(404, "Residence not found or access denied");
    }

    // Remove from merchant's residences array
    await Merchant.findByIdAndUpdate(
      owner,
      { $pull: { residences: residenceId } },
      { new: true }
    );

    res
      .status(200)
      .json(new ApiResponse(200, null, "Residence deleted successfully"));
  } catch (error: any) {
    throw new ApiError(400, error?.message || "Error deleting residence");
  }
});

export const getMerchantResidences = asyncHandler(async (req: Request, res: Response) => {
  try {
    const verifiedAuth = await verifyAuthentication(req);
    
    if (verifiedAuth?.userType !== "merchant") {
      throw new ApiError(400, "INVALID_USER");
    }

    const owner = verifiedAuth.user;
    const residences = await ResidenceModel.find({ owner });

    res
      .status(200)
      .json(new ApiResponse(200, residences, "Residences retrieved successfully"));
  } catch (error: any) {
    throw new ApiError(400, error?.message || "Error retrieving residences");
  }
});
