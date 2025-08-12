import { Request, Response } from "express";
import mongoose from "mongoose";
import { Booking } from "../models/booking.model.js";
import { Driver } from "../models/driver.model.js";
import { DryCleaner } from "../models/merchant.model.js";
import { User } from "../models/normalUser.model.js"; 
import { ApiError } from "../utils/apierror.js";
import { ApiResponse } from "../utils/apirespone.js"; 
import { asyncHandler } from "../utils/asynchandler.js";
import { z } from "zod";

// Validation Schemas
const bookingSchema = z.object({
  userId: z.string().refine(mongoose.Types.ObjectId.isValid, "Invalid user ID"),
  driverId: z.string().refine(mongoose.Types.ObjectId.isValid, "Invalid driver ID"),
  dryCleanerId: z.string().refine(mongoose.Types.ObjectId.isValid, "Invalid dry cleaner ID"),
  pickupAddress: z.string().min(1, "Pickup address is required"),
  distance: z.number().positive("Distance must be positive"),
  time: z.number().positive("Time must be positive"),
});

const deliveryBookingSchema = z.object({
  dryCleanerId: z.string().refine(mongoose.Types.ObjectId.isValid, "Invalid dry cleaner ID"),
  driverId: z.string().refine(mongoose.Types.ObjectId.isValid, "Invalid driver ID"),
  userId: z.string().refine(mongoose.Types.ObjectId.isValid, "Invalid user ID"),
  dropoffAddress: z.string().min(1, "Dropoff address is required"),
  distance: z.number().positive("Distance must be positive"),
  time: z.number().positive("Time must be positive")
});

const cancelBookingSchema = z.object({
  reason: z.string().min(1, "Cancellation reason is required")
});

