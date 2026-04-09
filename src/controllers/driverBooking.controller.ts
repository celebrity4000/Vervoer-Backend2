import { Request, Response } from "express";
import mongoose from "mongoose";
import { Booking } from "../models/booking.model.js";
import { IBooking } from "../models/booking.model.js";
import { Driver } from "../models/driver.model.js";
import { DryCleaner } from "../models/merchant.model.js";
import { User } from "../models/normalUser.model.js";
import { ApiError } from "../utils/apierror.js";
import { ApiResponse } from "../utils/apirespone.js";
import { asyncHandler } from "../utils/asynchandler.js";
import { verifyAuthentication } from "../middleware/verifyAuthhentication.js";
import { z } from "zod";
import { BookingNotificationManager } from "../middleware/BookingNotificationService.js";
import { getCurrentPricePerKm } from "./admin.controller.js";
import Stripe from "stripe";
import { v4 as uuidv4 } from "uuid";
import { ParsedQs } from "qs";
import express from "express";
import { NotificationService } from "../models/Notification.js";

import QRCode from "qrcode";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-06-30.basil",
});

const toString = (v: string | ParsedQs | (string | ParsedQs)[]): string => {
  if (Array.isArray(v)) {
    return v.length > 0 ? String(v[0]) : "";
  }
  return v !== undefined ? String(v) : "";
};
const VALID_BOOKING_STATUSES = [
  "pending",
  "accepted",
  "active",
  "completed",
  "cancelled",
  "rejected",
] as const;

// Enhanced Validation Schemas
const scheduledBookingRequestSchema = z.object({
  driverId: z
    .string()
    .refine(mongoose.Types.ObjectId.isValid, "Invalid driver ID"),
  dryCleanerId: z
    .string()
    .refine(mongoose.Types.ObjectId.isValid, "Invalid dry cleaner ID"),
  pickupAddress: z.string().min(1, "Pickup address is required"),
  distance: z.number().positive("Distance must be positive"),
  time: z.number().positive("Time must be positive"),
  message: z.string().optional(),
  // New scheduling fields
  scheduledPickupDate: z.string().refine((date) => {
    const parsedDate = new Date(date);
    const now = new Date();
    return parsedDate > now;
  }, "Scheduled pickup date must be in the future"),
  scheduledPickupTime: z
    .string()
    .regex(
      /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/,
      "Invalid time format. Use HH:MM",
    ),
});

const respondToBookingSchema = z.object({
  bookingId: z
    .string()
    .refine(mongoose.Types.ObjectId.isValid, "Invalid booking ID"),
  response: z.enum(["accept", "reject"], {
    message: "Response must be accept or reject",
  }),
  rejectionReason: z.string().optional(),
});

// ===== USER CONTROLLERS =====

// Create Scheduled Booking Request
export const createScheduledBookingRequest = asyncHandler(
  async (req: Request, res: Response) => {
    const authResult = await verifyAuthentication(req);

    if (authResult.userType !== "user") {
      throw new ApiError(403, "Only users can create booking requests");
    }

    const userId = String(authResult.user._id);
    const data = scheduledBookingRequestSchema.parse(req.body);

    const session = await mongoose.startSession();

    try {
      let createdBooking: any = null;

      await session.withTransaction(async () => {
        // Verify all entities exist
        const [user, dryCleaner, driver] = await Promise.all([
          User.findById(userId).session(session),
          DryCleaner.findById(data.dryCleanerId).session(session),
          Driver.findById(data.driverId).session(session),
        ]);
        // Move this AFTER session.commitTransaction()
        if (createdBooking) {
          setTimeout(async () => {
            await BookingNotificationManager.notifyDriverOfNewBooking(
              String(createdBooking._id),
            );
          }, 100);
        }

        if (!user) throw new ApiError(404, "User not found");
        if (!dryCleaner) throw new ApiError(404, "Dry cleaner not found");
        if (!driver) throw new ApiError(404, "Driver not found");

        // Check if user has any pending booking requests with this driver for the same date
        const scheduledDate = new Date(data.scheduledPickupDate);
        const dayStart = new Date(scheduledDate.setHours(0, 0, 0, 0));
        const dayEnd = new Date(scheduledDate.setHours(23, 59, 59, 999));

        const existingRequest = await Booking.findOne({
          user: userId,
          driver: data.driverId,
          status: "pending",
          scheduledPickupDateTime: {
            $gte: dayStart,
            $lte: dayEnd,
          },
        }).session(session);

        if (existingRequest) {
          throw new ApiError(
            400,
            "You already have a pending booking request with this driver for this date",
          );
        }

        // Parse scheduled date and time
        const [hours, minutes] = data.scheduledPickupTime
          .split(":")
          .map(Number);
        const scheduledDateTime = new Date(data.scheduledPickupDate);
        scheduledDateTime.setHours(hours, minutes, 0, 0);

        // Check if the scheduled time is at least 1 hour from now
        const oneHourFromNow = new Date();
        oneHourFromNow.setHours(oneHourFromNow.getHours() + 1);

        if (scheduledDateTime < oneHourFromNow) {
          throw new ApiError(
            400,
            "Pickup must be scheduled at least 1 hour in advance",
          );
        }

        // Calculate price ($10 per km)
        const price = data.distance * 10;

        // Set addresses - pickup is always user's address, delivery is dry cleaner
        const pickupAddress = data.pickupAddress;
        const dropoffAddress = `${dryCleaner.address.street}, ${dryCleaner.address.city}, ${dryCleaner.address.state}, ${dryCleaner.address.zipCode}`;

        // Create scheduled booking request with 'pending' status
        const booking = await Booking.create(
          [
            {
              user: userId,
              driver: data.driverId,
              dryCleaner: data.dryCleanerId,
              pickupAddress,
              dropoffAddress,
              distance: data.distance,
              time: data.time,
              price,
              status: "pending",
              bookingType: "pickup", // Always pickup for scheduled bookings
              message: data.message,
              requestedAt: new Date(),
              scheduledPickupDateTime: scheduledDateTime,
              isScheduled: true,
            },
          ],
          { session },
        );

        createdBooking = booking[0];

        // Send notification to driver
        setTimeout(async () => {
          await BookingNotificationManager.notifyDriverOfNewBooking(
            createdBooking._id.toString(),
          );
        }, 100);
      });

      await session.commitTransaction();

      res
        .status(201)
        .json(
          new ApiResponse(
            201,
            { booking: createdBooking },
            "Scheduled booking request sent to driver",
          ),
        );
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }
  },
);

// Get Available Drivers for Scheduling
export const getAvailableDriversForScheduling = asyncHandler(
  async (req: Request, res: Response) => {
    const authResult = await verifyAuthentication(req);

    if (authResult.userType !== "user") {
      throw new ApiError(403, "Only users can view available drivers");
    }

    const { date, time, dryCleanerId } = req.query;

    if (!date || !time || !dryCleanerId) {
      throw new ApiError(400, "Date, time, and dryCleanerId are required");
    }

    // Parse the requested date and time
    const [hours, minutes] = (time as string).split(":").map(Number);
    const requestedDateTime = new Date(date as string);
    requestedDateTime.setHours(hours, minutes, 0, 0);

    // Get all drivers
    const allDrivers = await Driver.find({ isActive: true }).select(
      "firstName lastName phoneNumber vehicleInfo profileImage rating",
    );

    // Check which drivers are available at the requested time
    const availableDrivers = [];

    for (const driver of allDrivers) {
      // Check if driver has any conflicting bookings at the requested time
      const conflictingBooking = await Booking.findOne({
        driver: driver._id,
        status: { $in: ["pending", "accepted", "active"] },
        $or: [
          // For scheduled bookings
          {
            scheduledPickupDateTime: {
              $gte: new Date(requestedDateTime.getTime() - 60 * 60 * 1000), // 1 hour before
              $lte: new Date(requestedDateTime.getTime() + 60 * 60 * 1000), // 1 hour after
            },
          },
          // For immediate bookings that might be active
          {
            isScheduled: { $ne: true },
            status: "active",
          },
        ],
      });

      if (!conflictingBooking) {
        availableDrivers.push(driver);
      }
    }

    res.status(200).json(
      new ApiResponse(
        200,
        {
          drivers: availableDrivers,
          requestedDateTime: requestedDateTime,
          totalAvailable: availableDrivers.length,
        },
        `Found ${availableDrivers.length} available drivers for the requested time`,
      ),
    );
  },
);

// Get User's Booking Requests (Enhanced with scheduling info)
export const getUserBookingRequests = asyncHandler(
  async (req: Request, res: Response) => {
    const authResult = await verifyAuthentication(req);

    if (authResult.userType !== "user") {
      throw new ApiError(403, "Only users can view their booking requests");
    }

    const userId = String(authResult.user._id);
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const status = req.query.status as string;
    const bookingType = req.query.bookingType as string; // 'scheduled' or 'immediate'

    const filter: any = { user: userId };

    if (status && VALID_BOOKING_STATUSES.includes(status as any)) {
      filter.status = status;
    }

    if (bookingType === "scheduled") {
      filter.isScheduled = true;
    } else if (bookingType === "immediate") {
      filter.isScheduled = { $ne: true };
    }

    const bookings = await Booking.find(filter)
      .populate(
        "driver",
        "firstName lastName phoneNumber vehicleInfo.vehicleNumber profileImage rating",
      )
      .populate("dryCleaner", "shopname address phoneNumber")
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Booking.countDocuments(filter);

    res.status(200).json(
      new ApiResponse(
        200,
        {
          bookings,
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit),
          },
        },
        "User booking requests retrieved successfully",
      ),
    );
  },
);

