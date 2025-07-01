import { Request, Response } from "express";
import { Booking } from "../models/booking.model.js";
import { Driver } from "../models/driver.model.js";
import { DryCleaner } from "../models/merchant.model.js";
import { ApiError } from "../utils/apierror.js";
import { ApiResponse } from "../utils/apirespone.js";
import { asyncHandler } from "../utils/asynchandler.js";
import { z } from "zod";

// Booking Validation Schema
const bookingSchema = z.object({
  userId: z.string(),
  driverId: z.string(),
  dryCleanerId: z.string(),
  pickupAddress: z.string(),
  distance: z.number().positive(),
  time: z.number().positive(),
});

export const createBooking = asyncHandler(async (req: Request, res: Response) => {
  const data = bookingSchema.parse(req.body);

  const dryCleaner = await DryCleaner.findById(data.dryCleanerId);
  if (!dryCleaner) throw new ApiError(404, "Dry cleaner not found");

  const driver = await Driver.findById(data.driverId);
  if (!driver) throw new ApiError(404, "Driver not found");

  if (driver.isBooked) {
    throw new ApiError(400, "Driver already booked");
  }

  // Calculate price (₹10 per km)
  const price = data.distance * 10;

  const booking = await Booking.create({
    user: data.userId,
    driver: data.driverId,
    dryCleaner: data.dryCleanerId,
    pickupAddress: data.pickupAddress,
    dropoffAddress: `${dryCleaner.address.street}, ${dryCleaner.address.city}, ${dryCleaner.address.state}, ${dryCleaner.address.zipCode}`,
    distance: data.distance,
    time: data.time,
    price: price,
  });

  // Mark driver as booked
  driver.isBooked = true;
  await driver.save();

  res.status(201).json(new ApiResponse(201, { booking }, "Booking created successfully"));
});


const deliveryBookingSchema = z.object({
  dryCleanerId: z.string(),
  driverId: z.string(),
  userId: z.string(),
  dropoffAddress: z.string(),
  distance: z.number().positive(),
  time: z.number().positive()
});

// Controller
export const bookDriverForDelivery = asyncHandler(async (req: Request, res: Response) => {
  const data = deliveryBookingSchema.parse(req.body);

  // Fetch dry cleaner
  const dryCleaner = await DryCleaner.findById(data.dryCleanerId);
  if (!dryCleaner) throw new ApiError(404, "Dry cleaner not found");

  // Fetch driver
  const driver = await Driver.findById(data.driverId);
  if (!driver) throw new ApiError(404, "Driver not found");

  // Check if driver is already booked
  if (driver.isBooked) {
    throw new ApiError(400, "Driver is already booked");
  }

  // Calculate price: ₹10/km
  const price = data.distance * 10;

  // Construct pickup address string
  const pickupAddress = `${dryCleaner.address.street}, ${dryCleaner.address.city}, ${dryCleaner.address.state}, ${dryCleaner.address.zipCode}`;

  // Create booking
  const booking = await Booking.create({
    user: data.userId,
    driver: data.driverId,
    dryCleaner: data.dryCleanerId,
    pickupAddress,
    dropoffAddress: data.dropoffAddress,
    distance: data.distance,
    time: data.time,
    price
  });

  driver.isBooked = true;
  await driver.save();

  res.status(201).json(new ApiResponse(201, { booking }, "Delivery booked successfully"));
});


// cancle booking
export const cancelDriverBooking = asyncHandler(async (req: Request, res: Response) => {
  const bookingId = req.params.id;
  const { reason } = req.body;

  if (!reason) {
    throw new ApiError(400, "Cancellation reason is required.");
  }

  const booking = await Booking.findById(bookingId);
  if (!booking) {
    throw new ApiError(404, "Booking not found.");
  }

  const driver = await Driver.findById(booking.driver);
  if (driver) {
    driver.isBooked = false;
    await driver.save();
  }

  booking.cancellationReason = reason;
  
  await booking.save();

  await booking.deleteOne();

  res.status(200).json(new ApiResponse(200, null, "Driver booking cancelled successfully with reason."));
});