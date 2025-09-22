import mongoose from 'mongoose';
import { ApiError } from '../utils/apierror.js';

// Type definitions
interface CreateNotificationParams {
  userId: string | mongoose.Types.ObjectId;
  bookingId?: string | mongoose.Types.ObjectId | null;
  title: string;
  message: string;
  type?: 'booking_accepted' | 'booking_rejected' | 'driver_update' | 'payment' | 'general';
  priority?: 'low' | 'normal' | 'high';
  data?: Record<string, any>;
}

interface GetNotificationsParams {
  limit?: number;
  offset?: number;
  unreadOnly?: boolean;
}

interface PushNotificationData {
  title: string;
  message: string;
  data?: Record<string, any>;
}

interface NotificationDocument extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  bookingId?: mongoose.Types.ObjectId;
  title: string;
  message: string;
  type: 'booking_accepted' | 'booking_rejected' | 'driver_update' | 'payment' | 'general';
  priority: 'low' | 'normal' | 'high';
  data: Record<string, any>;
  read: boolean;
  readAt?: Date;
  sent: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  bookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
    required: false
  },
  title: {
    type: String,
    required: true,
    maxlength: 100
  },
  message: {
    type: String,
    required: true,
    maxlength: 500
  },
  type: {
    type: String,
    enum: ['booking_accepted', 'booking_rejected', 'driver_update', 'payment', 'general'],
    default: 'general'
  },
  priority: {
    type: String,
    enum: ['low', 'normal', 'high'],
    default: 'normal'
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  read: {
    type: Boolean,
    default: false
  },
  readAt: {
    type: Date
  },
  sent: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Index for efficient queries
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ read: 1 });

export const Notification = mongoose.model<NotificationDocument>('Notification', notificationSchema);

// ================================================================
// services/notificationService.js - Notification Service
// ================================================================

class NotificationService {
  /**
   * Create and save a notification
   */
  static async createNotification({
    userId,
    bookingId = null,
    title,
    message,
    type = 'general',
    priority = 'normal',
    data = {}
  }: CreateNotificationParams): Promise<NotificationDocument> {
    try {
      const notification = new Notification({
        userId,
        bookingId,
        title,
        message,
        type,
        priority,
        data,
        sent: true
      });

      await notification.save();
      
      // Send push notification (if implemented)
      await this.sendPushNotification(userId.toString(), {
        title,
        message,
        data: {
          notificationId: notification._id.toString(),
          bookingId: bookingId?.toString(),
          type,
          ...data
        }
      });

      console.log('Notification created successfully:', notification._id.toString());
      return notification;
    } catch (error) {
      console.error('Error creating notification:', error);
      throw new ApiError(500, 'Failed to create notification');
    }
  }

  /**
   * Send booking accepted notification
   */
  static async sendBookingAcceptedNotification(
    userId: string | mongoose.Types.ObjectId, 
    bookingId: string | mongoose.Types.ObjectId, 
    driverName: string = 'Driver'
  ): Promise<NotificationDocument> {
    return await this.createNotification({
      userId,
      bookingId,
      title: 'Booking Accepted! 🎉',
      message: `Your dry cleaning pickup has been accepted by ${driverName}. They will arrive shortly.`,
      type: 'booking_accepted',
      priority: 'high',
      data: {
        action: 'booking_accepted',
        driverName,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Send booking rejected notification
   */
  static async sendBookingRejectedNotification(
    userId: string | mongoose.Types.ObjectId, 
    bookingId: string | mongoose.Types.ObjectId, 
    reason: string = 'Driver unavailable'
  ): Promise<NotificationDocument> {
    return await this.createNotification({
      userId,
      bookingId,
      title: 'Booking Request Declined',
      message: 'Your dry cleaning pickup request was declined. Please try booking with another driver.',
      type: 'booking_rejected',
      priority: 'high',
      data: {
        action: 'booking_rejected',
        reason,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Get user notifications with pagination
   */
  static async getUserNotifications(
    userId: string | mongoose.Types.ObjectId, 
    { limit = 50, offset = 0, unreadOnly = false }: GetNotificationsParams = {}
  ) {
    try {
      const query: any = { userId };
      if (unreadOnly) {
        query.read = false;
      }

      const notifications = await Notification
        .find(query)
        .sort({ createdAt: -1 })
        .limit(parseInt(limit.toString()))
        .skip(parseInt(offset.toString()))
        .populate('bookingId', 'orderNumber status')
        .lean();

      const unreadCount = await Notification.countDocuments({
        userId,
        read: false
      });

      const totalCount = await Notification.countDocuments({ userId });

      return {
        notifications,
        unreadCount,
        totalCount,
        hasMore: (parseInt(offset.toString()) + notifications.length) < totalCount
      };
    } catch (error) {
      console.error('Error fetching user notifications:', error);
      throw new ApiError(500, 'Failed to fetch notifications');
    }
  }

  /**
   * Mark notification as read
   */
  static async markAsRead(
    notificationId: string | mongoose.Types.ObjectId, 
    userId: string | mongoose.Types.ObjectId
  ): Promise<NotificationDocument> {
    try {
      const notification = await Notification.findOneAndUpdate(
        { _id: notificationId, userId },
        { 
          read: true, 
          readAt: new Date() 
        },
        { new: true }
      );

      if (!notification) {
        throw new ApiError(404, 'Notification not found');
      }

      return notification;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Error marking notification as read:', error);
      throw new ApiError(500, 'Failed to update notification');
    }
  }

  /**
   * Mark all notifications as read for a user
   */
  static async markAllAsRead(userId: string | mongoose.Types.ObjectId) {
    try {
      const result = await Notification.updateMany(
        { userId, read: false },
        { 
          read: true, 
          readAt: new Date() 
        }
      );

      return result;
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
      throw new ApiError(500, 'Failed to update notifications');
    }
  }

  /**
   * Delete notification
   */
  static async deleteNotification(
    notificationId: string | mongoose.Types.ObjectId, 
    userId: string | mongoose.Types.ObjectId
  ): Promise<NotificationDocument> {
    try {
      const notification = await Notification.findOneAndDelete({
        _id: notificationId,
        userId
      });

      if (!notification) {
        throw new ApiError(404, 'Notification not found');
      }

      return notification;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Error deleting notification:', error);
      throw new ApiError(500, 'Failed to delete notification');
    }
  }

  /**
 * Delete all notifications for a user
 */
static async deleteAllNotifications(
  userId: string | mongoose.Types.ObjectId
) {
  try {
    const result = await Notification.deleteMany({ userId });

    if (result.deletedCount === 0) {
      throw new ApiError(404, 'No notifications found to delete');
    }

    return result;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error('Error deleting all notifications:', error);
    throw new ApiError(500, 'Failed to delete all notifications');
  }
}


  /**
   * Send push notification (implement with your preferred service)
   */
  static async sendPushNotification(
    userId: string, 
    notificationData: PushNotificationData
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // TODO: Implement with Firebase FCM, APNs, or your preferred service
      console.log('Push notification to user:', userId, notificationData);
      
      // Example implementation with Firebase Admin SDK:
      /*
      const { User } = require('../models/User');
      const admin = require('firebase-admin');
      
      const user = await User.findById(userId);
      if (user && user.fcmToken) {
        const message = {
          token: user.fcmToken,
          notification: {
            title: notificationData.title,
            body: notificationData.message
          },
          data: notificationData.data || {}
        };
        
        await admin.messaging().send(message);
      }
      */
      
      return { success: true };
    } catch (error) {
      console.error('Error sending push notification:', error);
      return { success: false, error: (error as Error).message };
    }
  }
}

export { NotificationService };