// Cancel Booking Request (Enhanced for scheduled bookings)
export const cancelBookingRequest = asyncHandler(
  async (req: Request, res: Response) => {
    const authResult = await verifyAuthentication(req);

    if (authResult.userType !== "user") {
      throw new ApiError(403, "Only users can cancel their booking requests");
    }

    const userId = String(authResult.user._id);
    const bookingId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      throw new ApiError(400, "Invalid booking ID");
    }

    const { reason } = req.body;

    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        const booking = await Booking.findOne({
          _id: bookingId,
          user: userId,
        }).session(session);

        if (!booking) {
          throw new ApiError(404, "Booking request not found");
        }

        // Only pending and accepted bookings can be cancelled by user
        if (!["pending", "accepted"].includes(booking.status)) {
          throw new ApiError(
            400,
            `Cannot cancel booking with status: ${booking.status}`,
          );
        }

        // For scheduled bookings, check if it's at least 30 minutes before scheduled time
        if (booking.isScheduled && booking.scheduledPickupDateTime) {
          const thirtyMinutesFromNow = new Date();
          thirtyMinutesFromNow.setMinutes(
            thirtyMinutesFromNow.getMinutes() + 30,
          );

          if (booking.scheduledPickupDateTime < thirtyMinutesFromNow) {
            throw new ApiError(
              400,
              "Cannot cancel scheduled booking less than 30 minutes before pickup time",
            );
          }
        }

        // Store original status before updating
        const originalStatus = booking.status;

        booking.status = "cancelled";
        booking.cancellationReason = reason || "Cancelled by user";
        booking.cancelledAt = new Date();
        await booking.save({ session });

        // If booking was originally accepted, free up the driver (only for immediate bookings)
        if (originalStatus === "accepted" && !booking.isScheduled) {
          const driver = await Driver.findById(booking.driver).session(session);
          if (driver) {
            driver.isBooked = false;
            await driver.save({ session });
          }
        }
      });

      await session.commitTransaction();

      res
        .status(200)
        .json(
          new ApiResponse(200, null, "Booking request cancelled successfully"),
        );
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }
  },
);

// ===== DRIVER CONTROLLERS =====

// ============================================================
// FIX: getDriverBookingRequests
// KEY FIX: Show ready_for_delivery bookings regardless of
// driver field state (driver may still be set from previous
// pickup trip when merchant marks ready_for_delivery).
// ============================================================

export const getDriverBookingRequests = asyncHandler(
  async (req: Request, res: Response) => {
    const authResult = await verifyAuthentication(req);
    if (authResult.userType !== "driver") {
      throw new ApiError(403, "Only drivers can view booking requests");
    }

    const driverId = String(authResult.user._id);
    if (!mongoose.Types.ObjectId.isValid(driverId)) {
      throw new ApiError(400, "Invalid driver ID");
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));

    // ── FIX: ready_for_delivery shown to ALL drivers (no driver filter) ──
    // When merchant marks order as ready_for_delivery the old driver is
    // now unset (see updateBookingStatus fix below), but as a safety net
    // we show ALL ready_for_delivery orders regardless of driver field so
    // existing bad documents in the DB are also surfaced.
    const filter: any = {
      $or: [
        // 1. Pending orders with no driver assigned (new pickup requests)
        {
          status: "pending",
          $or: [{ driver: { $exists: false } }, { driver: null }],
        },
        // 2. Ready for delivery orders – show to ALL drivers (return trip)
        //    NOTE: driver field is intentionally NOT filtered here so that
        //    legacy documents (where driver was not unset) still appear.
        {
          status: "ready_for_delivery",
        },
        // 3. Orders already assigned to this driver (active trips)
        {
          driver: new mongoose.Types.ObjectId(driverId),
          status: {
            $in: [
              "accepted",
              "in_progress",
              "pickup_completed",
              "en_route_to_dropoff",
              "arrived_at_dropoff",
            ],
          },
        },
        // 4. Merchant-assigned delivery for this driver
        {
          driver: new mongoose.Types.ObjectId(driverId),
          status: "accepted",
          bookingType: "delivery",
        },
      ],
    };

    try {
      const [bookings, total, driver] = await Promise.all([
        Booking.find(filter)
          .populate("user", "firstName lastName phoneNumber profileImage")
          .populate("dryCleaner", "shopname address phoneNumber")
          .sort({ createdAt: -1 })
          .limit(limit)
          .skip((page - 1) * limit)
          .lean(),
        Booking.countDocuments(filter),
        Driver.findById(driverId).select("isBooked currentBookingId").lean(),
      ]);

      console.log(`[Driver ${driverId}] Found ${bookings.length} bookings`);
      bookings.forEach((b) =>
        console.log(
          `  - ${b._id}: status=${b.status}, driver=${b.driver ? "assigned" : "null"}`,
        ),
      );

      res.status(200).json(
        new ApiResponse(
          200,
          {
            bookings,
            driverStatus: {
              isBooked: driver?.isBooked ?? false,
              currentBookingId: driver?.currentBookingId ?? null,
              message:
                bookings.length === 0
                  ? "No pending orders available at the moment"
                  : undefined,
            },
            pagination: {
              page,
              limit,
              total,
              pages: Math.ceil(total / limit),
            },
          },
          total > 0 ? `Found ${total} booking(s)` : "No bookings found",
        ),
      );
    } catch (error) {
      console.error("Error fetching booking requests:", error);
      throw new ApiError(500, "Failed to fetch booking requests");
    }
  },
);

// Get Driver's Scheduled Bookings for Today/Upcoming
export const getDriverScheduledBookings = asyncHandler(
  async (req: Request, res: Response) => {
    const authResult = await verifyAuthentication(req);

    if (authResult.userType !== "driver") {
      throw new ApiError(403, "Only drivers can view their scheduled bookings");
    }

    const driverId = String(authResult.user._id);
    const filter = (req.query.filter as string) || "today"; // 'today', 'upcoming', 'all'

    let dateFilter = {};
    const now = new Date();

    if (filter === "today") {
      const startOfDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      );
      const endOfDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        23,
        59,
        59,
      );
      dateFilter = {
        scheduledPickupDateTime: {
          $gte: startOfDay,
          $lte: endOfDay,
        },
      };
    } else if (filter === "upcoming") {
      dateFilter = {
        scheduledPickupDateTime: {
          $gt: now,
        },
      };
    }

    const bookingFilter = {
      driver: driverId,
      isScheduled: true,
      status: { $in: ["accepted", "active"] },
      ...dateFilter,
    };

    const scheduledBookings = await Booking.find(bookingFilter)
      .populate("user", "firstName lastName phoneNumber profileImage")
      .populate("dryCleaner", "shopname address phoneNumber")
      .sort({ scheduledPickupDateTime: 1 });

    res.status(200).json(
      new ApiResponse(
        200,
        {
          bookings: scheduledBookings,
          filter,
          count: scheduledBookings.length,
        },
        `Retrieved ${scheduledBookings.length} scheduled bookings`,
      ),
    );
  },
);

// Start Scheduled Trip (When it's time for pickup)
export const startScheduledTrip = asyncHandler(
  async (req: Request, res: Response) => {
    const authResult = await verifyAuthentication(req);

    if (authResult.userType !== "driver") {
      throw new ApiError(403, "Only drivers can start trips");
    }

    const driverId = String(authResult.user._id);
    const bookingId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      throw new ApiError(400, "Invalid booking ID");
    }

    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        const booking = await Booking.findOne({
          _id: bookingId,
          driver: driverId,
          status: "accepted",
          isScheduled: true,
        }).session(session);

        if (!booking) {
          throw new ApiError(404, "Accepted scheduled booking not found");
        }

        // Check if it's within the acceptable time window (30 minutes before to 30 minutes after)
        const now = new Date();
        const scheduledTime = booking.scheduledPickupDateTime!;
        const thirtyMinutesBefore = new Date(
          scheduledTime.getTime() - 30 * 60 * 1000,
        );
        const thirtyMinutesAfter = new Date(
          scheduledTime.getTime() + 30 * 60 * 1000,
        );

        if (now < thirtyMinutesBefore) {
          throw new ApiError(
            400,
            "Too early to start this trip. You can start 30 minutes before scheduled time.",
          );
        }

        if (now > thirtyMinutesAfter) {
          throw new ApiError(
            400,
            "This scheduled booking has expired. Please contact the customer.",
          );
        }

        const updatedBooking = await Booking.findByIdAndUpdate(
          booking._id,
          {
            $set: {
              status: "active",
              startedAt: now,
            },
          },
          {
            session,
            new: true,
          },
        );

        // Mark driver as currently busy
        const driver = await Driver.findById(driverId).session(session);
        if (driver) {
          driver.isBooked = true;
          await driver.save({ session });
        }

        // Send notification to user about trip start
        setTimeout(async () => {
          await BookingNotificationManager.notifyUserOfTripStart(bookingId);
        }, 100);
      });

      await session.commitTransaction();

      res.status(200).json(
        new ApiResponse(
          200,
          {
            bookingId: bookingId,
            status: "active",
            startedAt: new Date(),
          },
          "Scheduled trip started successfully",
        ),
      );
    } catch (error: any) {
      await session.abortTransaction();

      if (error instanceof ApiError) {
        throw error;
      } else {
        throw new ApiError(
          500,
          `Internal server error: ${error?.message || "Unknown error"}`,
        );
      }
    } finally {
      await session.endSession();
    }
  },
);

