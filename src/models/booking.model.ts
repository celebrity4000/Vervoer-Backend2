import mongoose, { Document, Schema } from "mongoose";

// Interface for order items
export interface IOrderItem {
  itemId: string;
  name: string;
  category: string;
  quantity: number;
  price: number;
  starchLevel: number;
  washOnly: boolean;
  options: {
    washAndFold: boolean;
    button?: boolean;
    zipper?: boolean;
  };
  additionalservice?: string;
}

// Interface for pricing breakdown
export interface IPricing {
  subtotal: number;
  serviceFees: number;
  deliveryCharge: number;
  platformFee: number;
  totalAmount: number;
}

export interface IBooking extends Document {
  user: mongoose.Types.ObjectId;
  _id: mongoose.Types.ObjectId;
  driver?: mongoose.Types.ObjectId; 
  dryCleaner: mongoose.Types.ObjectId | {
    _id: mongoose.Types.ObjectId;
    shopname: string;
    address: string;
    phoneNumber?: string;
  };
  pickupAddress: string;
  dropoffAddress: string;
  distance: number;
  time: number;
  price: number;
  deliveryCharge: number; // New field: separate delivery charge at booking level
  status: 'pending' | 'accepted' | 'active' | 'completed' | 'cancelled' | 'rejected';
  bookingType: 'pickup' | 'delivery';
  message?: string;
  orderNumber?: string;
  Tracking_ID?:string;
  
  // Order-specific fields
  orderItems: IOrderItem[];
  pricing: IPricing;
  paymentMethod: 'CASH' | 'CREDIT' | 'DEBIT' | 'UPI' | 'PAYPAL';
  paymentStatus: 'pending' | 'paid' | 'failed' | 'refunded';
  paymentIntentId?: string;
  
  // Scheduling fields
  isScheduled?: boolean;
  scheduledPickupDateTime?: Date;
  scheduledDeliveryDateTime?: Date;
  
  // Tracking fields for delivery stages
  pickedUpAt?: Date;
  deliveredToDryCleanerAt?: Date;
  processingStartedAt?: Date;
  processingCompletedAt?: Date;
  readyForDeliveryAt?: Date;
  
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
  
  // Payment timestamp
  paidAt?: Date;
  
  // Virtual properties (computed fields)
  readonly totalItems: number;
  readonly orderSummary: string;
  readonly duration: number | null;
  readonly processingDuration: number | null;
  
  createdAt: Date;
  updatedAt: Date;
}

// Schema for order items
const OrderItemSchema = new Schema({
  itemId: { type: String, required: true },
  name: { type: String, required: true },
  category: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  price: { type: Number, required: true, min: 0 },
  starchLevel: { type: Number, default: 0, min: 0, max: 3 },
  washOnly: { type: Boolean, default: false },
  options: {
    washAndFold: { type: Boolean, default: false },
    button: { type: Boolean, default: false },
    zipper: { type: Boolean, default: false }
  },
  additionalservice: { type: String }
}, { _id: false });

// Schema for pricing breakdown
const PricingSchema = new Schema({
  subtotal: { type: Number, required: true, min: 0 },
  serviceFees: { type: Number, required: true, min: 0 },
  deliveryCharge: { type: Number, required: true, min: 0 },
  platformFee: { type: Number, required: true, min: 0 },
  totalAmount: { type: Number, required: true, min: 0 }
}, { _id: false });

