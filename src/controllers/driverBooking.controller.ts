import { Request, Response } from "express";
import mongoose from "mongoose";
import { Booking } from "../models/booking.model.js";
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
      "Invalid time format. Use HH:MM"
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
              String(createdBooking._id)
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
            "You already have a pending booking request with this driver for this date"
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
            "Pickup must be scheduled at least 1 hour in advance"
          );
        }

        // Calculate price (₹10 per km)
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
          { session }
        );

        createdBooking = booking[0];

        // Send notification to driver
        setTimeout(async () => {
          await BookingNotificationManager.notifyDriverOfNewBooking(
            createdBooking._id.toString()
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
            "Scheduled booking request sent to driver"
          )
        );
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }
  }
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
      "firstName lastName phoneNumber vehicleInfo profileImage rating"
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
        `Found ${availableDrivers.length} available drivers for the requested time`
      )
    );
  }
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
        "firstName lastName phoneNumber vehicleInfo.vehicleNumber profileImage rating"
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
        "User booking requests retrieved successfully"
      )
    );
  }
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
            `Cannot cancel booking with status: ${booking.status}`
          );
        }

        // For scheduled bookings, check if it's at least 30 minutes before scheduled time
        if (booking.isScheduled && booking.scheduledPickupDateTime) {
          const thirtyMinutesFromNow = new Date();
          thirtyMinutesFromNow.setMinutes(
            thirtyMinutesFromNow.getMinutes() + 30
          );

          if (booking.scheduledPickupDateTime < thirtyMinutesFromNow) {
            throw new ApiError(
              400,
              "Cannot cancel scheduled booking less than 30 minutes before pickup time"
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
          new ApiResponse(200, null, "Booking request cancelled successfully")
        );
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }
  }
);

// ===== DRIVER CONTROLLERS =====

// Get Driver's Booking Requests (Enhanced with scheduling info)
export const getDriverBookingRequests = asyncHandler(
  async (req: Request, res: Response) => {
    const authResult = await verifyAuthentication(req);

    if (authResult.userType !== "driver") {
      throw new ApiError(403, "Only drivers can view their booking requests");
    }

    const driverId = authResult.user._id;
    const driverObjectId = new mongoose.Types.ObjectId(driverId);

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(
      50,
      Math.max(1, parseInt(req.query.limit as string) || 10)
    );
    const status = req.query.status as string;
    const bookingType = req.query.bookingType as string; // 'scheduled' or 'immediate'

    const filter: any = {
      $or: [
        { driver: driverId },
        { driver: driverObjectId },
        { driver: driverId.toString() },
      ],
    };

    if (status && VALID_BOOKING_STATUSES.includes(status as any)) {
      filter.status = status;
    }

    if (bookingType === "scheduled") {
      filter.isScheduled = true;
    } else if (bookingType === "immediate") {
      filter.isScheduled = { $ne: true };
    }

    try {
      const bookings = await Booking.find(filter)
        .populate("user", "firstName lastName phoneNumber profileImage")
        .populate("dryCleaner", "shopname address phoneNumber")
        .sort({
          // Sort scheduled bookings by pickup time, others by creation time
          scheduledPickupDateTime: 1,
          createdAt: -1,
        })
        .limit(limit)
        .skip((page - 1) * limit)
        .lean();

      const total = await Booking.countDocuments(filter);

      const pagination = {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1,
      };

      res.status(200).json(
        new ApiResponse(
          200,
          {
            bookings,
            pagination,
            filter: {
              driverId: driverId.toString(),
              status: status || "all",
              bookingType: bookingType || "all",
            },
          },
          total > 0
            ? `Found ${total} booking request${total > 1 ? "s" : ""} for driver`
            : "No booking requests found for this driver"
        )
      );
    } catch (error) {
      console.error("Error fetching driver booking requests:", error);
      throw new ApiError(500, "Failed to fetch booking requests");
    }
  }
);