// Complete Trip (Enhanced for scheduled bookings)
export const completeTrip = asyncHandler(
  async (req: Request, res: Response) => {
    const authResult = await verifyAuthentication(req);

    if (authResult.userType !== "driver") {
      throw new ApiError(403, "Only drivers can complete trips");
    }

    const driverId = String(authResult.user._id);
    const bookingId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      throw new ApiError(400, "Invalid booking ID");
    }

    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        const booking = await Booking.findOne({
          _id: bookingId,
          driver: driverId,
          status: "active",
        }).session(session);

        if (!booking) {
          throw new ApiError(404, "Active booking not found");
        }

        // Complete the booking
        booking.status = "completed";
        booking.completedAt = new Date();
        await booking.save({ session });

        // Mark driver as available
        const driver = await Driver.findById(driverId).session(session);
        if (driver) {
          driver.isBooked = false;
          await driver.save({ session });
        }

        // Send notification to user about trip completion
        setTimeout(async () => {
          await BookingNotificationManager.notifyUserOfTripCompletion(
            bookingId,
          );
        }, 100);
      });

      await session.commitTransaction();

      res
        .status(200)
        .json(
          new ApiResponse(
            200,
            null,
            "Trip completed successfully. You are now available for new bookings",
          ),
        );
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }
  },
);

// Get Active Booking (Enhanced)
export const getActiveBooking = asyncHandler(
  async (req: Request, res: Response) => {
    const authResult = await verifyAuthentication(req);

    if (authResult.userType !== "driver") {
      throw new ApiError(403, "Only drivers can view their active booking");
    }

    const driverId = String(authResult.user._id);

    const booking = await Booking.findOne({
      driver: driverId,
      status: { $in: ["accepted", "active"] },
    })
      .populate("user", "firstName lastName phoneNumber profileImage")
      .populate("dryCleaner", "shopname address phoneNumber");

    if (!booking) {
      res
        .status(200)
        .json(
          new ApiResponse(200, { booking: null }, "No active booking found"),
        );
      return;
    }

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          { booking },
          "Active booking retrieved successfully",
        ),
      );
  },
);

export const setAvailabilityStatus = asyncHandler(
  async (req: Request, res: Response) => {
    const authResult = await verifyAuthentication(req);

    if (authResult.userType !== "driver") {
      throw new ApiError(403, "Only drivers can set their availability");
    }

    const driverId = String(authResult.user._id);
    const { isAvailable } = req.body;

    if (typeof isAvailable !== "boolean") {
      throw new ApiError(400, "isAvailable must be a boolean value");
    }

    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        const driver = await Driver.findById(driverId).session(session);
        if (!driver) {
          throw new ApiError(404, "Driver not found");
        }

        if (!isAvailable) {
          const activeBooking = await Booking.findOne({
            driver: driverId,
            status: { $in: ["accepted", "active"] },
          }).session(session);

          if (activeBooking) {
            throw new ApiError(
              400,
              "Cannot set unavailable while having active bookings",
            );
          }
        }

        driver.isBooked = !isAvailable;
        await driver.save({ session });
      });

      await session.commitTransaction();

      const statusMessage = isAvailable
        ? "You are now available for bookings"
        : "You are now unavailable for bookings";

      res
        .status(200)
        .json(new ApiResponse(200, { isAvailable }, statusMessage));
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }
  },
);

// Get Driver Booking History (Enhanced)
export const getDriverBookingHistory = asyncHandler(
  async (req: Request, res: Response) => {
    const authResult = await verifyAuthentication(req);

    if (authResult.userType !== "driver") {
      throw new ApiError(403, "Only drivers can view their booking history");
    }

    const driverId = String(authResult.user._id);
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const status = req.query.status as string;
    const bookingType = req.query.bookingType as string;

    const filter: any = { driver: driverId };

    if (
      status &&
      ["accepted", "active", "completed", "cancelled", "rejected"].includes(
        status,
      )
    ) {
      filter.status = status;
    } else {
      filter.status = { $ne: "pending" };
    }

    if (bookingType === "scheduled") {
      filter.isScheduled = true;
    } else if (bookingType === "immediate") {
      filter.isScheduled = { $ne: true };
    }

    const bookings = await Booking.find(filter)
      .populate("user", "firstName lastName phoneNumber profileImage")
      .populate("dryCleaner", "shopname address phoneNumber")
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Booking.countDocuments(filter);

    const completedBookings = await Booking.find({
      driver: driverId,
      status: "completed",
    });

    const totalEarnings = completedBookings.reduce(
      (sum, booking) => sum + booking.price,
      0,
    );

    res.status(200).json(
      new ApiResponse(
        200,
        {
          bookings,
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit),
          },
          totalEarnings,
          totalCompletedTrips: completedBookings.length,
        },
        "Driver booking history retrieved successfully",
      ),
    );
  },
);

// Add this utility function for consistent price calculation across your app:
export const calculateBookingPrice = async (
  distance: number,
): Promise<{ price: number; pricePerKm: number }> => {
  try {
    const pricePerKm = await getCurrentPricePerKm();
    const price = distance * pricePerKm;

    return {
      price: Math.round(price * 100) / 100,
      pricePerKm: pricePerKm,
    };
  } catch (error) {
    console.error("Error calculating booking price:", error);
    // Fallback to default pricing
    const defaultPrice = distance * 10;
    return {
      price: defaultPrice,
      pricePerKm: 10,
    };
  }
};

export const createBooking = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const authResult = await verifyAuthentication(req);
      if (authResult.userType !== "user") {
        throw new ApiError(403, "Only users can create bookings");
      }

      const userId = authResult.user._id;
      const {
        dryCleaner,
        pickupAddress,
        dropoffAddress,
        orderItems,
        pricing,
        deliveryCharge,
        scheduledPickupDateTime,
        scheduledDeliveryDateTime,
        distance,
        time,
        paymentMethod,
        message,
        orderNumber,
      } = req.body;

      console.log("🔍 Validating fields:", {
        hasDryCleaner: !!dryCleaner,
        hasPickupAddress: !!pickupAddress,
        hasDropoffAddress: !!dropoffAddress,
        hasOrderItems: !!orderItems,
        hasDeliveryCharge: !!deliveryCharge,
        deliveryChargeValue: deliveryCharge,
        orderItemsLength: orderItems?.length,
        hasPricing: !!pricing,
        hasScheduledPickup: !!scheduledPickupDateTime,
        orderNumber: orderNumber,
      });

      if (!dryCleaner) throw new ApiError(400, "Dry cleaner ID is required");
      if (!pickupAddress) throw new ApiError(400, "Pickup address is required");
      if (!dropoffAddress)
        throw new ApiError(400, "Dropoff address is required");
      if (!orderItems) throw new ApiError(400, "Order items are required");
      if (!pricing) throw new ApiError(400, "Pricing information is required");
      if (!orderItems || orderItems.length === 0) {
        throw new ApiError(400, "At least one order item is required");
      }
      if (!scheduledPickupDateTime) {
        throw new ApiError(400, "Scheduled pickup date and time is required");
      }
      if (!orderNumber) {
        throw new ApiError(400, "Order number is required");
      }

      // Validate date formats
      const pickupDate = new Date(scheduledPickupDateTime);
      if (isNaN(pickupDate.getTime())) {
        throw new ApiError(400, "Invalid pickup date format");
      }

      let deliveryDate = null;
      if (scheduledDeliveryDateTime) {
        deliveryDate = new Date(scheduledDeliveryDateTime);
        if (isNaN(deliveryDate.getTime())) {
          throw new ApiError(400, "Invalid delivery date format");
        }
      }

      // Check if orderNumber is unique
      const existingBooking = await Booking.findOne({ orderNumber });
      if (existingBooking) {
        throw new ApiError(400, `Order number ${orderNumber} already exists`);
      }

      const trackingId = `TRK-${Date.now()}-${uuidv4().slice(0, 6)}`;

      console.log("🔍 Creating booking with data:", {
        userId,
        dryCleaner,
        orderNumber,
        trackingId,
        itemsCount: orderItems.length,
        deliveryCharge,
        totalAmount: pricing.totalAmount,
      });

      const booking = new Booking({
        user: userId,
        dryCleaner,
        pickupAddress,
        dropoffAddress,
        orderItems,
        pricing,
        deliveryCharge,
        distance: distance || 10,
        time: time || 30,
        price: pricing.totalAmount,
        bookingType: "pickup",
        paymentMethod: paymentMethod || "CREDIT",
        paymentStatus: "pending",
        isScheduled: true,
        scheduledPickupDateTime: pickupDate,
        scheduledDeliveryDateTime: deliveryDate,
        message,
        status: "pending",
        orderNumber,
        Tracking_ID: trackingId,
      });

      const savedBooking = await booking.save();

      const populatedBooking = await Booking.findById(savedBooking._id)
        .populate("user", "firstName lastName phoneNumber email")
        .populate("dryCleaner", "shopname address phoneNumber");

      res
        .status(201)
        .json(
          new ApiResponse(
            201,
            populatedBooking,
            "Booking created successfully",
          ),
        );
    } catch (error: any) {
      console.error("❌ Error creating booking:");
      console.error("Error name:", error.name);
      console.error("Error message:", error.message);
      console.error("Error code:", error.code);
      console.error("Error stack:", error.stack);

      if (error.errors) {
        console.error("Validation errors:", error.errors);
      }

      if (error.keyPattern) {
        console.error("Duplicate key pattern:", error.keyPattern);
      }

      if (error instanceof ApiError) {
        throw error;
      }

      if (error.code === 11000) {
        throw new ApiError(400, "Duplicate order number or tracking ID");
      }

      if (error.name === "ValidationError") {
        const validationMessages = Object.values(error.errors).map(
          (err: any) => err.message,
        );
        throw new ApiError(
          400,
          `Validation failed: ${validationMessages.join(", ")}`,
        );
      }

      throw new ApiError(500, `Failed to create booking: ${error.message}`);
    }
  },
);

