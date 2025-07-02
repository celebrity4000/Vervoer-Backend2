import { Request, Response } from "express";
import { Merchant } from "../models/merchant.model.js";
import { IResident, ResidenceModel } from "../models/merchant.residence.model.js";
import { ApiError } from "../utils/apierror.js";
import { ApiResponse } from "../utils/apirespone.js";
import { asyncHandler } from "../utils/asynchandler.js";
import { verifyAuthentication } from "../middleware/verifyAuthhentication.js";
import uploadToCloudinary from "../utils/cloudinary.js";
import { residenceSchema, updateResidenceSchema, type ResidenceData } from "../zodTypes/merchantData.js";
import z from "zod/v4";
import mongoose from "mongoose";

export const addResidence = asyncHandler(async (req: Request, res: Response) => {
    const verifiedAuth = await verifyAuthentication(req);
    
    if (verifiedAuth?.userType !== "merchant") {
      throw new ApiError(400, "INVALID_USER");
    }

    const owner = verifiedAuth.user;
    const validatedData = residenceSchema.parse({
      ...req.body,
    }) as ResidenceData;

    let imageURLs: string[] = [];
    if (req.files) {
      const files = Array.isArray(req.files) ? req.files : req.files.images;
      imageURLs = await Promise.all(
        files.map((file) => uploadToCloudinary(file.buffer))
      ).then((results) => results.map((result) => result.secure_url));
    }

    // Create new residence with validated data
    const newResidence = await ResidenceModel.create({
      ...validatedData,
      images: imageURLs,
      owner : owner._id ,
    });

    // Update merchant's residences array
    await Merchant.findByIdAndUpdate(
      owner._id,
      { $set: {haveResidence: true} },
      { new: true }
    );

    res
      .status(201)
      .json(new ApiResponse(201, newResidence, "Residence added successfully"));
      return ;
});

export const updateResidence = asyncHandler(async (req: Request, res: Response) => {
    const { residenceId } = req.params;
    const verifiedAuth = await verifyAuthentication(req);
    
    if (verifiedAuth?.userType !== "merchant") {
      throw new ApiError(400, "INVALID_USER");
    }

    const owner = verifiedAuth.user;
    
    const updates = updateResidenceSchema.parse(req.body)

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
        files.map((file) => uploadToCloudinary(file.buffer))
      ).then((results) => results.map((result) => result.secure_url));
      
      updates.images = [...residence.images, ...newImageURLs];
    }
    const updatedResidence = await ResidenceModel.findByIdAndUpdate(
      residenceId,
      { $set: updates },
      { new: true, runValidators: true }
    );

    res
      .status(200)
      .json(new ApiResponse(200, updatedResidence, "Residence updated successfully"));
});

export const getResidenceById = asyncHandler(async (req: Request, res: Response) => {
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
});

export const deleteResidence = asyncHandler(async (req: Request, res: Response) => {
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
      
      throw new ApiError(404, "NOT_FOUND:Residence not found or access denied");
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
});

export const getMerchantResidences = asyncHandler(async (req: Request, res: Response) => {
    const verifiedAuth = await verifyAuthentication(req);
    
    if (verifiedAuth?.userType !== "merchant") {
      throw new ApiError(400, "INVALID_USER");
    }

    const owner = verifiedAuth.user;
    const residences = await ResidenceModel.find({ owner });

    res
      .status(200)
      .json(new ApiResponse(200, residences, "Residences retrieved successfully"));
});

export const getListOfResidence = asyncHandler(async (req, res)=>{
  try {

  
  const longitude = z.coerce.number().optional().parse(req.query.longitude) ;
  const latitude = z.coerce.number().optional().parse(req.query.latitude) ;
  const owner = z.string().optional().parse(req.query.owner) ;
  console.log(longitude , latitude) ;
  const queries: mongoose.FilterQuery<IResident> = {} ;
  if(longitude && latitude) {
    queries.gpsLocation = {
      $near : {
      $geometry: {
        type : "Point",
        coordinates :[longitude,latitude] ,
      }
    }}
  }
    if(owner){
      queries._id = owner ;
    }
  const result = await ResidenceModel.find(queries).exec() ;
  if(result){
    res.status(200).json(new ApiResponse(200,result))
  }
  else throw new ApiError(500) ;
}catch(error){
  if(error instanceof z.ZodError){
    throw new ApiError(400,"INVALID_QUERY",error.issues);
  }
  else if(error instanceof ApiError) throw error ;
  console.log(error) ;
  throw new ApiError(500, "Server Error", error);
}
})