import { Request, Response } from "express";
import { Merchant } from "../models/merchant.model.js";
import { IResident, ResidenceModel ,ResidenceBookingModel} from "../models/merchant.residence.model.js";
import { ApiError } from "../utils/apierror.js";
import { ApiResponse } from "../utils/apirespone.js";
import { asyncHandler } from "../utils/asynchandler.js";
import { verifyAuthentication } from "../middleware/verifyAuthhentication.js";
import uploadToCloudinary from "../utils/cloudinary.js";
import { residenceSchema, updateResidenceSchema, type ResidenceData } from "../zodTypes/merchantData.js";
import z from "zod";
import mongoose from "mongoose";

export const addResidence = asyncHandler(async (req: Request, res: Response) => {
  // Auth check
  const verifiedAuth = await verifyAuthentication(req);
  if (verifiedAuth?.userType !== "merchant") {
    throw new ApiError(400, "INVALID_USER");
  }
  const owner = verifiedAuth.user;

  // Parse stringified JSON fields from form-data
  if (typeof req.body.gpsLocation === "string") {
    req.body.gpsLocation = JSON.parse(req.body.gpsLocation);
  }
  if (typeof req.body.generalAvailable === "string") {
    req.body.generalAvailable = JSON.parse(req.body.generalAvailable);
  }
  if (typeof req.body.emergencyContact === "string") {
    req.body.emergencyContact = JSON.parse(req.body.emergencyContact);
  }
  if (req.body.transportationTypes && typeof req.body.transportationTypes === "string") {
    req.body.transportationTypes = JSON.parse(req.body.transportationTypes);
  }
  if (req.body.coveredDrivewayTypes && typeof req.body.coveredDrivewayTypes === "string") {
    req.body.coveredDrivewayTypes = JSON.parse(req.body.coveredDrivewayTypes);
  }

  // Parse booleans from string 'true'/'false'
  const booleanFields = [
    "is24x7",
    "parking_pass",
    "transportationAvailable",
    "coveredDrivewayAvailable",
    "securityCamera"
  ];
  booleanFields.forEach(field => {
    if (req.body[field] !== undefined) {
      req.body[field] = req.body[field] === "true";
    }
  });

  // Validate with Zod schema
  const validatedData = residenceSchema.parse({
    ...req.body,
  }) as ResidenceData;

  // Handle images if uploaded
  let imageURLs: string[] = [];
  if (req.files) {
    const files = Array.isArray(req.files) ? req.files : req.files.images;
    imageURLs = await Promise.all(
      files.map((file) => uploadToCloudinary(file.buffer))
    ).then((results) => results.map((result) => result.secure_url));
  }

  // Create new Residence document
  const newResidence = await ResidenceModel.create({
    ...validatedData,
    images: imageURLs,
    owner: owner._id,
  });

  // Update Merchant document to set haveResidence to true
  await Merchant.findByIdAndUpdate(
    owner._id,
    { $set: { haveResidence: true } },
    { new: true }
  );

  // Respond
  res
    .status(201)
    .json(new ApiResponse(201, newResidence, "Residence added successfully"));
});


export const updateResidence = asyncHandler(async (req: Request, res: Response) => {
  const { residenceId } = req.params;

  const verifiedAuth = await verifyAuthentication(req);
  if (verifiedAuth?.userType !== "merchant") {
    throw new ApiError(400, "INVALID_USER");
  }

  const owner = verifiedAuth.user;

  const jsonFields = [
    "gpsLocation",
    "generalAvailable",
    "emergencyContact",
    "transportationTypes",
    "coveredDrivewayTypes"
  ];
  for (const field of jsonFields) {
    if (req.body[field] && typeof req.body[field] === "string") {
      try {
        req.body[field] = JSON.parse(req.body[field]);
      } catch {
        throw new ApiError(400, `Invalid JSON format for ${field}`);
      }
    }
  }

  const booleanFields = [
    "is24x7",
    "parking_pass",
    "transportationAvailable",
    "coveredDrivewayAvailable",
    "securityCamera"
  ];
  for (const field of booleanFields) {
    if (req.body[field] !== undefined && typeof req.body[field] === "string") {
      req.body[field] = req.body[field] === "true";
    }
  }

  const updates = updateResidenceSchema.parse(req.body);

  const residence = await ResidenceModel.findOne({ _id: residenceId, owner });
  if (!residence) {
    throw new ApiError(404, "Residence not found or access denied");
  }

  if (req.files) {
    const files = Array.isArray(req.files) ? req.files : req.files.images;
    const uploadedImages = await Promise.all(
      files.map((file) => uploadToCloudinary(file.buffer))
    );
    const newImageURLs = uploadedImages.map((res) => res.secure_url);
    updates.images = [...(residence.images || []), ...newImageURLs];
  }

  const updatedResidence = await ResidenceModel.findByIdAndUpdate(
    residenceId,
    { $set: updates },
    { new: true, runValidators: true }
  );

  res.status(200).json(new ApiResponse(200, updatedResidence, "Residence updated successfully"));
});