/* ------------------------------------------------------------------ */
export const createPaymentIntent = asyncHandler(
  async (req: Request, res: Response) => {
    console.log("🔑 ============================================");
    console.log("🔑 STRIPE KEY MODE CHECK:");
    console.log(
      "🔑 Backend Stripe Key Prefix:",
      process.env.STRIPE_SECRET_KEY?.substring(0, 10),
    );
    console.log(
      "🔑 Is Test Mode:",
      process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_"),
    );
    console.log(
      "🔑 Is Live Mode:",
      process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_"),
    );
    console.log("🔑 ============================================");

    const authResult = await verifyAuthentication(req);
    if (authResult.userType !== "user") {
      throw new ApiError(403, "Only users can create payment intents");
    }

    const { bookingId, amount, currency = "usd", orderNumber } = req.body;

    console.log("💳 Payment Intent Request:", {
      bookingId,
      amount,
      currency,
      orderNumber,
      userId: authResult.user._id,
      userEmail: authResult.user.email,
    });

    if (!bookingId || !amount) {
      throw new ApiError(400, "Booking ID and amount are required");
    }

    if (amount <= 0) {
      throw new ApiError(400, "Amount must be greater than 0");
    }

    const booking = await Booking.findOne({
      _id: bookingId,
      user: authResult.user._id,
    });

    if (!booking) {
      throw new ApiError(404, "Booking not found");
    }

    console.log("✅ Booking found:", {
      bookingId: booking._id,
      orderNumber: booking.orderNumber,
      currentPaymentStatus: booking.paymentStatus,
      existingPaymentIntentId: booking.paymentIntentId,
    });

    if (
      booking.paymentStatus === "paid" ||
      booking.paymentStatus === "completed"
    ) {
      throw new ApiError(400, "Booking is already paid");
    }

    // Get or create customer
    let customer;
    try {
      const customers = await stripe.customers.list({
        email: authResult.user.email,
        limit: 1,
      });

      if (customers.data.length > 0) {
        customer = customers.data[0];
        console.log("♻️ Found existing Stripe customer:", customer.id);
      } else {
        customer = await stripe.customers.create({
          email: authResult.user.email,
          name: `${authResult.user.firstName} ${authResult.user.lastName}`,
          phone: authResult.user.phoneNumber,
          metadata: {
            userId: authResult.user._id.toString(),
          },
        });
        console.log("🆕 Created new Stripe customer:", customer.id);
      }
    } catch (stripeError: any) {
      console.error("❌ Error creating/getting Stripe customer:", stripeError);
      throw new ApiError(500, "Failed to create payment customer");
    }

    console.log("💳 Creating payment intent with:", {
      amount: Math.round(amount),
      currency,
      customerId: customer.id,
    });

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount),
      currency,
      customer: customer.id,
      automatic_payment_methods: { enabled: true },
      metadata: {
        bookingId: bookingId.toString(),
        userId: authResult.user._id.toString(),
        orderNumber: orderNumber || booking.orderNumber || "N/A",
      },
      description: `Order ${orderNumber || booking.orderNumber} - Dry cleaning service`,
    });

    console.log("🔍 Client Secret Validation:");
    console.log("   Value:", paymentIntent.client_secret);
    console.log("   Length:", paymentIntent.client_secret?.length);
    console.log(
      "   Has _secret_:",
      paymentIntent.client_secret?.includes("_secret_"),
    );
    console.log(
      "   Starts with pi_:",
      paymentIntent.client_secret?.startsWith("pi_"),
    );

    if (!paymentIntent.client_secret) {
      console.error("❌ Client secret is null or undefined");
      throw new ApiError(500, "Payment intent missing client_secret");
    }

    if (!paymentIntent.client_secret.includes("_secret_")) {
      console.error('❌ Client secret does not contain "_secret_"');
      throw new ApiError(
        500,
        "Payment intent client_secret is in wrong format",
      );
    }

    if (!paymentIntent.client_secret.startsWith("pi_")) {
      console.error('❌ Client secret does not start with "pi_"');
      throw new ApiError(
        500,
        "Payment intent client_secret has invalid prefix",
      );
    }

    console.log("✅ Client secret validation PASSED");

    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customer.id },
      { apiVersion: "2024-06-20" },
    );

    await Booking.findByIdAndUpdate(bookingId, {
      paymentIntentId: paymentIntent.id,
      paymentStatus: "pending",
    });

    const responseData = {
      paymentIntent: paymentIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customerId: customer.id,
      paymentIntentId: paymentIntent.id,
    };

    console.log("📤 Response Validation:");
    console.log("   Has Payment Intent:", !!responseData.paymentIntent);
    console.log(
      "   Format Valid:",
      responseData.paymentIntent.includes("_secret_"),
    );
    console.log(
      "   Matches ID:",
      responseData.paymentIntent.includes(responseData.paymentIntentId),
    );

    if (!responseData.paymentIntent.includes("_secret_")) {
      console.error("❌ Response validation failed");
      throw new ApiError(500, "Response validation failed");
    }

    console.log("✅ All validations passed, sending response");

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          responseData,
          "Payment intent created successfully",
        ),
      );
  },
);

/* ------------------------------------------------------------------ */
export const confirmPayment = asyncHandler(
  async (req: Request, res: Response) => {
    const authResult = await verifyAuthentication(req);
    if (authResult.userType !== "user") {
      throw new ApiError(403, "Only users can confirm payments");
    }

    const { bookingId, paymentIntentId } = req.body;

    if (!bookingId || !paymentIntentId) {
      throw new ApiError(400, "Booking ID and payment intent ID are required");
    }

    const booking = await Booking.findOne({
      _id: bookingId,
      user: authResult.user._id,
    });

    if (!booking) {
      throw new ApiError(404, "Booking not found");
    }

    if (booking.paymentStatus === "paid") {
      throw new ApiError(400, "Booking payment is already confirmed");
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== "succeeded") {
      throw new ApiError(
        400,
        `Payment not completed. Status: ${paymentIntent.status}`,
      );
    }

    if (paymentIntent.metadata.bookingId !== bookingId.toString()) {
      throw new ApiError(400, "Payment intent does not match booking");
    }

    const updatedBooking = await Booking.findByIdAndUpdate(
      bookingId,
      {
        paymentStatus: "paid",
        acceptedAt: new Date(),
        paidAt: new Date(),
      },
      { new: true },
    )
      .populate("user", "firstName lastName phoneNumber email")
      .populate("dryCleaner", "shopname address phoneNumber");

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          updatedBooking,
          "Payment confirmed successfully. Your booking is now confirmed!",
        ),
      );
  },
);

/* ------------------------------------------------------------------ */
export const getUserBookings = asyncHandler(
  async (req: Request, res: Response) => {
    const authResult = await verifyAuthentication(req);
    if (authResult.userType !== "user")
      throw new ApiError(403, "Only users can view their bookings");

    const { status, page = "1", limit = "10" } = req.query;

    const currentPage = parseInt(toString(page), 10);
    const pageSize = parseInt(toString(limit), 10);
    const skip = (currentPage - 1) * pageSize;

    const query: any = { user: authResult.user._id };
    if (status) query.status = toString(status);

    const bookings = await Booking.find(query)
      .populate("dryCleaner", "shopname address phoneNumber")
      .populate("driver", "firstName lastName phoneNumber")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageSize);

    const totalBookings = await Booking.countDocuments(query);

    res.status(200).json(
      new ApiResponse(
        200,
        {
          bookings,
          pagination: {
            currentPage,
            totalPages: Math.ceil(totalBookings / pageSize),
            totalBookings,
            hasNext: skip + bookings.length < totalBookings,
            hasPrev: currentPage > 1,
          },
        },
        "Bookings retrieved successfully",
      ),
    );
  },
);

/* ------------------------------------------------------------------ */
export const getBookingDetails = asyncHandler(
  async (req: Request, res: Response) => {
    const authResult = await verifyAuthentication(req);
    const { bookingId } = req.params;

    if (!bookingId) {
      throw new ApiError(400, "Booking ID is required");
    }

    console.log("=== GET BOOKING DETAILS ===");
    console.log("BookingId:", bookingId);
    console.log("Auth UserId:", authResult.user._id);
    console.log("UserType:", authResult.userType);

    let booking;

    if (authResult.userType === "user") {
      booking = await Booking.findOne({
        _id: bookingId,
        user: authResult.user._id,
      });
      console.log("Searched as USER");
    } else if (authResult.userType === "merchant") {
      console.log("Searching as MERCHANT");

      const dryCleaners = await DryCleaner.find({
        owner: authResult.user._id,
      }).select("_id");

      const dryCleanerIds = dryCleaners.map((dc) => dc._id);

      console.log("Merchant's dry cleaner IDs:", dryCleanerIds);

      if (dryCleanerIds.length === 0) {
        console.log("No dry cleaners found for merchant");
        throw new ApiError(404, "No dry cleaners found for this merchant");
      }

      booking = await Booking.findOne({
        _id: bookingId,
        dryCleaner: { $in: dryCleanerIds },
      });

      console.log("Booking found:", booking ? "YES" : "NO");
    } else if (authResult.userType === "driver") {
      booking = await Booking.findOne({
        _id: bookingId,
        driver: authResult.user._id,
      });
      console.log("Searched as DRIVER");
    } else {
      throw new ApiError(403, "Unauthorized access");
    }

    if (!booking) {
      console.log("Booking not found!");
      throw new ApiError(404, "Booking not found");
    }

    console.log("Booking found, populating data...");

    const populatedBooking = await Booking.findById(booking._id)
      .populate("user", "firstName lastName phoneNumber email")
      .populate("dryCleaner", "shopname address phoneNumber")
      .populate("driver", "firstName lastName phoneNumber");

    console.log("=== END GET BOOKING DETAILS ===");

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          populatedBooking,
          "Booking details retrieved successfully",
        ),
      );
  },
);