// Create Pickup Booking
export const createBooking = asyncHandler(async (req: Request, res: Response) => {
  const data = bookingSchema.parse(req.body);
  
  // Start a session for transaction
  const session = await mongoose.startSession();
  
  try {
    let createdBooking;
    
    await session.withTransaction(async () => {
      // Verify all entities exist
      const [user, dryCleaner, driver] = await Promise.all([
        User.findById(data.userId).session(session),
        DryCleaner.findById(data.dryCleanerId).session(session),
        Driver.findById(data.driverId).session(session)
      ]);

      if (!user) throw new ApiError(404, "User not found");
      if (!dryCleaner) throw new ApiError(404, "Dry cleaner not found");
      if (!driver) throw new ApiError(404, "Driver not found");

      // Check if driver is available
      if (driver.isBooked) {
        throw new ApiError(400, "Driver is already booked");
      }

      // Calculate price (₹10 per km)
      const price = data.distance * 10;

      // Create booking
      const booking = await Booking.create([{
        user: data.userId,
        driver: data.driverId,
        dryCleaner: data.dryCleanerId,
        pickupAddress: data.pickupAddress,
        dropoffAddress: `${dryCleaner.address.street}, ${dryCleaner.address.city}, ${dryCleaner.address.state}, ${dryCleaner.address.zipCode}`,
        distance: data.distance,
        time: data.time,
        price: price,
        status: 'active'
      }], { session });

      // Mark driver as booked
      driver.isBooked = true;
      await driver.save({ session });

      createdBooking = booking[0];
    });

    await session.commitTransaction();
    
    res.status(201).json(
      new ApiResponse(201, { booking: createdBooking }, "Booking created successfully")
    );
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
});

// Create Delivery Booking
export const bookDriverForDelivery = asyncHandler(async (req: Request, res: Response) => {
  const data = deliveryBookingSchema.parse(req.body);
  
  const session = await mongoose.startSession();
  
  try {
    let createdBooking;
    
    await session.withTransaction(async () => {
      // Verify all entities exist
      const [user, dryCleaner, driver] = await Promise.all([
        User.findById(data.userId).session(session),
        DryCleaner.findById(data.dryCleanerId).session(session),
        Driver.findById(data.driverId).session(session)
      ]);

      if (!user) throw new ApiError(404, "User not found");
      if (!dryCleaner) throw new ApiError(404, "Dry cleaner not found");
      if (!driver) throw new ApiError(404, "Driver not found");

      // Check if driver is available
      if (driver.isBooked) {
        throw new ApiError(400, "Driver is already booked");
      }

      // Calculate price: ₹10/km
      const price = data.distance * 10;

      // Construct pickup address string
      const pickupAddress = `${dryCleaner.address.street}, ${dryCleaner.address.city}, ${dryCleaner.address.state}, ${dryCleaner.address.zipCode}`;

      // Create booking
      const booking = await Booking.create([{
        user: data.userId,
        driver: data.driverId,
        dryCleaner: data.dryCleanerId,
        pickupAddress,
        dropoffAddress: data.dropoffAddress,
        distance: data.distance,
        time: data.time,
        price,
        status: 'active'
      }], { session });

      // Mark driver as booked
      driver.isBooked = true;
      await driver.save({ session });

      createdBooking = booking[0];
    });

    await session.commitTransaction();
    
    res.status(201).json(
      new ApiResponse(201, { booking: createdBooking }, "Delivery booked successfully")
    );
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
});

// Cancel Booking
export const cancelDriverBooking = asyncHandler(async (req: Request, res: Response) => {
  const bookingId = req.params.id;
  
  // Validate booking ID
  if (!mongoose.Types.ObjectId.isValid(bookingId)) {
    throw new ApiError(400, "Invalid booking ID");
  }
  
  const { reason } = cancelBookingSchema.parse(req.body);
  
  const session = await mongoose.startSession();
  
  try {
    await session.withTransaction(async () => {
      const booking = await Booking.findById(bookingId).session(session);
      
      if (!booking) {
        throw new ApiError(404, "Booking not found");
      }

      // Check if booking is already cancelled
      if (booking.status === 'cancelled') {
        throw new ApiError(400, "Booking is already cancelled");
      }

      // Update booking status and add cancellation reason
      booking.status = 'cancelled';
      booking.cancellationReason = reason;
      await booking.save({ session });

      // Free up the driver
      const driver = await Driver.findById(booking.driver).session(session);
      if (driver) {
        driver.isBooked = false;
        await driver.save({ session });
      }
    });

    await session.commitTransaction();
    
    res.status(200).json(
      new ApiResponse(200, null, "Driver booking cancelled successfully")
    );
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
});

// Additional useful controllers

// Get booking by ID
export const getBooking = asyncHandler(async (req: Request, res: Response) => {
  const bookingId = req.params.id;
  
  if (!mongoose.Types.ObjectId.isValid(bookingId)) {
    throw new ApiError(400, "Invalid booking ID");
  }
  
  const booking = await Booking.findById(bookingId)
    .populate('user', 'name email phone')
    .populate('driver', 'name phone vehicleNumber')
    .populate('dryCleaner', 'name address phone');
    
  if (!booking) {
    throw new ApiError(404, "Booking not found");
  }
  
  res.status(200).json(
    new ApiResponse(200, { booking }, "Booking retrieved successfully")
  );
});

// Get user's bookings
export const getUserBookings = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.params.userId;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const status = req.query.status as string;
  
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new ApiError(400, "Invalid user ID");
  }
  
  const filter: any = { user: userId };
  if (status && ['active', 'completed', 'cancelled'].includes(status)) {
    filter.status = status;
  }
  
  const bookings = await Booking.find(filter)
    .populate('driver', 'name phone vehicleNumber')
    .populate('dryCleaner', 'name address phone')
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);
    
  const total = await Booking.countDocuments(filter);
  
  res.status(200).json(
    new ApiResponse(200, {
      bookings,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    }, "User bookings retrieved successfully")
  );
});

// Complete booking
export const completeBooking = asyncHandler(async (req: Request, res: Response) => {
  const bookingId = req.params.id;
  
  if (!mongoose.Types.ObjectId.isValid(bookingId)) {
    throw new ApiError(400, "Invalid booking ID");
  }
  
  const session = await mongoose.startSession();
  
  try {
    await session.withTransaction(async () => {
      const booking = await Booking.findById(bookingId).session(session);
      
      if (!booking) {
        throw new ApiError(404, "Booking not found");
      }
      
      if (booking.status !== 'active') {
        throw new ApiError(400, "Only active bookings can be completed");
      }
      
      // Update booking status
      booking.status = 'completed';
      await booking.save({ session });
      
      // Free up the driver
      const driver = await Driver.findById(booking.driver).session(session);
      if (driver) {
        driver.isBooked = false;
        await driver.save({ session });
      }
    });
    
    await session.commitTransaction();
    
    res.status(200).json(
      new ApiResponse(200, null, "Booking completed successfully")
    );
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
});