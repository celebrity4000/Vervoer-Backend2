import { Request, Response } from "express";
import { Garage, GarageBooking } from "../models/merchant.garage.model.js";
import { ApiError } from "../utils/apierror.js";
import z from "zod/v4";
import { ApiResponse } from "../utils/apirespone.js";
import { asyncHandler } from "../utils/asynchandler.js";
import { verifyAuthentication } from "../middleware/verifyAuthhentication.js";
import mongoose from "mongoose";
import { generateParkingSpaceID } from "../utils/lotProcessData.js";
import uploadToCloudinary from "../utils/cloudinary.js";

// Zod schemas for validation
const GarageData = z.object({
  garageName: z.string().min(1, "Garage name is required"),
  about: z.string().min(1, "About is required"),
  address: z.string().min(1, "Address is required"),
  location: z.object({
    type: z.literal("Point"),
    coordinates: z.tuple([z.coerce.number(), z.coerce.number()])
  }).optional(),
  images : z.array(z.url()).optional(),
  contactNumber: z.string().min(9, "Contact number is required"),
  email: z.email().optional(),
  workingHours: z.array(z.object({
    day: z.enum(["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]),
    isOpen: z.coerce.boolean().default(true),
    openTime: z.string().optional(),
    closeTime: z.string().optional(),
    is24Hours: z.coerce.boolean().default(false)
  })),
  is24x7: z.coerce.boolean().default(false),
  emergencyContact: z.object({
    phone: z.string(),
    available: z.coerce.boolean()
  }).optional(),
  availableSlots: z.record(z.string().regex(/^[A-Z]{1,3}$/),z.coerce.number().min(1).max(1000))
});

const BookingData = z.object({
  garageId: z.string(),
  bookedSlot: z.object({
    zone : z.string().regex(/^[A-Z]{1,3}$/),
    slot : z.coerce.number().max(1000).min(1)
  }).transform((val)=>generateParkingSpaceID(val.zone,val.slot.toString())),
  bookingPeriod: z.object({
    from: z.iso.date(),
    to: z.iso.date()
  })
});

/**
 * Register a new garage
 */
export const registerGarage = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const rData = GarageData.parse(req.body);
      const verifiedAuth = await verifyAuthentication(req);
      
      if (verifiedAuth?.userType !== "merchant") {
        throw new ApiError(400, "INVALID_USER");
      }
      
      const owner = verifiedAuth.user;
      
      if (!owner) {
        throw new ApiError(400, "UNKNOWN_USER");
      }
      let imageURL:string[] = [] ;
      if(req.files){
        if(Array.isArray(req.files))
            imageURL = await Promise.all(req.files.map(
                (file)=>uploadToCloudinary(file.buffer))
            ).then(e=>e.map(e=>e.secure_url));
        else imageURL = await Promise.all(req.files.images.map(
                (file)=>uploadToCloudinary(file.buffer))
            ).then(e=>e.map(e=>e.secure_url));
      }

      const newGarage = await Garage.create({
        owner: owner._id,
        images: imageURL ,
        ...rData
      });

      // Update merchant's haveGarage status
      await mongoose.model("Merchant").findByIdAndUpdate(owner._id, {
        haveGarage: true
      });

      res.status(201).json(new ApiResponse(201, { garage: newGarage }));
    } catch (err) {
      if (err instanceof z.ZodError) {
        console.log(err.issues)
        throw new ApiError(400, "DATA_VALIDATION_ERROR", err.issues);
      }
      throw err;
    }
  }
);

/**
 * Edit an existing garage
 */
export const editGarage = asyncHandler(async (req: Request, res: Response) => {
  try {
    const garageId = z.string().parse(req.params.id);
    const updateData = GarageData.partial().parse(req.body);
    const verifiedAuth = await verifyAuthentication(req);

    if (verifiedAuth?.userType !== "merchant" || !verifiedAuth?.user) {
      throw new ApiError(400, "UNAUTHORIZED");
    }

    // Find the garage and verify ownership
    const garage = await Garage.findById(garageId);
    if (!garage) {
      throw new ApiError(404, "GARAGE_NOT_FOUND");
    }

    if (garage.owner.toString() !== verifiedAuth.user._id?.toString()) {
      throw new ApiError(403, "UNAUTHORIZED_ACCESS");
    }

    // Update the garage with new data
    let imageURL:string[] = [] ;
      if(req.files){
        if(Array.isArray(req.files))
            imageURL = await Promise.all(req.files.map(
                (file)=>uploadToCloudinary(file.buffer))
            ).then(e=>e.map(e=>e.secure_url));
        else imageURL = await Promise.all(req.files.images.map(
                (file)=>uploadToCloudinary(file.buffer))
            ).then(e=>e.map(e=>e.secure_url));
      }
    if(imageURL.length > 0){
        updateData.images = [...garage.images, ...imageURL]
    }
    const updatedGarage = await Garage.findByIdAndUpdate(
      garageId,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!updatedGarage) {
      throw new ApiError(500, "FAILED_TO_UPDATE_GARAGE");
    }

    res.status(200).json(new ApiResponse(200, { garage: updatedGarage }));
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new ApiError(400, "DATA_VALIDATION_ERROR", err.issues);
    }
    throw err;
  }
});