export const getOrderReceipt = asyncHandler(
  async (req: Request, res: Response) => {
    const { orderId } = req.params;

    let booking;

    if (orderId.match(/^[0-9a-fA-F]{24}$/)) {
      booking = await Booking.findById(orderId)
        .populate("dryCleaner", "shopname address phoneNumber")
        .populate("user", "firstName lastName email")
        .lean();
    }

    if (!booking) {
      const orderNumber = orderId.startsWith("#")
        ? orderId.substring(1)
        : orderId;
      booking = await Booking.findOne({
        $or: [{ orderNumber: orderNumber }, { orderNumber: `#${orderNumber}` }],
      })
        .populate("dryCleaner", "shopname address phoneNumber")
        .populate("user", "firstName lastName email")
        .lean();
    }

    if (!booking) {
      throw new ApiError(404, "Booking not found");
    }

    const receipt = {
      orderId: `#${booking.orderNumber}`,
      trackingId:
        (booking as any).trackingId || (booking as any).Tracking_ID || "N/A",
      totalAmount: `${booking.pricing.totalAmount.toFixed(2)}`,
      paymentMessage: `We wish to inform you that $${booking.pricing.totalAmount} has been debited from your ${booking.paymentMethod || "Debit"} Card ending with 1234 on ${new Date(
        booking.paidAt || booking.createdAt,
      )
        .toLocaleString("en-US", {
          month: "2-digit",
          day: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        })
        .replace(",", "")}`,
      items: booking.orderItems.map((item: any) => ({
        qty: item.quantity,
        price: `$${item.price.toFixed(2)}`,
        name: item.name,
        subtext: item.washOnly
          ? "Wash Only"
          : item.options?.washAndFold
            ? "Wash & Fold"
            : "",
      })),
      dryCleanerName: (booking.dryCleaner as any)?.shopname,
      dryCleanerAddress: (booking.dryCleaner as any)?.address,
      unclaimedItems: [
        {
          description: "Cost for making 30 consecutive storage",
          price: "$5.00",
        },
        { description: "Cost for overnight storage", price: "$20.00/Night" },
        { description: "Cost for donating", price: "$10.00" },
      ],
    };

    res
      .status(200)
      .json(new ApiResponse(200, receipt, "Receipt fetched successfully"));
  },
);

export const updatePickupAddress = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { bookingId } = req.params;
    const { pickupAddress } = req.body;

    const authUser = req.authUser;

    if (!authUser) {
      res.status(401).json(new ApiResponse(401, null, "Unauthorized"));
      return;
    }

    if (authUser.userType !== "user") {
      res
        .status(403)
        .json(
          new ApiResponse(
            403,
            null,
            "Access denied - Only users can update pickup address",
          ),
        );
      return;
    }

    if (!pickupAddress) {
      res
        .status(400)
        .json(new ApiResponse(400, null, "pickupAddress is required"));
      return;
    }

    const userId = authUser.user._id;
    console.log(
      "updatePickupAddress - userId:",
      userId,
      "bookingId:",
      bookingId,
    );

    try {
      const booking = await Booking.findOne({
        _id: bookingId,
        user: userId,
      });

      if (!booking) {
        res
          .status(404)
          .json(
            new ApiResponse(404, null, "Booking not found or access denied"),
          );
        return;
      }

      if (!booking.createdAt) {
        res
          .status(400)
          .json(
            new ApiResponse(400, null, "Booking creation time not available"),
          );
        return;
      }

      const now = new Date();
      const allowedUntil = new Date(
        booking.createdAt.getTime() + 2 * 60 * 60 * 1000,
      );

      if (now > allowedUntil) {
        res
          .status(400)
          .json(
            new ApiResponse(
              400,
              null,
              "Pickup address can only be updated within 2 hours of booking creation",
            ),
          );
        return;
      }

      booking.pickupAddress = pickupAddress;
      await booking.save();

      console.log(
        "updatePickupAddress - Successfully updated for booking:",
        bookingId,
      );

      res
        .status(200)
        .json(
          new ApiResponse(200, booking, "Pickup address updated successfully"),
        );
    } catch (error) {
      console.error("updatePickupAddress - Error:", error);
      res
        .status(500)
        .json(new ApiResponse(500, null, "Failed to update pickup address"));
    }
  },
);

export const userBokinghistory = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const authUser = req.authUser;

    if (!authUser) {
      res
        .status(401)
        .json(new ApiResponse(401, null, "Unauthorized - No auth user found"));
      return;
    }

    if (authUser.userType !== "user") {
      res
        .status(403)
        .json(
          new ApiResponse(
            403,
            null,
            "Access denied - Only users can view booking history",
          ),
        );
      return;
    }

    const userId = authUser.user._id;

    try {
      const userObjectId = new mongoose.Types.ObjectId(userId);

      const bookings = await Booking.find({ user: userObjectId })
        .populate("dryCleaner", "shopname email phoneNumber address")
        .populate("user", "firstName lastName email")
        .sort({ createdAt: -1 })
        .lean();

      if (bookings.length === 0) {
        console.log("userBokinghistory - No bookings found for user:", userId);
        res.status(200).json(new ApiResponse(200, [], "No bookings found"));
        return;
      }

      res
        .status(200)
        .json(
          new ApiResponse(200, bookings, "User bookings fetched successfully"),
        );
    } catch (error) {
      console.error("userBokinghistory - Database error:", error);

      if (error instanceof mongoose.Error.CastError) {
        res
          .status(400)
          .json(new ApiResponse(400, null, "Invalid user ID format"));
      } else {
        res
          .status(500)
          .json(new ApiResponse(500, null, "Failed to fetch bookings"));
      }
    }
  },
);

export const generateBookingQRCode = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const bookingId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      res.status(400).json(new ApiResponse(400, null, "Invalid booking ID"));
      return;
    }

    const booking = await Booking.findById(bookingId).populate(
      "user",
      "firstName lastName email",
    );

    if (!booking) {
      res.status(404).json(new ApiResponse(404, null, "Booking not found"));
      return;
    }

    const qrData = {
      bookingId: (booking._id as mongoose.Types.ObjectId).toString(),
      user: booking.user,
      dryCleaner: booking.dryCleaner,
      status: booking.status,
      totalAmount: booking.pricing?.totalAmount,
      pickupAddress: booking.pickupAddress,
      dropoffAddress: booking.dropoffAddress,
    };

    const qrCodeImage = await QRCode.toDataURL(JSON.stringify(qrData));

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          { booking, qrCode: qrCodeImage },
          "QR code generated successfully",
        ),
      );
  },
);

// ================================================================
// notification
// ================================================================

interface PopulatedCustomer {
  _id: mongoose.Types.ObjectId;
  name?: string;
  email?: string;
}

interface PopulatedBooking extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  user?: PopulatedCustomer;
  driver?: mongoose.Types.ObjectId;
  status: string;
  acceptedAt?: Date;
  rejectedAt?: Date;
  rejectionReason?: string;
  startedAt?: Date;
  completedAt?: Date;
  cancellationReason?: string;
  cancelledAt?: Date;
  pickupCompletedAt?: Date;
  dropoffCompletedAt?: Date;
  pickup?: string;
  dropOff?: string;
  deliveryCharge?: number;
  miles?: string;
  time?: string;
  paymentStatus?: string;
  paymentIntentId?: string;
}

interface AuthUser {
  _id: mongoose.Types.ObjectId;
  name?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  [key: string]: any;
}

interface AuthResult {
  user: AuthUser;
  userType: string;
}

type NotificationType =
  | "booking_accepted"
  | "booking_rejected"
  | "driver_update"
  | "payment"
  | "general";

const parseQueryParam = (param: any, defaultValue: number): number => {
  if (typeof param === "string") {
    const parsed = parseInt(param, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }
  if (typeof param === "number") {
    return param;
  }
  return defaultValue;
};

const parseQueryBoolean = (param: any, defaultValue: boolean): boolean => {
  if (typeof param === "string") {
    return param === "true";
  }
  if (typeof param === "boolean") {
    return param;
  }
  return defaultValue;
};

export const getUserNotifications = asyncHandler(
  async (req: Request, res: Response) => {
    const authResult = (await verifyAuthentication(req)) as AuthResult;
    const userId = authResult.user._id;

    const { limit, offset, unreadOnly } = req.query;

    const result = await NotificationService.getUserNotifications(
      userId.toString(),
      {
        limit: parseQueryParam(limit, 50),
        offset: parseQueryParam(offset, 0),
        unreadOnly: parseQueryBoolean(unreadOnly, false),
      },
    );

    res
      .status(200)
      .json(
        new ApiResponse(200, result, "Notifications retrieved successfully"),
      );
  },
);

export const markNotificationAsRead = asyncHandler(
  async (req: Request, res: Response) => {
    const authResult = (await verifyAuthentication(req)) as AuthResult;
    const userId = authResult.user._id;
    const { notificationId } = req.params;

    if (!notificationId || !mongoose.Types.ObjectId.isValid(notificationId)) {
      throw new ApiError(400, "Invalid notification ID format");
    }

    const notification = await NotificationService.markAsRead(
      notificationId,
      userId.toString(),
    );

    res
      .status(200)
      .json(new ApiResponse(200, notification, "Notification marked as read"));
  },
);

export const markAllNotificationsAsRead = asyncHandler(
  async (req: Request, res: Response) => {
    const authResult = (await verifyAuthentication(req)) as AuthResult;
    const userId = authResult.user._id;

    const result = await NotificationService.markAllAsRead(userId.toString());

    res
      .status(200)
      .json(new ApiResponse(200, result, "All notifications marked as read"));
  },
);

export const deleteAllNotifications = asyncHandler(
  async (req: Request, res: Response) => {
    const authResult = (await verifyAuthentication(req)) as AuthResult;
    const userId = authResult.user._id;

    await NotificationService.deleteAllNotifications(userId.toString());

    res
      .status(200)
      .json(
        new ApiResponse(200, null, "All notifications deleted successfully"),
      );
  },
);

export const sendTestNotification = asyncHandler(
  async (req: Request, res: Response) => {
    const authResult = (await verifyAuthentication(req)) as AuthResult;
    const userId = authResult.user._id;

    const { type = "general", title, message } = req.body;

    const notification = await NotificationService.createNotification({
      userId: userId.toString(),
      title: title || "Test Notification",
      message: message || "This is a test notification.",
      type: type as NotificationType,
      priority: "normal",
    });

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          notification,
          "Test notification sent successfully",
        ),
      );
  },
);