const BookingSchema = new Schema<IBooking>({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  driver: { type: Schema.Types.ObjectId, ref: "Driver" }, // Optional, assigned when driver accepts
  dryCleaner: { type: Schema.Types.ObjectId, ref: "DryCleaner", required: true },
  pickupAddress: { type: String, required: true },
  dropoffAddress: { type: String, required: true },
  distance: { type: Number, required: true, min: 0 },
  time: { type: Number, required: true, min: 0 },
  price: { type: Number, required: true, min: 0 },
  deliveryCharge: { type: Number, required: true, min: 0 }, // New field: separate delivery charge
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
  orderNumber: { type: String, unique: true, sparse: true},
  Tracking_ID: { type: String, unique: true ,sparse: true},
  
  // Order-specific fields
  orderItems: {
    type: [OrderItemSchema],
    required: true,
    validate: {
      validator: function(items: IOrderItem[]) {
        return items && items.length > 0;
      },
      message: 'At least one order item is required'
    }
  },
  pricing: {
    type: PricingSchema,
    required: true,
    validate: {
      validator: function(pricing: IPricing) {
        // Validate that totalAmount matches the sum of all components
        const calculatedTotal = pricing.subtotal + pricing.serviceFees + 
                              pricing.deliveryCharge + pricing.platformFee;
        return Math.abs(calculatedTotal - pricing.totalAmount) < 0.01; // Allow for small floating point errors
      },
      message: 'Total amount must equal sum of all pricing components'
    }
  },
  paymentMethod: {
    type: String,
    enum: ['CASH', 'CREDIT', 'DEBIT', 'UPI', 'PAYPAL'],
    required: true
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'failed', 'refunded'],
    default: 'pending',
    required: true
  },
  paymentIntentId: { type: String }, 
  
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
        if (this.isScheduled && !value) {
          return false;
        }
        if (value && value <= new Date()) {
          return false;
        }
        return true;
      },
      message: 'Scheduled pickup date must be in the future'
    }
  },
  scheduledDeliveryDateTime: { 
    type: Date,
    validate: {
      validator: function(this: IBooking, value: Date) {
        if (this.scheduledPickupDateTime && value && value <= this.scheduledPickupDateTime) {
          return false;
        }
        return true;
      },
      message: 'Scheduled delivery date must be after pickup date'
    }
  },
  
  // Tracking timestamps for the dry cleaning process
  pickedUpAt: { type: Date },
  deliveredToDryCleanerAt: { type: Date },
  processingStartedAt: { type: Date },
  processingCompletedAt: { type: Date },
  readyForDeliveryAt: { type: Date },
  
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
  
  // Payment timestamp
  paidAt: { type: Date },
}, { 
  timestamps: true 
});

// Keep only the most useful compound indexes
BookingSchema.index({ user: 1, status: 1, createdAt: -1 });
BookingSchema.index({ driver: 1, status: 1, createdAt: -1 });
BookingSchema.index({ dryCleaner: 1, status: 1, createdAt: -1 });

// Scheduling
BookingSchema.index({ isScheduled: 1, status: 1 });
BookingSchema.index({ driver: 1, scheduledPickupDateTime: 1, status: 1 });

// Payment
BookingSchema.index({ user: 1, paymentStatus: 1 });

// General
BookingSchema.index({ createdAt: -1 });
BookingSchema.index({ bookingType: 1 });
BookingSchema.index({ paymentStatus: 1 });


// Virtual for total order items count
BookingSchema.virtual('totalItems').get(function(this: IBooking) {
  return this.orderItems?.reduce((sum, item) => sum + item.quantity, 0) || 0;
});

// Virtual for order summary
BookingSchema.virtual('orderSummary').get(function(this: IBooking) {
  if (!this.orderItems || this.orderItems.length === 0) {
    return 'No items';
  }
  
  const itemCount = this.orderItems.length;
  const totalQuantity = this.totalItems;
  
  return `${itemCount} item type${itemCount > 1 ? 's' : ''}, ${totalQuantity} total item${totalQuantity > 1 ? 's' : ''}`;
});

BookingSchema.virtual('duration').get(function(this: IBooking) {
  if (this.startedAt && this.completedAt) {
    return this.completedAt.getTime() - this.startedAt.getTime();
  }
  return null;
});

// Virtual for processing time (time spent at dry cleaner)
BookingSchema.virtual('processingDuration').get(function(this: IBooking) {
  if (this.processingStartedAt && this.processingCompletedAt) {
    return this.processingCompletedAt.getTime() - this.processingStartedAt.getTime();
  }
  return null;
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
  
  // Set paidAt when payment status changes to paid
  if (this.isModified('paymentStatus') && this.paymentStatus === 'paid') {
    if (!this.paidAt) this.paidAt = now;
  }
  
  next();
});