export const getResidenceById = asyncHandler(async (req: Request, res: Response) => {
  const { residenceId } = req.params;
  const residence = await ResidenceModel.findById(residenceId).populate("owner", "username email phone").lean();
  if (!residence) throw new ApiError(404, "Residence not found");
  res.status(200).json(new ApiResponse(200, residence, "Residence retrieved successfully"));
});

export const deleteResidence = asyncHandler(async (req: Request, res: Response) => {
  const { residenceId } = req.params;
  const verifiedAuth = await verifyAuthentication(req);
  if (verifiedAuth?.userType !== "merchant") throw new ApiError(400, "INVALID_USER");
  const owner = verifiedAuth.user;

  const deletedResidence = await ResidenceModel.findOneAndDelete({ _id: residenceId, owner: owner });
  if (!deletedResidence) throw new ApiError(404, "NOT_FOUND:Residence not found or access denied");

  await Merchant.findByIdAndUpdate(owner._id, { $pull: { residences: residenceId } }, { new: true });

  res.status(200).json(new ApiResponse(200, null, "Residence deleted successfully"));
});

export const getMerchantResidences = asyncHandler(async (req: Request, res: Response) => {
  const verifiedAuth = await verifyAuthentication(req);
  if (verifiedAuth?.userType !== "merchant") throw new ApiError(400, "INVALID_USER");
  const owner = verifiedAuth.user;
  const residences = await ResidenceModel.find({ owner });
  res.status(200).json(new ApiResponse(200, residences, "Residences retrieved successfully"));
});

export const getListOfResidence = asyncHandler(async (req, res) => {
  try {
    const longitude = z.coerce.number().optional().parse(req.query.longitude);
    const latitude = z.coerce.number().optional().parse(req.query.latitude);
    const owner = z.string().optional().parse(req.query.owner);

    const queries: mongoose.FilterQuery<IResident> = {};
    if (longitude && latitude) {
      queries.gpsLocation = {
        $near: {
          $geometry: { type: "Point", coordinates: [longitude, latitude] }
        }
      };
    }
    if (owner) queries.owner = owner;

    const result = await ResidenceModel.find(queries).exec();
    if (!result) throw new ApiError(500);

    res.status(200).json(new ApiResponse(200, result));
  } catch (error) {
    if (error instanceof z.ZodError) throw new ApiError(400, "INVALID_QUERY", error.issues);
    else if (error instanceof ApiError) throw error;
    console.log(error);
    throw new ApiError(500, "Server Error", error);
  }
});


export const createResidenceBooking = asyncHandler(async (req: Request, res: Response) => {
  const verifiedAuth = await verifyAuthentication(req);

  if (verifiedAuth?.userType !== "user") {
    throw new ApiError(403, "Only customers can book residences");
  }

  const {
    residenceId,
    bookingPeriod,
    vehicleNumber,
    bookedSlot,
    totalAmount,
    amountToPaid,
    couponCode,
    discount,
    priceRate,
    paymentDetails
  } = req.body;

  // Basic validation
  if (!residenceId || !bookingPeriod || !bookingPeriod.from || !bookingPeriod.to) {
    throw new ApiError(400, "Missing required booking fields");
  }

  const newBooking = await ResidenceBookingModel.create({
    residenceId,
    customerId: verifiedAuth.user._id,
    bookingPeriod,
    vehicleNumber,
    bookedSlot,
    totalAmount,
    amountToPaid,
    couponCode,
    discount,
    priceRate,
    paymentDetails
  });

  res.status(201).json(new ApiResponse(201, newBooking, "Residence booking created successfully"));
});


//  Get all bookings for a residence
export const getResidenceBookingsByResidence = asyncHandler(async (req: Request, res: Response) => {
  const { residenceId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(residenceId)) {
    throw new ApiError(400, "Invalid residence ID");
  }

  const bookings = await ResidenceBookingModel.find({ residenceId })
    .populate("customerId", "firstName lastName email phoneNumber");

  res.status(200).json(new ApiResponse(200, bookings, "Bookings fetched successfully"));
});


//  Get a single booking by ID
export const getResidenceBookingById = asyncHandler(async (req: Request, res: Response) => {
  const { bookingId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(bookingId)) {
    throw new ApiError(400, "Invalid booking ID");
  }

  const booking = await ResidenceBookingModel.findById(bookingId)
    .populate("customerId", "firstName lastName email phoneNumber");

  if (!booking) {
    throw new ApiError(404, "Booking not found");
  }

  res.status(200).json(new ApiResponse(200, booking, "Booking fetched successfully"));
});


//  Cancel/Delete a booking
export const deleteResidenceBooking = asyncHandler(async (req: Request, res: Response) => {
  const { bookingId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(bookingId)) {
    throw new ApiError(400, "Invalid booking ID");
  }

  const booking = await ResidenceBookingModel.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, "Booking not found");
  }

  await booking.deleteOne();

  res.status(200).json(new ApiResponse(200, null, "Booking cancelled successfully"));
});