// Simple booking response handler
export const respondToBookingRequest = asyncHandler(async (req: Request, res: Response) => {
  const authResult = (await verifyAuthentication(req)) as AuthResult;
  if (authResult.userType !== "driver") {
    throw new ApiError(403, "Only drivers can respond to booking requests");
  }

  const driverId = authResult.user._id;
  const driverName = authResult.user.name || "Driver";
  const { bookingId, response = "accept", rejectionReason } = req.body;

  if (!bookingId || !mongoose.Types.ObjectId.isValid(bookingId)) {
    throw new ApiError(400, "Invalid booking ID format");
  }

  if (!["accept", "reject"].includes(response)) {
    throw new ApiError(400, "Response must be 'accept' or 'reject'");
  }

  try {
    let updatedBooking: PopulatedBooking | null;

    if (response === "accept") {
      updatedBooking = (await Booking.findOneAndUpdate(
        {
          _id: bookingId,
          status: { $in: ["pending", "ready_for_delivery"] },
        },
        {
          driver: driverId,
          status: "accepted",
          acceptedAt: new Date(),
          $set: { bookingType: "delivery" },
        },
        { new: true }
      ).populate("user", "name email")) as unknown as PopulatedBooking | null;

      if (!updatedBooking) {
        throw new ApiError(404, "Booking request not found or already processed");
      }

      if (updatedBooking.user) {
        await NotificationService.sendBookingAcceptedNotification(
          updatedBooking.user._id.toString(),
          bookingId,
          driverName
        );
      }

      res.status(200).json(
        new ApiResponse(200, {
          bookingId,
          status: "accepted",
          driverId,
          acceptedAt: updatedBooking.acceptedAt,
        }, "Booking accepted successfully")
      );
    } else {
      const booking = await Booking.findById(bookingId).populate("user", "name email");
      if (!booking || booking.status !== "pending") {
        throw new ApiError(404, "Booking not available for rejection");
      }
      if (booking.user) {
        await NotificationService.sendBookingRejectedNotification(
          booking.user._id.toString(),
          bookingId,
          `${driverName} declined your request, but other drivers can still accept it.`
        );
      }
      await notifyOtherAvailableDrivers(booking, driverId.toString());
      res.status(200).json(
        new ApiResponse(200, { bookingId, status: "pending" }, "Booking rejected but remains available")
      );
    }
  } catch (error) {
    console.error("Booking response error:", error);
    throw new ApiError(500, `Failed to respond to booking: ${(error as Error).message}`);
  }
});

