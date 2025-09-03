import mongoose, { Document, Schema } from "mongoose";

export interface IBooking extends Document {
  user: mongoose.Types.ObjectId;
  driver: mongoose.Types.ObjectId;
  dryCleaner: mongoose.Types.ObjectId;
  pickupAddress: string;
  dropoffAddress: string;
  distance: number;
  time: number;
  price: number;
  status: 'pending' | 'accepted' | 'active' | 'completed' | 'cancelled' | 'rejected';
  bookingType: 'pickup' | 'delivery';
  message?: string;
  
  // Scheduling fields
  isScheduled?: boolean;
  scheduledPickupDateTime?: Date;
  
  // Cancellation/Rejection
  cancellationReason?: string;
  rejectionReason?: string;
  
  // Timestamps for different stages
  requestedAt?: Date;
  acceptedAt?: Date;
  rejectedAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  cancelledAt?: Date;
  
  createdAt: Date;
  updatedAt: Date;
}

const BookingSchema = new Schema<IBooking>({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  driver: { type: Schema.Types.ObjectId, ref: "Driver", required: true },
  dryCleaner: { type: Schema.Types.ObjectId, ref: "DryCleaner", required: true },
  pickupAddress: { type: String, required: true },
  dropoffAddress: { type: String, required: true },
  distance: { type: Number, required: true, min: 0 },
  time: { type: Number, required: true, min: 0 },
  price: { type: Number, required: true, min: 0 },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'active', 'completed', 'cancelled', 'rejected'],
    default: 'pending',
    required: true
  },
  bookingType: {
    type: String,
    enum: ['pickup', 'delivery'],
    required: true
  },
  message: { type: String },
  
  // Scheduling fields
  isScheduled: { 
    type: Boolean, 
    default: false,
    index: true
  },
  scheduledPickupDateTime: { 
    type: Date,
    validate: {
      validator: function(this: IBooking, value: Date) {
        // If booking is scheduled, scheduledPickupDateTime is required
        if (this.isScheduled && !value) {
          return false;
        }
        // If scheduledPickupDateTime is provided, it must be in the future
        if (value && value <= new Date()) {
          return false;
        }
        return true;
      },
      message: 'Scheduled pickup date must be in the future'
    }
  },
  
  // Reasons for cancellation/rejection
  cancellationReason: { type: String },
  rejectionReason: { type: String },
  
  // Timestamps for booking lifecycle
  requestedAt: { type: Date },
  acceptedAt: { type: Date },
  rejectedAt: { type: Date },
  startedAt: { type: Date },
  completedAt: { type: Date },
  cancelledAt: { type: Date },
}, { 
  timestamps: true 
});

// Enhanced indexes for better query performance
BookingSchema.index({ user: 1, status: 1 });
BookingSchema.index({ driver: 1, status: 1 });
BookingSchema.index({ dryCleaner: 1 });
BookingSchema.index({ status: 1 });
BookingSchema.index({ createdAt: -1 });
BookingSchema.index({ bookingType: 1 });

// New indexes for scheduling
BookingSchema.index({ scheduledPickupDateTime: 1 });
BookingSchema.index({ isScheduled: 1, status: 1 });
BookingSchema.index({ driver: 1, scheduledPickupDateTime: 1, status: 1 });
BookingSchema.index({ user: 1, isScheduled: 1, status: 1 });

// Compound indexes for common queries
BookingSchema.index({ driver: 1, status: 1, createdAt: -1 });
BookingSchema.index({ user: 1, status: 1, createdAt: -1 });
BookingSchema.index({ driver: 1, status: 1, bookingType: 1 });
BookingSchema.index({ driver: 1, isScheduled: 1, scheduledPickupDateTime: 1 });

// Virtual for booking duration (if completed)
BookingSchema.virtual('duration').get(function(this: IBooking) {
  if (this.startedAt && this.completedAt) {
    return this.completedAt.getTime() - this.startedAt.getTime();
  }
  return null;
});

// Virtual for response time (acceptance time)
BookingSchema.virtual('responseTime').get(function(this: IBooking) {
  if (this.requestedAt && (this.acceptedAt || this.rejectedAt)) {
    const responseTime = this.acceptedAt || this.rejectedAt;
    return responseTime!.getTime() - this.requestedAt.getTime();
  }
  return null;
});

// Virtual for time until scheduled pickup
BookingSchema.virtual('timeUntilScheduledPickup').get(function(this: IBooking) {
  if (this.isScheduled && this.scheduledPickupDateTime) {
    const now = new Date();
    const timeDiff = this.scheduledPickupDateTime.getTime() - now.getTime();
    return timeDiff > 0 ? timeDiff : 0;
  }
  return null;
});

// Virtual for scheduled pickup status
BookingSchema.virtual('scheduledPickupStatus').get(function(this: IBooking) {
  if (!this.isScheduled || !this.scheduledPickupDateTime) {
    return null;
  }
  
  const now = new Date();
  const scheduledTime = this.scheduledPickupDateTime;
  const thirtyMinutesBefore = new Date(scheduledTime.getTime() - 30 * 60 * 1000);
  const thirtyMinutesAfter = new Date(scheduledTime.getTime() + 30 * 60 * 1000);
  
  if (now < thirtyMinutesBefore) {
    return 'upcoming';
  } else if (now >= thirtyMinutesBefore && now <= thirtyMinutesAfter) {
    return 'ready_to_start';
  } else {
    return 'overdue';
  }
});

