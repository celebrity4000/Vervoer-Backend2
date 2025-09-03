import { Booking } from "../models/booking.model.js";
import { User } from "../models/normalUser.model.js";
import { Driver } from "../models/driver.model.js";
import { DryCleaner } from "../models/merchant.model.js";
import { Types, Document } from 'mongoose';

// Type helpers for working with Mongoose documents
type WithId<T> = T & { _id: Types.ObjectId };

// Helper type for populated documents
type PopulatedBooking = Document & {
  _id: Types.ObjectId;
  user: any;
  driver: any;
  dryCleaner: any;
  isScheduled: boolean;
  scheduledPickupDateTime?: Date;
  price: number;
  bookingType: string;
  pickupAddress: string;
  status: string;
}

// Types for notifications
interface NotificationData {
  userId: string;
  title: string;
  message: string;
  type: 'booking_request' | 'booking_accepted' | 'booking_rejected' | 'booking_cancelled' | 'trip_started' | 'trip_completed' | 'reminder';
  bookingId: string;
  data?: any;
}

// Mock notification service - replace with your actual implementation
class NotificationService {
  // This would integrate with your push notification service (Firebase, OneSignal, etc.)
  async sendPushNotification(notification: NotificationData): Promise<void> {
    console.log('📱 Push Notification:', notification);
    // Implement your push notification logic here
  }

  // This would integrate with your SMS service (Twilio, etc.)
  async sendSMS(phoneNumber: string, message: string): Promise<void> {
    console.log('📱 SMS:', { phoneNumber, message });
    // Implement your SMS logic here
  }

  // This would integrate with your email service
  async sendEmail(email: string, subject: string, body: string): Promise<void> {
    console.log('📧 Email:', { email, subject, body });
    // Implement your email logic here
  }
}

const notificationService = new NotificationService();

export class BookingNotificationManager {
  // Notify driver about new booking request
  static async notifyDriverOfNewBooking(bookingId: string): Promise<void> {
    try {
      const booking = await Booking.findById(bookingId)
        .populate('user', 'firstName lastName phoneNumber')
        .populate('dryCleaner', 'shopname address')
        .populate('driver', 'firstName lastName phoneNumber');

      if (!booking) return;

      const user = booking.user as any;
      const dryCleaner = booking.dryCleaner as any;
      const driver = booking.driver as any;

      const isScheduled = booking.isScheduled;
      const scheduledTime = booking.scheduledPickupDateTime 
        ? booking.scheduledPickupDateTime.toLocaleString() 
        : '';

      const title = isScheduled ? 'New Scheduled Booking Request' : 'New Booking Request';
      const message = isScheduled 
        ? `New scheduled pickup request from ${user.firstName} for ${scheduledTime}. Price: ₹${booking.price}`
        : `New pickup request from ${user.firstName}. Price: ₹${booking.price}`;

      await notificationService.sendPushNotification({
        userId: driver._id.toString(),
        title,
        message,
        type: 'booking_request',
        bookingId: bookingId,
        data: {
          bookingType: booking.bookingType,
          isScheduled: booking.isScheduled,
          scheduledDateTime: booking.scheduledPickupDateTime,
          price: booking.price,
          pickupAddress: booking.pickupAddress,
          customerName: user.firstName + ' ' + user.lastName,
          customerPhone: user.phoneNumber
        }
      });

      // Also send SMS for immediate bookings
      if (!isScheduled) {
        await notificationService.sendSMS(
          driver.phoneNumber,
          `New booking request from ${user.firstName}. Open app to respond. Price: ₹${booking.price}`
        );
      }

    } catch (error) {
      console.error('Error notifying driver of new booking:', error);
    }
  }

  // Notify user when driver accepts/rejects booking
  static async notifyUserOfDriverResponse(bookingId: string, response: 'accepted' | 'rejected', rejectionReason?: string): Promise<void> {
    try {
      const booking = await Booking.findById(bookingId)
        .populate('user', 'firstName lastName phoneNumber email')
        .populate('driver', 'firstName lastName phoneNumber vehicleInfo');

      if (!booking) return;

      const user = booking.user as any;
      const driver = booking.driver as any;

      if (response === 'accepted') {
        const title = booking.isScheduled ? 'Scheduled Booking Confirmed!' : 'Booking Accepted!';
        const message = booking.isScheduled 
          ? `${driver.firstName} confirmed your scheduled pickup for ${booking.scheduledPickupDateTime?.toLocaleString()}`
          : `${driver.firstName} accepted your booking request. Vehicle: ${driver.vehicleInfo?.vehicleNumber}`;

        await notificationService.sendPushNotification({
          userId: user._id.toString(),
          title,
          message,
          type: 'booking_accepted',
          bookingId: bookingId,
          data: {
            driverName: driver.firstName + ' ' + driver.lastName,
            driverPhone: driver.phoneNumber,
            vehicleNumber: driver.vehicleInfo?.vehicleNumber,
            scheduledDateTime: booking.scheduledPickupDateTime
          }
        });

        // Send confirmation SMS
        await notificationService.sendSMS(
          user.phoneNumber,
          `Your booking is confirmed! Driver: ${driver.firstName}, Vehicle: ${driver.vehicleInfo?.vehicleNumber}, Phone: ${driver.phoneNumber}`
        );

      } else {
        const title = 'Booking Request Declined';
        const message = `${driver.firstName} declined your booking request${rejectionReason ? `: ${rejectionReason}` : ''}. Please choose another driver.`;

        await notificationService.sendPushNotification({
          userId: user._id.toString(),
          title,
          message,
          type: 'booking_rejected',
          bookingId: bookingId,
          data: {
            rejectionReason: rejectionReason || 'No reason provided'
          }
        });
      }

    } catch (error) {
      console.error('Error notifying user of driver response:', error);
    }
  }