const notifyOtherAvailableDrivers = async (
  booking: PopulatedBooking,
  excludeDriverId: string,
) => {
  try {
    const availableDrivers = await User.find({
      userType: "driver",
      isActive: true,
      isAvailable: true,
      _id: { $ne: excludeDriverId },
    });

    console.log(
      `Found ${availableDrivers.length} other available drivers for booking ${booking._id}`,
    );

    const notificationPromises = availableDrivers.map(async (driver: any) => {
      try {
        await NotificationService.createNotification({
          userId: driver._id.toString(),
          title: "Booking Available",
          message: `A dry cleaning pickup is available: ${booking.pickup || "Location"} - ${booking.deliveryCharge || "22.30"}`,
          type: "general" as NotificationType,
          priority: "high",
          data: {
            bookingId: booking._id.toString(),
            pickup: booking.pickup,
            dropOff: booking.dropOff,
            deliveryCharge: booking.deliveryCharge,
            miles: booking.miles,
            time: booking.time,
            customerName: booking.user?.name,
          },
        });

        console.log(
          `Notification sent to driver ${driver._id} for booking ${booking._id}`,
        );
      } catch (error) {
        console.error(`Failed to notify driver ${driver._id}:`, error);
      }
    });

    await Promise.all(notificationPromises);

    return {
      success: true,
      notifiedDrivers: availableDrivers.length,
    };
  } catch (error) {
    console.error("Error notifying other available drivers:", error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
};

// ================================================================
// updateBookingStatus
// KEY FIX: When status becomes "ready_for_delivery", $unset the
// driver field so any driver can pick up the return delivery.
// ================================================================
export const updateBookingStatus = asyncHandler(
  async (req: Request, res: Response) => {
    const authResult = (await verifyAuthentication(req)) as AuthResult;
    const userId = authResult.user._id;
    const userType = authResult.userType;

    const {
      bookingId,
      status,
      driverId,
      startedAt,
      completedAt,
      pickupCompletedAt,
      dropoffCompletedAt,
      driverName,
      location,
      notes,
      routeDistance,
      routeDuration,
    } = req.body;

    if (!bookingId || !mongoose.Types.ObjectId.isValid(bookingId)) {
      throw new ApiError(400, "Invalid booking ID format");
    }
    if (!status) throw new ApiError(400, "Status is required");

    const validStatuses = [
      "pending", "accepted", "in_progress", "pickup_completed",
      "en_route_to_dropoff", "arrived_at_dropoff", "dropped_at_center",
      "ready_for_delivery", "completed", "cancelled", "rejected",
    ];
    if (!validStatuses.includes(status)) {
      throw new ApiError(400, `Invalid status. Must be one of: ${validStatuses.join(", ")}`);
    }

    try {
      const existingBooking = await Booking.findById(bookingId).populate("user", "name email");
      if (!existingBooking) throw new ApiError(404, "Booking not found");

      // Authorization
      if (userType === "driver") {
        if (existingBooking.driver && existingBooking.driver.toString() !== userId.toString())
          throw new ApiError(403, "You can only update your own bookings");
      } else if (userType === "customer") {
        if (existingBooking.user?._id.toString() !== userId.toString())
          throw new ApiError(403, "You can only update your own bookings");
      } else if (userType === "merchant") {
        const dryCleaners = await DryCleaner.find({ owner: userId }).select("_id");
        const ownedIds = dryCleaners.map((d) => d._id.toString());
        if (!ownedIds.includes(existingBooking.dryCleaner?.toString()))
          throw new ApiError(403, "This booking does not belong to your shop");
        const merchantAllowedStatuses = ["ready_for_delivery", "cancelled"];
        if (!merchantAllowedStatuses.includes(status))
          throw new ApiError(403, `Merchants can only set status to: ${merchantAllowedStatuses.join(", ")}`);
      } else {
        throw new ApiError(403, "Only drivers, customers, and merchants can update booking status");
      }

      // Status transition validation
      const currentStatus = existingBooking.status;
      const validTransitions: Record<string, string[]> = {
        pending:              ["accepted", "rejected", "cancelled"],
        accepted:             ["in_progress", "cancelled"],
        in_progress:          ["pickup_completed", "cancelled"],
        pickup_completed:     ["en_route_to_dropoff", "cancelled"],
        en_route_to_dropoff:  ["arrived_at_dropoff", "cancelled"],
        arrived_at_dropoff:   ["dropped_at_center", "completed", "cancelled"],  
        dropped_at_center:    ["ready_for_delivery", "cancelled"],
        ready_for_delivery:   ["accepted", "cancelled"],
        completed:            [],
        cancelled:            [],
        rejected:             [],
      };
      if (!validTransitions[currentStatus]?.includes(status)) {
        throw new ApiError(400, `Invalid status transition from "${currentStatus}" to "${status}"`);
      }

      // Build $set payload
      const setData: any = { status, updatedAt: new Date() };
      // Tracks whether we need to $unset the driver field
      let shouldUnsetDriver = false;

      switch (status) {
        case "accepted":
          if (driverId) {
            setData.driver = driverId;
            setData.acceptedAt = new Date();
          }
          break;
        case "in_progress":
          if (driverId) setData.driver = driverId;
          setData.startedAt = startedAt ? new Date(startedAt) : new Date();
          break;
        case "pickup_completed":
          setData.pickupCompletedAt = pickupCompletedAt
            ? new Date(pickupCompletedAt)
            : new Date();
          break;
        case "dropped_at_center":
          setData.dropoffCompletedAt = dropoffCompletedAt
            ? new Date(dropoffCompletedAt)
            : new Date();
          if (routeDistance) setData.routeDistance = routeDistance;
          if (routeDuration) setData.routeDuration = routeDuration;
          break;

        // ── KEY FIX ──────────────────────────────────────────────────────
        // Merchant marks order as ready for return delivery.
        // Unset the driver so the order appears as a fresh pickup
        // for any available driver in getDriverBookingRequests.
        case "ready_for_delivery":
          setData.readyAt = new Date();
          setData.bookingType = "delivery";
          shouldUnsetDriver = true; // will add $unset below
          console.log(
            `[Merchant] Booking ${bookingId} → ready_for_delivery. Unsetting driver field.`,
          );
          break;
        // ─────────────────────────────────────────────────────────────────

        case "completed":
          setData.completedAt = completedAt
            ? new Date(completedAt)
            : new Date();
          if (!setData.dropoffCompletedAt) {
            setData.dropoffCompletedAt = dropoffCompletedAt
              ? new Date(dropoffCompletedAt)
              : new Date();
          }
          break;
        case "cancelled":
          setData.cancelledAt = new Date();
          if (notes) setData.cancellationReason = notes;
          break;
      }

      if (location) setData.currentLocation = location;
      if (notes) setData.statusNotes = notes;

      // Build final Mongoose update – conditionally add $unset
      const mongoUpdate: any = { $set: setData };
      if (shouldUnsetDriver) {
        mongoUpdate.$unset = { driver: "" };
      }

      const updatedBooking = await Booking.findByIdAndUpdate(
        bookingId,
        mongoUpdate,
        { new: true },
      ).populate("user", "name email");

      if (!updatedBooking) throw new ApiError(404, "Failed to update booking");

      // Notify customer
      if (updatedBooking.user) {
        await sendStatusChangeNotification(
          updatedBooking.user._id,
          bookingId,
          status,
          driverName || authResult.user.name || "Driver",
        );
      }

      res.status(200).json(
        new ApiResponse(
          200,
          {
            bookingId: updatedBooking._id,
            status: updatedBooking.status,
            updatedAt: setData.updatedAt,
            ...(updatedBooking.startedAt && { startedAt: updatedBooking.startedAt }),
            ...(updatedBooking.completedAt && { completedAt: updatedBooking.completedAt }),
            ...(updatedBooking.pickupCompletedAt && { pickupCompletedAt: updatedBooking.pickupCompletedAt }),
            ...(updatedBooking.dropoffCompletedAt && { dropoffCompletedAt: updatedBooking.dropoffCompletedAt }),
            ...(updatedBooking.cancelledAt && { cancelledAt: updatedBooking.cancelledAt }),
          },
          getStatusUpdateMessage(status),
        ),
      );
    } catch (error) {
      console.error("Update booking status error:", error);
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        500,
        `Failed to update booking status: ${(error as Error)?.message || "Unknown error"}`,
      );
    }
  },
);

const sendStatusChangeNotification = async (
  userId: mongoose.Types.ObjectId,
  bookingId: string,
  status: string,
  driverName: string,
) => {
  const notificationData = getNotificationForStatus(status, driverName);

  if (!notificationData) return;

  if (
    status === "accepted" &&
    typeof NotificationService.sendBookingAcceptedNotification === "function"
  ) {
    await NotificationService.sendBookingAcceptedNotification(
      userId.toString(),
      bookingId,
      driverName,
    );
  } else if (
    status === "rejected" &&
    typeof NotificationService.sendBookingRejectedNotification === "function"
  ) {
    await NotificationService.sendBookingRejectedNotification(
      userId.toString(),
      bookingId,
      driverName,
    );
  } else {
    await NotificationService.createNotification({
      userId: userId.toString(),
      title: notificationData.title,
      message: notificationData.message,
      type: notificationData.type as NotificationType,
      priority: notificationData.priority,
      data: {
        bookingId,
        status,
        driverName,
        timestamp: new Date().toISOString(),
      },
    });
  }
};

const getNotificationForStatus = (status: string, driverName: string) => {
  const notifications: Record<
    string,
    {
      title: string;
      message: string;
      type: NotificationType;
      priority: "high" | "normal" | "low";
    }
  > = {
    accepted: {
      title: "Booking Accepted!",
      message: `Your dry cleaning pickup has been accepted by ${driverName}. They will arrive shortly.`,
      type: "booking_accepted",
      priority: "high",
    },
    in_progress: {
      title: "Driver is on the way!",
      message: `${driverName} has started the trip and is heading to your pickup location.`,
      type: "driver_update",
      priority: "high",
    },
    pickup_completed: {
      title: "Items Picked Up!",
      message: `${driverName} has collected your dry cleaning items and is heading to the cleaners.`,
      type: "driver_update",
      priority: "normal",
    },
    en_route_to_dropoff: {
      title: "On the way back!",
      message: `${driverName} is returning with your cleaned items.`,
      type: "driver_update",
      priority: "normal",
    },
    arrived_at_dropoff: {
      title: "Driver has arrived!",
      message: `${driverName} has arrived at your dropoff location.`,
      type: "driver_update",
      priority: "high",
    },
    completed: {
      title: "Trip Completed!",
      message:
        "Your dry cleaning service has been completed successfully. Thank you for choosing our service!",
      type: "general",
      priority: "normal",
    },
    cancelled: {
      title: "Booking Cancelled",
      message:
        "Your dry cleaning booking has been cancelled. Please book again if needed.",
      type: "general",
      priority: "high",
    },
  };

  return notifications[status] || null;
};

function getStatusUpdateMessage(status: string): string {
  const messages: Record<string, string> = {
    pending: "Booking is pending",
    accepted: "Booking accepted successfully",
    in_progress: "Trip started",
    pickup_completed: "Items picked up successfully",
    en_route_to_dropoff: "En route to dropoff location",
    arrived_at_dropoff: "Arrived at dropoff location",
    dropped_at_center: "Items dropped at dry cleaning center",
    ready_for_delivery: "Order is ready for delivery. Driver has been unassigned.",
    completed: "Booking completed successfully",
    cancelled: "Booking cancelled",
    rejected: "Booking rejected",
  };

  return messages[status] || "Status updated";
}

export const driverCancelBooking = asyncHandler(
  async (req: Request, res: Response) => {
    const authResult = (await verifyAuthentication(req)) as AuthResult;

    if (authResult.userType !== "driver") {
      throw new ApiError(
        403,
        "Only drivers can cancel bookings using this endpoint",
      );
    }

    const driverId = authResult.user._id;
    const { bookingId, cancellationReason, driverName } = req.body;

    if (!bookingId || !mongoose.Types.ObjectId.isValid(bookingId)) {
      throw new ApiError(400, "Invalid booking ID format");
    }

    try {
      const existingBooking = (await Booking.findOne({
        _id: bookingId,
        driver: driverId,
      }).populate("user", "name email")) as PopulatedBooking | null;

      if (!existingBooking) {
        throw new ApiError(404, "Booking not found or not assigned to you");
      }

      if (["completed", "cancelled"].includes(existingBooking.status)) {
        throw new ApiError(
          400,
          `Cannot cancel booking with status: ${existingBooking.status}`,
        );
      }

      const updateData = {
        status: "pending",
        driver: null,
        cancelledAt: new Date(),
        cancellationReason:
          cancellationReason || "Driver cancelled - now available for others",
        updatedAt: new Date(),
      };

      const updatedBooking = (await Booking.findByIdAndUpdate(
        bookingId,
        updateData,
        { new: true },
      ).populate("user", "name email")) as unknown as PopulatedBooking;

      if (updatedBooking?.user) {
        try {
          await NotificationService.createNotification({
            userId: updatedBooking.user._id.toString(),
            title: "Driver Changed",
            message: `${driverName || "Your driver"} had to cancel, but we're finding you another driver. Your booking is still active.`,
            type: "driver_update" as NotificationType,
            priority: "high",
            data: {
              bookingId: updatedBooking._id.toString(),
              reason: cancellationReason,
              cancelledBy: "driver",
              status: "finding_new_driver",
              timestamp: new Date().toISOString(),
            },
          });
          console.log(
            "Driver cancellation notification sent to customer:",
            updatedBooking.user._id,
          );
        } catch (notificationError) {
          console.error(
            "Failed to send driver cancellation notification:",
            notificationError,
          );
        }
      }

      await notifyOtherAvailableDrivers(updatedBooking, driverId.toString());

      res.status(200).json(
        new ApiResponse(
          200,
          {
            bookingId: updatedBooking._id,
            status: updatedBooking.status,
            cancelledAt: updatedBooking.cancelledAt,
            cancellationReason: updatedBooking.cancellationReason,
          },
          "Booking cancelled successfully. Other drivers have been notified and can accept this booking.",
        ),
      );
    } catch (error) {
      console.error("Driver cancel booking error:", error);

      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(
        500,
        `Failed to cancel booking: ${(error as Error)?.message || "Unknown error"}`,
      );
    }
  },
);

export const cancelBooking = asyncHandler(
  async (req: Request, res: Response) => {
    const authResult = (await verifyAuthentication(req)) as AuthResult;

    if (authResult.userType !== "user") {
      throw new ApiError(403, "Only users can cancel their bookings");
    }

    const { bookingId } = req.params;
    const { cancellationReason } = req.body;

    if (!bookingId) {
      throw new ApiError(400, "Booking ID is required");
    }

    const booking = await Booking.findOne({
      _id: bookingId,
      user: authResult.user._id,
    });

    if (!booking) {
      throw new ApiError(404, "Booking not found");
    }

    if (booking.status === "completed") {
      throw new ApiError(400, "Cannot cancel completed booking");
    }

    if (booking.status === "cancelled") {
      throw new ApiError(400, "Booking is already cancelled");
    }

    let refundProcessed = false;

    if (booking.paymentStatus === "paid" && booking.paymentIntentId) {
      try {
        // Stripe refund logic here if needed
      } catch (refundError: any) {
        console.error("Error processing refund:", refundError);
      }
    }

    const updatedBooking = await Booking.findByIdAndUpdate(
      bookingId,
      {
        status: "cancelled",
        cancelledAt: new Date(),
        cancellationReason: cancellationReason || "Cancelled by user",
        paymentStatus: refundProcessed ? "refunded" : booking.paymentStatus,
        driver: null,
      },
      { new: true },
    ).populate("dryCleaner", "shopname address phoneNumber");

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          { booking: updatedBooking, refundProcessed },
          refundProcessed
            ? "Booking cancelled successfully and refund processed"
            : "Booking cancelled successfully",
        ),
      );
  },
);