/**
 * Get available slots for a garage
 */
export const getAvailableSlots = asyncHandler(async (req: Request, res: Response) => {
  try {
    const startDate = z.iso.date().parse(req.query.startDate);
    const endDate = z.iso.date().parse(req.query.endDate);
    const garageId = z.string().parse(req.query.garageId);

    const garage = await Garage.findById(garageId);
    if (!garage) {
      throw new ApiError(404, "GARAGE_NOT_FOUND");
    }
    const totalSpace = garage.availableSlots?.values().toArray().reduce((acc, val) => acc + val, 0) || 0;
    // Get all bookings that overlap with the requested time period
    const bookings = await GarageBooking.find({
      garageId,
      $or: [
        {
          'bookingPeriod.from': { $lte: new Date(endDate) },
          'bookingPeriod.to': { $gte: new Date(startDate) }
        },
        {
          'bookingPeriod.from': { $gte: new Date(startDate), $lte: new Date(endDate) }
        },
        {
          'bookingPeriod.to': { $gte: new Date(startDate), $lte: new Date(endDate) }
        }
      ]
    }, "-customerId").exec();

    

    res.status(200).json(new ApiResponse(200, { 
      availableSlots: totalSpace - bookings.length,
      bookedSlot : bookings ,
      isOpen: garage.isOpenNow()
    }));
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new ApiError(400, "INVALID_QUERY", err.issues);
    }
    throw err;
  }
});

/**
 * Book a garage slot
 */
export const bookGarageSlot = asyncHandler(async (req: Request, res: Response) => {
  let session: mongoose.ClientSession | undefined;
  
  try {
    const verifiedUser = await verifyAuthentication(req);
    
    if (!(verifiedUser?.userType === "user" && verifiedUser?.user.isVerified)) {
      throw new ApiError(401, "User must be a verified user");
    }

    const rData = BookingData.parse(req.body);
    
    // Check if garage exists
    const garage = await Garage.findById(rData.garageId);
    if (!garage) {
      throw new ApiError(404, "GARAGE_NOT_FOUND");
    }

    // Check if the slot exists in availableSlots
    const maxSlots = garage.availableSlots?.get(rData.bookedSlot) || 0;
    if (maxSlots <= 0) {
      throw new ApiError(400, "INVALID_SLOT");
    }

    // Start transaction
    session = await mongoose.startSession();
    session.startTransaction();

    // Check for overlapping bookings
    const existingBookings = await GarageBooking.countDocuments({
      garageId: rData.garageId,
      bookedSlot: rData.bookedSlot,
      $or: [
        {
          'bookingPeriod.from': { $lt: new Date(rData.bookingPeriod.to) },
          'bookingPeriod.to': { $gt: new Date(rData.bookingPeriod.from) }
        },
        {
          'bookingPeriod.from': { $gte: new Date(rData.bookingPeriod.from), $lte: new Date(rData.bookingPeriod.to) }
        },
        {
          'bookingPeriod.to': { $gte: new Date(rData.bookingPeriod.from), $lte: new Date(rData.bookingPeriod.to) }
        }
      ]
    }).session(session);

    if (existingBookings >= maxSlots) {
      throw new ApiError(400, "SLOT_NOT_AVAILABLE");
    }

    // Create booking
    const booking = await GarageBooking.create([{
      garageId: rData.garageId,
      customerId: verifiedUser.user._id,
      bookedSlot: rData.bookedSlot,
      bookingPeriod: {
        from: new Date(rData.bookingPeriod.from),
        to: new Date(rData.bookingPeriod.to)
      },
      amountToPaid: 0 // Calculate based on your pricing model
    }], { session });

    await session.commitTransaction();
    
    res.status(201).json(new ApiResponse(201, { booking: booking[0] }));
  } catch (err) {
    if (session) {
      await session.abortTransaction();
    }
    if (err instanceof z.ZodError) {
      throw new ApiError(400, "DATA_VALIDATION_ERROR", err.issues);
    }
    throw err;
  } finally {
    if (session) {
      await session.endSession();
    }
  }
});

/**
 * Get garage details
 */
export const getGarageDetails = asyncHandler(async (req: Request, res: Response) => {
  try {
    const garageId = z.string().parse(req.params.id);
    
    const garage = await Garage.findById(garageId);
    if (!garage) {
      throw new ApiError(404, "GARAGE_NOT_FOUND");
    }

    res.status(200).json(new ApiResponse(200, { 
      garage,
      isOpen: garage.isOpenNow()
    }));
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new ApiError(400, "INVALID_ID");
    }
    throw err;
  }
});