// Pre-save middleware to set timestamp fields
BookingSchema.pre('save', function(this: IBooking, next) {
  const now = new Date();
  
  // Set requestedAt when booking is first created
  if (this.isNew && !this.requestedAt) {
    this.requestedAt = now;
  }
  
  // Set timestamps when status changes
  if (this.isModified('status')) {
    switch (this.status) {
      case 'accepted':
        if (!this.acceptedAt) this.acceptedAt = now;
        break;
      case 'rejected':
        if (!this.rejectedAt) this.rejectedAt = now;
        break;
      case 'active':
        if (!this.startedAt) this.startedAt = now;
        break;
      case 'completed':
        if (!this.completedAt) this.completedAt = now;
        break;
      case 'cancelled':
        if (!this.cancelledAt) this.cancelledAt = now;
        break;
    }
  }
  
  next();
});

// Pre-save validation for scheduled bookings
BookingSchema.pre('save', function(this: IBooking, next) {
  // If booking is scheduled, ensure scheduledPickupDateTime is set
  if (this.isScheduled && !this.scheduledPickupDateTime) {
    return next(new Error('Scheduled pickup date and time is required for scheduled bookings'));
  }
  
  // If scheduledPickupDateTime is set, ensure isScheduled is true
  if (this.scheduledPickupDateTime && !this.isScheduled) {
    this.isScheduled = true;
  }
  
  next();
});

// Static methods
BookingSchema.statics.findPendingForDriver = function(driverId: string) {
  return this.find({ driver: driverId, status: 'pending' });
};

BookingSchema.statics.findActiveForDriver = function(driverId: string) {
  return this.findOne({ driver: driverId, status: { $in: ['accepted', 'active'] } });
};

BookingSchema.statics.findScheduledForDriver = function(driverId: string, date?: Date) {
  const query: any = {
    driver: new mongoose.Types.ObjectId(driverId),
    isScheduled: true,
    status: { $in: ['pending', 'accepted', 'active'] }
  };
  
  if (date) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    
    query.scheduledPickupDateTime = {
      $gte: startOfDay,
      $lte: endOfDay
    };
  }
  
  return this.find(query).sort({ scheduledPickupDateTime: 1 });
};

BookingSchema.statics.findConflictingBookings = function(
  driverId: string, 
  scheduledDateTime: Date, 
  excludeBookingId?: string
) {
  const oneHourBefore = new Date(scheduledDateTime.getTime() - 60 * 60 * 1000);
  const oneHourAfter = new Date(scheduledDateTime.getTime() + 60 * 60 * 1000);
  
  const query: any = {
    driver: new mongoose.Types.ObjectId(driverId),
    status: { $in: ['accepted', 'active'] },
    $or: [
      // Scheduled bookings that conflict
      {
        isScheduled: true,
        scheduledPickupDateTime: {
          $gte: oneHourBefore,
          $lte: oneHourAfter
        }
      },
      // Active immediate bookings
      {
        isScheduled: { $ne: true },
        status: 'active'
      }
    ]
  };
  
  if (excludeBookingId) {
    query._id = { $ne: new mongoose.Types.ObjectId(excludeBookingId) };
  }
  
  return this.find(query);
};

BookingSchema.statics.getDriverEarnings = function(driverId: string, startDate?: Date, endDate?: Date) {
  const matchCondition: any = { 
    driver: new mongoose.Types.ObjectId(driverId), 
    status: 'completed' 
  };
  
  if (startDate && endDate) {
    matchCondition.completedAt = { $gte: startDate, $lte: endDate };
  }
  
  return this.aggregate([
    { $match: matchCondition },
    {
      $group: {
        _id: null,
        totalEarnings: { $sum: '$price' },
        totalTrips: { $sum: 1 },
        avgEarningsPerTrip: { $avg: '$price' },
        scheduledTrips: {
          $sum: {
            $cond: [{ $eq: ['$isScheduled', true] }, 1, 0]
          }
        },
        immediateTrips: {
          $sum: {
            $cond: [{ $ne: ['$isScheduled', true] }, 1, 0]
          }
        }
      }
    }
  ]);
};

BookingSchema.statics.getDriverStats = function(driverId: string) {
  return this.aggregate([
    { $match: { driver: new mongoose.Types.ObjectId(driverId) } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalEarnings: {
          $sum: {
            $cond: [{ $eq: ['$status', 'completed'] }, '$price', 0]
          }
        },
        scheduledCount: {
          $sum: {
            $cond: [{ $eq: ['$isScheduled', true] }, 1, 0]
          }
        },
        immediateCount: {
          $sum: {
            $cond: [{ $ne: ['$isScheduled', true] }, 1, 0]
          }
        }
      }
    }
  ]);
};

// Method to get upcoming scheduled bookings for a driver
BookingSchema.statics.getUpcomingScheduledBookings = function(driverId: string, hoursAhead: number = 2) {
  const now = new Date();
  const futureTime = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);
  
  return this.find({
    driver: new mongoose.Types.ObjectId(driverId),
    isScheduled: true,
    status: 'accepted',
    scheduledPickupDateTime: {
      $gte: now,
      $lte: futureTime
    }
  })
  .populate('user', 'firstName lastName phoneNumber')
  .populate('dryCleaner', 'shopname address phoneNumber')
  .sort({ scheduledPickupDateTime: 1 });
};

// Method to check if a user has pending requests with a driver
BookingSchema.statics.hasPendingRequestWithDriver = function(userId: string, driverId: string) {
  return this.findOne({
    user: new mongoose.Types.ObjectId(userId),
    driver: new mongoose.Types.ObjectId(driverId),
    status: 'pending'
  });
};

// Ensure virtual fields are serialized
BookingSchema.set('toJSON', { virtuals: true });
BookingSchema.set('toObject', { virtuals: true });

export const Booking = mongoose.model<IBooking>("Booking", BookingSchema);