  // Notify user when trip starts
  static async notifyUserOfTripStart(bookingId: string): Promise<void> {
    try {
      const booking = await Booking.findById(bookingId)
        .populate('user', 'firstName lastName phoneNumber')
        .populate('driver', 'firstName lastName phoneNumber vehicleInfo');

      if (!booking) return;

      const user = booking.user as any;
      const driver = booking.driver as any;

      await notificationService.sendPushNotification({
        userId: user._id.toString(),
        title: 'Your driver is on the way!',
        message: `${driver.firstName} has started your trip. Vehicle: ${driver.vehicleInfo?.vehicleNumber}`,
        type: 'trip_started',
        bookingId: bookingId,
        data: {
          driverName: driver.firstName + ' ' + driver.lastName,
          driverPhone: driver.phoneNumber,
          vehicleNumber: driver.vehicleInfo?.vehicleNumber
        }
      });

      await notificationService.sendSMS(
        user.phoneNumber,
        `Your driver ${driver.firstName} is on the way! Vehicle: ${driver.vehicleInfo?.vehicleNumber}`
      );

    } catch (error) {
      console.error('Error notifying user of trip start:', error);
    }
  }

  // Notify user when trip is completed
  static async notifyUserOfTripCompletion(bookingId: string): Promise<void> {
    try {
      const booking = await Booking.findById(bookingId)
        .populate('user', 'firstName lastName phoneNumber')
        .populate('driver', 'firstName lastName')
        .populate('dryCleaner', 'shopname');

      if (!booking) return;

      const user = booking.user as any;
      const driver = booking.driver as any;
      const dryCleaner = booking.dryCleaner as any;

      await notificationService.sendPushNotification({
        userId: user._id.toString(),
        title: 'Trip Completed!',
        message: `Your clothes have been delivered to ${dryCleaner.shopname}. Total: ₹${booking.price}`,
        type: 'trip_completed',
        bookingId: bookingId,
        data: {
          driverName: driver.firstName + ' ' + driver.lastName,
          dryCleanerName: dryCleaner.shopname,
          price: booking.price
        }
      });

    } catch (error) {
      console.error('Error notifying user of trip completion:', error);
    }
  }

  // Send reminder for scheduled bookings
  static async sendScheduledBookingReminders(): Promise<void> {
    try {
      // Find bookings scheduled for next 2 hours
      const twoHoursFromNow = new Date();
      twoHoursFromNow.setHours(twoHoursFromNow.getHours() + 2);

      const upcomingBookings = await Booking.find({
        isScheduled: true,
        status: 'accepted',
        scheduledPickupDateTime: {
          $gte: new Date(),
          $lte: twoHoursFromNow
        }
      })
      .populate('user', 'firstName lastName phoneNumber')
      .populate('driver', 'firstName lastName phoneNumber');

      for (const booking of upcomingBookings) {
        const user = booking.user as any;
        const driver = booking.driver as any;
        const timeLeft = Math.round((booking.scheduledPickupDateTime!.getTime() - new Date().getTime()) / (1000 * 60));

        // Remind user
        await notificationService.sendPushNotification({
          userId: (user._id as Types.ObjectId).toString(),
          title: 'Pickup Reminder',
          message: `Your scheduled pickup is in ${timeLeft} minutes. Driver: ${driver.firstName}`,
          type: 'reminder',
          bookingId: (booking._id as Types.ObjectId).toString(),
          data: {
            timeLeft,
            driverName: driver.firstName + ' ' + driver.lastName,
            driverPhone: driver.phoneNumber
          }
        });

        // Remind driver
        await notificationService.sendPushNotification({
          userId: (driver._id as Types.ObjectId).toString(),
          title: 'Pickup Reminder',
          message: `Scheduled pickup for ${user.firstName} in ${timeLeft} minutes`,
          type: 'reminder',
          bookingId: (booking._id as Types.ObjectId).toString(),
          data: {
            timeLeft,
            customerName: user.firstName + ' ' + user.lastName,
            customerPhone: user.phoneNumber,
            pickupAddress: booking.pickupAddress
          }
        });
      }

    } catch (error) {
      console.error('Error sending scheduled booking reminders:', error);
    }
  }