// Driver Responds to Booking Request (Enhanced for scheduled bookings)
export const respondToBookingRequest = asyncHandler(
  async (req: Request, res: Response) => {
    const authResult = await verifyAuthentication(req);

    if (authResult.userType !== "driver") {
      throw new ApiError(403, "Only drivers can respond to booking requests");
    }

    const driverId = authResult.user._id;
    console.log("🐛 DEBUG - Driver ID:", driverId);
    console.log("🐛 DEBUG - Request body:", req.body);

    const data = respondToBookingSchema.parse(req.body);
    console.log("🐛 DEBUG - Parsed data:", data);

    if (!mongoose.Types.ObjectId.isValid(data.bookingId)) {
      throw new ApiError(400, "Invalid booking ID format");
    }

    const session = await mongoose.startSession();

    try {
      let responseMessage = "";

      await session.withTransaction(async () => {
        const booking = await Booking.findOne({
          _id: new mongoose.Types.ObjectId(data.bookingId),
          $or: [
            { driver: driverId },
            { driver: new mongoose.Types.ObjectId(driverId) },
            { driver: driverId.toString() },
          ],
          status: "pending",
        }).session(session);

        console.log("🐛 DEBUG - Found booking:", booking);

        if (!booking) {
          throw new ApiError(
            404,
            "Pending booking request not found or doesn't belong to you"
          );
        }

        const driver = await Driver.findById(driverId).session(session);
        console.log("🐛 DEBUG - Found driver:", driver ? "Yes" : "No");

        if (!driver) {
          throw new ApiError(404, "Driver profile not found");
        }

        if (data.response === "accept") {
          // For immediate bookings, check if driver is already booked
          if (!booking.isScheduled && driver.isBooked) {
            throw new ApiError(
              400,
              "You are already booked with another request"
            );
          }

          // For scheduled bookings, check for time conflicts
          if (booking.isScheduled && booking.scheduledPickupDateTime) {
            const conflictingBooking = await Booking.findOne({
              driver: driverId,
              status: { $in: ["accepted", "active"] },
              _id: { $ne: booking._id },
              scheduledPickupDateTime: {
                $gte: new Date(
                  booking.scheduledPickupDateTime.getTime() - 60 * 60 * 1000
                ),
                $lte: new Date(
                  booking.scheduledPickupDateTime.getTime() + 60 * 60 * 1000
                ),
              },
            }).session(session);

            if (conflictingBooking) {
              throw new ApiError(
                400,
                "You have a conflicting booking at this time"
              );
            }
          }

          console.log("🐛 DEBUG - About to update booking to accepted status");

          const updatedBooking = await Booking.findByIdAndUpdate(
            booking._id,
            {
              $set: {
                status: "accepted",
                acceptedAt: new Date(),
              },
            },
            {
              session,
              new: true,
            }
          );

          console.log(
            "🐛 DEBUG - Updated booking result:",
            updatedBooking ? "Success" : "Failed"
          );

          // Mark driver as booked only for immediate bookings
          if (!booking.isScheduled) {
            driver.isBooked = true;
            await driver.save({ session });
            console.log("✅ Driver marked as booked for immediate booking");

            // Reject all other pending immediate requests for this driver
            await Booking.updateMany(
              {
                $or: [
                  { driver: driverId },
                  { driver: new mongoose.Types.ObjectId(driverId) },
                  { driver: driverId.toString() },
                ],
                status: "pending",
                isScheduled: { $ne: true },
                _id: { $ne: new mongoose.Types.ObjectId(data.bookingId) },
              },
              {
                $set: {
                  status: "rejected",
                  rejectionReason: "Driver accepted another booking",
                  rejectedAt: new Date(),
                },
              },
              { session }
            );
          }

          responseMessage = booking.isScheduled
            ? "Scheduled booking request accepted successfully"
            : "Booking request accepted successfully";

          console.log("✅ Booking accepted successfully");

          // Send notification to user about acceptance
          setTimeout(async () => {
            await BookingNotificationManager.notifyUserOfDriverResponse(
              data.bookingId,
              "accepted"
            );
          }, 100);
        } else if (data.response === "reject") {
          console.log("🐛 DEBUG - About to update booking to rejected status");

          const updatedBooking = await Booking.findByIdAndUpdate(
            booking._id,
            {
              $set: {
                status: "rejected",
                rejectionReason: data.rejectionReason || "Rejected by driver",
                rejectedAt: new Date(),
              },
            },
            {
              session,
              new: true,
            }
          );

          console.log(
            "🐛 DEBUG - Updated booking result:",
            updatedBooking ? "Success" : "Failed"
          );
          responseMessage = "Booking request rejected successfully";
          console.log("❌ Booking rejected successfully");

          // Send notification to user about rejection and suggest alternatives
          setTimeout(async () => {
            await BookingNotificationManager.notifyUserOfDriverResponse(
              data.bookingId,
              "rejected",
              data.rejectionReason
            );
            await BookingNotificationManager.suggestAlternativeDrivers(
              data.bookingId
            );
          }, 100);
        } else {
          throw new ApiError(
            400,
            `Invalid response type: ${data.response}. Must be 'accept' or 'reject'`
          );
        }
      });

      await session.commitTransaction();

      res.status(200).json(
        new ApiResponse(
          200,
          {
            bookingId: data.bookingId,
            response: data.response,
            timestamp: new Date(),
          },
          responseMessage
        )
      );
    } catch (error: any) {
      await session.abortTransaction();
      console.error("🔥 ERROR in respondToBookingRequest:", error);

      if (error instanceof ApiError) {
        throw error;
      } else {
        throw new ApiError(
          500,
          `Internal server error: ${error?.message || "Unknown error"}`
        );
      }
    } finally {
      await session.endSession();
    }
  }
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
        now.getDate()
      );
      const endOfDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        23,
        59,
        59
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
        `Retrieved ${scheduledBookings.length} scheduled bookings`
      )
    );
  }
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
          scheduledTime.getTime() - 30 * 60 * 1000
        );
        const thirtyMinutesAfter = new Date(
          scheduledTime.getTime() + 30 * 60 * 1000
        );

        if (now < thirtyMinutesBefore) {
          throw new ApiError(
            400,
            "Too early to start this trip. You can start 30 minutes before scheduled time."
          );
        }

        if (now > thirtyMinutesAfter) {
          throw new ApiError(
            400,
            "This scheduled booking has expired. Please contact the customer."
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
          }
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
          "Scheduled trip started successfully"
        )
      );
    } catch (error: any) {
      await session.abortTransaction();

      if (error instanceof ApiError) {
        throw error;
      } else {
        throw new ApiError(
          500,
          `Internal server error: ${error?.message || "Unknown error"}`
        );
      }
    } finally {
      await session.endSession();
    }
  }
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
            bookingId
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
            "Trip completed successfully. You are now available for new bookings"
          )
        );
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }
  }
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
          new ApiResponse(200, { booking: null }, "No active booking found")
        );
      return;
    }

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          { booking },
          "Active booking retrieved successfully"
        )
      );
  }
);

// Rest of the existing functions remain the same...
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
              "Cannot set unavailable while having active bookings"
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
  }
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
        status
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
      0
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
        "Driver booking history retrieved successfully"
      )
    );
  }
);




// Add this utility function for consistent price calculation across your app:
export const calculateBookingPrice = async (distance: number): Promise<{ price: number, pricePerKm: number }> => {
  try {
    const pricePerKm = await getCurrentPricePerKm();
    const price = distance * pricePerKm;
    
    return {
      price: Math.round(price * 100) / 100, // Round to 2 decimal places
      pricePerKm: pricePerKm
    };
  } catch (error) {
    console.error("Error calculating booking price:", error);
    // Fallback to default pricing
    const defaultPrice = distance * 10;
    return {
      price: defaultPrice,
      pricePerKm: 10
    };
  }
};