export const getMerchantBookings = asyncHandler(
  async (req: Request, res: Response) => {
    const authResult = await verifyAuthentication(req);

    if (authResult.userType !== "merchant") {
      throw new ApiError(403, "Only merchants can view their bookings");
    }

    const { status, page = "1", limit = "10" } = req.query;

    const currentPage = parseInt(toString(page), 10);
    const pageSize = parseInt(toString(limit), 10);
    const skip = (currentPage - 1) * pageSize;

    console.log("=== DEBUG: Merchant Bookings ===");
    console.log("Merchant ID:", authResult.user._id);

    const allDryCleaners = await DryCleaner.find({}).limit(5);
    console.log("Total dry cleaners in DB:", await DryCleaner.countDocuments());

    const byMerchant = await DryCleaner.find({ merchant: authResult.user._id });
    const byOwner = await DryCleaner.find({ owner: authResult.user._id });
    const byMerchantId = await DryCleaner.find({ merchantId: authResult.user._id });
    const byUserId = await DryCleaner.find({ userId: authResult.user._id });
    const byCreatedBy = await DryCleaner.find({ createdBy: authResult.user._id });

    console.log("Found by merchant field:", byMerchant.length);
    console.log("Found by owner field:", byOwner.length);
    console.log("Found by merchantId field:", byMerchantId.length);
    console.log("Found by userId field:", byUserId.length);
    console.log("Found by createdBy field:", byCreatedBy.length);

    let dryCleaners = byMerchant;
    if (byOwner.length > 0) dryCleaners = byOwner;
    else if (byMerchantId.length > 0) dryCleaners = byMerchantId;
    else if (byUserId.length > 0) dryCleaners = byUserId;
    else if (byCreatedBy.length > 0) dryCleaners = byCreatedBy;

    const dryCleanerIds = dryCleaners.map((dc) => dc._id);
    console.log("Found dry cleaners:", dryCleanerIds);

    if (dryCleanerIds.length === 0) {
      res.status(200).json(
        new ApiResponse(
          200,
          {
            bookings: [],
            pagination: {
              currentPage,
              totalPages: 0,
              totalBookings: 0,
              hasNext: false,
              hasPrev: false,
            },
          },
          "No dry cleaners found for this merchant",
        ),
      );
      return;
    }

    const query: any = { dryCleaner: { $in: dryCleanerIds } };

    if (status) {
      query.status = toString(status);
    }

    console.log("Booking query:", query);

    const bookings = await Booking.find(query)
      .populate("user", "firstName lastName phoneNumber email")
      .populate("dryCleaner", "shopname address phoneNumber")
      .populate("driver", "firstName lastName phoneNumber")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageSize);

    const totalBookings = await Booking.countDocuments(query);

    console.log("Found bookings:", bookings.length);
    console.log("=== END DEBUG ===");

    res.status(200).json(
      new ApiResponse(
        200,
        {
          bookings,
          pagination: {
            currentPage,
            totalPages: Math.ceil(totalBookings / pageSize),
            totalBookings,
            hasNext: skip + bookings.length < totalBookings,
            hasPrev: currentPage > 1,
          },
        },
        "Merchant bookings retrieved successfully",
      ),
    );
  },
);

async function assertMerchantOwnsBooking(
  bookingId: string,
  merchantId: string,
): Promise<InstanceType<typeof Booking>> {
  const booking = await Booking.findById(bookingId).populate(
    "user",
    "firstName lastName phoneNumber email",
  );

  if (!booking) throw new ApiError(404, "Booking not found");

  const dryCleaners = await DryCleaner.find({ owner: merchantId }).select("_id");
  const ownedIds = dryCleaners.map((d) => d._id.toString());

  if (!ownedIds.includes(booking.dryCleaner.toString())) {
    throw new ApiError(403, "This booking does not belong to your shop");
  }

  return booking as any;
}

export const merchantBookDeliveryDriver = asyncHandler(
  async (req: Request, res: Response) => {
    const authResult = await verifyAuthentication(req);

    if (authResult.userType !== "merchant") {
      throw new ApiError(403, "Only merchants can book delivery drivers");
    }

    const merchantId = String(authResult.user._id);
    const {
      bookingId,
      driverId,
      pickupAddress,
      dropoffAddress,
    } = req.body;

    if (!bookingId || !mongoose.Types.ObjectId.isValid(bookingId)) {
      throw new ApiError(400, "Invalid booking ID");
    }
    if (!driverId || !mongoose.Types.ObjectId.isValid(driverId)) {
      throw new ApiError(400, "Invalid driver ID");
    }
    if (!pickupAddress || !dropoffAddress) {
      throw new ApiError(400, "Pickup and dropoff addresses are required");
    }

    const session = await mongoose.startSession();

    try {
      let updatedBooking: any = null;

      await session.withTransaction(async () => {
        const booking = await assertMerchantOwnsBooking(bookingId, merchantId);

        const allowedStatuses = ["dropped_at_center", "ready_for_delivery"];
        if (!allowedStatuses.includes(booking.status)) {
          throw new ApiError(
            400,
            `Cannot book driver for a booking with status "${booking.status}". ` +
            `Allowed statuses: ${allowedStatuses.join(", ")}`,
          );
        }

        const driver = await Driver.findById(driverId).session(session);
        if (!driver) throw new ApiError(404, "Driver not found");

        if (driver.isBooked) {
          throw new ApiError(400, "Selected driver is currently busy. Please choose another driver.");
        }

        const activeBooking = await Booking.findOne({
          driver: driverId,
          status: { $in: ["accepted", "in_progress", "pickup_completed", "en_route_to_dropoff"] },
        }).session(session);

        if (activeBooking) {
          throw new ApiError(
            400,
            "This driver already has an active booking. Please choose another driver.",
          );
        }

        updatedBooking = await Booking.findByIdAndUpdate(
          bookingId,
          {
            driver: driverId,
            status: "accepted",
            pickupAddress: pickupAddress,
            dropoffAddress: dropoffAddress,
            bookingType: "delivery",
            acceptedAt: new Date(),
            $set: {
              "metadata.isReturnDelivery": true,
              "metadata.merchantInitiated": true,
              "metadata.merchantId": merchantId,
            },
          },
          { new: true, session },
        )
          .populate("user", "firstName lastName phoneNumber email")
          .populate("dryCleaner", "shopname address phoneNumber")
          .populate("driver", "firstName lastName phoneNumber vehicleInfo");

        if (!updatedBooking) {
          throw new ApiError(500, "Failed to update booking");
        }

        await Driver.findByIdAndUpdate(
          driverId,
          { isBooked: true },
          { session },
        );
      });

      await session.commitTransaction();

      if (updatedBooking) {
        try {
          const driverUser = await Driver.findById(driverId);
          if (driverUser) {
            await NotificationService.createNotification({
              userId: driverId,
              title: "New Delivery Assignment",
              message:
                `You have been assigned to deliver cleaned items. ` +
                `Pickup from dry cleaner, deliver to customer.`,
              type: "booking_accepted",
              priority: "high",
              data: {
                bookingId: updatedBooking._id.toString(),
                bookingType: "return_delivery",
                pickupAddress,
                dropoffAddress,
                orderNumber: updatedBooking.orderNumber,
              },
            });
          }

          if (updatedBooking.user) {
            await NotificationService.createNotification({
              userId: updatedBooking.user._id.toString(),
              title: "Your Clothes Are On Their Way! 🚚",
              message:
                `Great news! Your cleaned items are being picked up from ` +
                `${updatedBooking.dryCleaner?.shopname ?? "the dry cleaner"} ` +
                `and will be delivered to you shortly.`,
              type: "driver_update",
              priority: "high",
              data: {
                bookingId: updatedBooking._id.toString(),
                status: "accepted",
                driverName: `${updatedBooking.driver?.firstName} ${updatedBooking.driver?.lastName}`,
              },
            });
          }
        } catch (notifError) {
          console.error("Failed to send notifications:", notifError);
        }
      }

      res.status(200).json(
        new ApiResponse(
          200,
          {
            booking: updatedBooking,
            message: "Driver successfully assigned for delivery",
            driver: updatedBooking?.driver,
          },
          "Delivery driver booked successfully. The driver and customer have been notified.",
        ),
      );
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }
  },
);

export const getMerchantBookingDetails = asyncHandler(
  async (req: Request, res: Response) => {
    const authResult = await verifyAuthentication(req);

    if (authResult.userType !== "merchant") {
      throw new ApiError(403, "Only merchants can access this endpoint");
    }

    const { bookingId } = req.params;

    if (!bookingId || !mongoose.Types.ObjectId.isValid(bookingId)) {
      throw new ApiError(400, "Invalid booking ID");
    }

    const merchantId = String(authResult.user._id);
    const booking = await assertMerchantOwnsBooking(bookingId, merchantId);

    const populated = await Booking.findById(booking._id)
      .populate("user", "firstName lastName phoneNumber email")
      .populate("dryCleaner", "shopname address phoneNumber")
      .populate("driver", "firstName lastName phoneNumber vehicleInfo rating");

    res.status(200).json(
      new ApiResponse(200, populated, "Booking details retrieved successfully"),
    );
  },
);

export const getAvailableDriversForMerchant = asyncHandler(
  async (req: Request, res: Response) => {
    const authResult = await verifyAuthentication(req);

    if (authResult.userType !== "merchant") {
      throw new ApiError(403, "Only merchants can access this endpoint");
    }

    const drivers = await Driver.find({
      isBooked: { $ne: true },
    }).select(
      "firstName lastName phoneNumber vehicleInfo rating profileImage isBooked",
    );

    const busyDriverIds = await Booking.distinct("driver", {
      status: { $in: ["accepted", "in_progress", "pickup_completed", "en_route_to_dropoff"] },
      driver: { $exists: true, $ne: null },
    });

    const busySet = new Set(busyDriverIds.map(String));
    const availableDrivers = drivers.filter((d) => !busySet.has(String(d._id)));

    res.status(200).json(
      new ApiResponse(
        200,
        {
          drivers: availableDrivers,
          total: availableDrivers.length,
        },
        `${availableDrivers.length} driver(s) available`,
      ),
    );
  },
);