  // Notify driver when they have new alternatives after rejection
  static async suggestAlternativeDrivers(originalBookingId: string): Promise<void> {
    try {
      const originalBooking = await Booking.findById(originalBookingId)
        .populate('user', 'firstName lastName phoneNumber');

      if (!originalBooking || originalBooking.status !== 'rejected') return;

      const user = originalBooking.user as any;

      // Find available drivers near the pickup location
      const availableDrivers = await Driver.find({
        isBooked: false,
        isActive: true,
        _id: { $ne: originalBooking.driver } // Exclude the driver who rejected
      }).limit(3);

      if (availableDrivers.length > 0) {
        // Send suggestion to user
        await notificationService.sendPushNotification({
          userId: (user._id as Types.ObjectId).toString(),
          title: 'Alternative Drivers Available',
          message: `We found ${availableDrivers.length} available drivers for your booking. Check the app to book with them.`,
          type: 'booking_request',
          bookingId: originalBookingId,
          data: {
            alternativeDrivers: availableDrivers.map(d => ({
              id: (d._id as Types.ObjectId).toString(),
              name: d.firstName + ' ' + d.lastName,
              rating: (d as any).rating,
              vehicleNumber: (d as any).vehicleInfo?.vehicleNumber
            }))
          }
        });
      }

    } catch (error) {
      console.error('Error suggesting alternative drivers:', error);
    }
  }

  // Check for overdue scheduled bookings and notify
  static async checkOverdueScheduledBookings(): Promise<void> {
    try {
      const thirtyMinutesAgo = new Date();
      thirtyMinutesAgo.setMinutes(thirtyMinutesAgo.getMinutes() - 30);

      const overdueBookings = await Booking.find({
        isScheduled: true,
        status: 'accepted',
        scheduledPickupDateTime: { $lt: thirtyMinutesAgo }
      })
      .populate('user', 'firstName lastName phoneNumber')
      .populate('driver', 'firstName lastName phoneNumber');

      for (const booking of overdueBookings) {
        const user = booking.user as any;
        const driver = booking.driver as any;

        // Notify user about delay
        await notificationService.sendPushNotification({
          userId: (user._id as Types.ObjectId).toString(),
          title: 'Pickup Delayed',
          message: `Your scheduled pickup is overdue. Please contact your driver: ${driver.phoneNumber}`,
          type: 'reminder',
          bookingId: (booking._id as Types.ObjectId).toString(),
          data: {
            driverPhone: driver.phoneNumber,
            scheduledTime: booking.scheduledPickupDateTime
          }
        });

        // Notify driver about overdue booking
        await notificationService.sendPushNotification({
          userId: (driver._id as Types.ObjectId).toString(),
          title: 'Overdue Pickup',
          message: `Pickup for ${user.firstName} is overdue. Please start the trip or contact customer.`,
          type: 'reminder',
          bookingId: (booking._id as Types.ObjectId).toString(),
          data: {
            customerName: user.firstName + ' ' + user.lastName,
            customerPhone: user.phoneNumber,
            scheduledTime: booking.scheduledPickupDateTime
          }
        });
      }

    } catch (error) {
      console.error('Error checking overdue scheduled bookings:', error);
    }
  }
}

// Cron job functions (to be called by your scheduler)
export const scheduledNotificationTasks = {
  // Run every 15 minutes
  sendReminders: async () => {
    await BookingNotificationManager.sendScheduledBookingReminders();
  },

  // Run every 30 minutes
  checkOverdueBookings: async () => {
    await BookingNotificationManager.checkOverdueScheduledBookings();
  }
};

// Alternative approach: Create utility functions for safe ObjectId conversion
export const toObjectIdString = (id: unknown): string => {
  if (typeof id === 'string') return id;
  if (id && typeof id === 'object' && 'toString' in id) {
    return (id as any).toString();
  }
  return String(id);
};

// Type guard to check if something is a document with _id
export const hasObjectId = (obj: any): obj is { _id: Types.ObjectId } => {
  return obj && obj._id && (typeof obj._id === 'string' || obj._id instanceof Types.ObjectId);
};

// Safe ID extraction
export const extractId = (document: any): string => {
  if (!document) throw new Error('Document is null or undefined');
  if (hasObjectId(document)) {
    return document._id.toString();
  }
  throw new Error('Document does not have a valid _id field');
};