// Pre-save validation
BookingSchema.pre('save', function(this: IBooking, next) {
  // Validate scheduled bookings
  if (this.isScheduled && !this.scheduledPickupDateTime) {
    return next(new Error('Scheduled pickup date and time is required for scheduled bookings'));
  }
  
  if (this.scheduledPickupDateTime && !this.isScheduled) {
    this.isScheduled = true;
  }
  
  // Ensure price matches pricing.totalAmount
  if (this.pricing && Math.abs(this.price - this.pricing.totalAmount) > 0.01) {
    return next(new Error('Price must match pricing total amount'));
  }
  
  next();
});

// Static method to find user orders
BookingSchema.statics.findUserOrders = function(userId: string, status?: string) {
  const query: any = { user: new mongoose.Types.ObjectId(userId) };
  if (status) {
    query.status = status;
  }
  
  return this.find(query)
    .populate('dryCleaner', 'shopname address phoneNumber')
    .populate('driver', 'firstName lastName phoneNumber')
    .sort({ createdAt: -1 });
};

// Static method to find dry cleaner orders
BookingSchema.statics.findDryCleanerOrders = function(dryCleanerId: string, status?: string) {
  const query: any = { dryCleaner: new mongoose.Types.ObjectId(dryCleanerId) };
  if (status) {
    query.status = status;
  }
  
  return this.find(query)
    .populate('user', 'firstName lastName phoneNumber')
    .populate('driver', 'firstName lastName phoneNumber')
    .sort({ createdAt: -1 });
};

// Static method to find driver orders
BookingSchema.statics.findDriverOrders = function(driverId: string, status?: string) {
  const query: any = { driver: new mongoose.Types.ObjectId(driverId) };
  if (status) {
    query.status = status;
  }
  
  return this.find(query)
    .populate('user', 'firstName lastName phoneNumber')
    .populate('dryCleaner', 'shopname address phoneNumber')
    .sort({ createdAt: -1 });
};

// Static method to get order analytics for dry cleaner
BookingSchema.statics.getDryCleanerAnalytics = function(dryCleanerId: string, startDate?: Date, endDate?: Date) {
  const matchCondition: any = { 
    dryCleaner: new mongoose.Types.ObjectId(dryCleanerId)
  };
  
  if (startDate && endDate) {
    matchCondition.createdAt = { $gte: startDate, $lte: endDate };
  }
  
  return this.aggregate([
    { $match: matchCondition },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalRevenue: { $sum: '$pricing.totalAmount' },
        averageOrderValue: { $avg: '$pricing.totalAmount' },
        totalItems: { 
          $sum: { 
            $reduce: {
              input: '$orderItems',
              initialValue: 0,
              in: { $add: ['$$value', '$$this.quantity'] }
            }
          }
        }
      }
    }
  ]);
};

// Static method to get available bookings for drivers (no driver assigned yet)
BookingSchema.statics.findAvailableBookings = function(bookingType?: 'pickup' | 'delivery') {
  const query: any = { 
    driver: { $exists: false },
    status: 'accepted',
    paymentStatus: 'paid'
  };
  
  if (bookingType) {
    query.bookingType = bookingType;
  }
  
  return this.find(query)
    .populate('user', 'firstName lastName phoneNumber')
    .populate('dryCleaner', 'shopname address phoneNumber')
    .sort({ scheduledPickupDateTime: 1, createdAt: 1 });
};

// Static method to get booking statistics
BookingSchema.statics.getBookingStats = function(timeframe: 'today' | 'week' | 'month' | 'year' = 'month') {
  const now = new Date();
  let startDate: Date;
  
  switch (timeframe) {
    case 'today':
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    case 'week':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case 'month':
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case 'year':
      startDate = new Date(now.getFullYear(), 0, 1);
      break;
  }
  
  return this.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: null,
        totalBookings: { $sum: 1 },
        completedBookings: {
          $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
        },
        cancelledBookings: {
          $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
        },
        totalRevenue: {
          $sum: { $cond: [{ $eq: ['$paymentStatus', 'paid'] }, '$pricing.totalAmount', 0] }
        },
        averageOrderValue: {
          $avg: { $cond: [{ $eq: ['$paymentStatus', 'paid'] }, '$pricing.totalAmount', null] }
        }
      }
    }
  ]);
};

// Ensure virtual fields are serialized
BookingSchema.set('toJSON', { virtuals: true });
BookingSchema.set('toObject', { virtuals: true });

export const Booking = mongoose.model<IBooking>("Booking", BookingSchema);