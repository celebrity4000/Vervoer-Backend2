import mongoose, { Document, Schema } from "mongoose";

// ─── Sub-interfaces ────────────────────────────────────────────────────────────

/** One entry in the additional-service catalogue (e.g. zipper, button). */
export interface IAdditionalService {
  name: string;
  price: number;
}

export interface IOrderItem {
  itemId: string;
  name: string;
  category: string;
  quantity: number;
  price: number;           // base price per unit
  effectivePrice?: number; // base + selected add-on prices per unit
  starchLevel: string;
  merchantStarchLevel?: string;
  washOnly: boolean;
  // FIX: array of { name, price } objects — was incorrectly typed as String
  additionalservice?: IAdditionalService[];
  // which add-ons the user actually selected for this item
  selectedAdditionals?: string[];
  options: {
    washAndFold: boolean;
    button?: boolean;
    zipper?: boolean;
    selectedAdditionals?: string[]; // mirror on options for legacy reads
  };
}

export interface IPricing {
  subtotal: number;
  serviceFees: number;
  deliveryCharge: number;
  platformFee: number;
  totalAmount: number;
  tip?: number;
}

/** Lightweight record of a driver cancelling and re-queuing a booking. */
export interface IDriverCancellationRecord {
  driverId: string;
  driverName: string;
  reason?: string;
  cancelledAt: Date;
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
  deliveryCharge: number;
  status:
    | 'pending'
    | 'accepted'
    | 'active'
    | 'completed'
    | 'cancelled'
    | 'rejected'
    // extended statuses used by updateBookingStatus
    | 'in_progress'
    | 'pickup_completed'
    | 'en_route_to_dropoff'
    | 'arrived_at_dropoff'
    | 'dropped_at_center'
    | 'ready_for_delivery';
  bookingType: 'pickup' | 'delivery';
  message?: string;
  orderNumber?: string;
  // FIX: canonical field is "trackingId" (lowercase).
  // "Tracking_ID" kept as a sparse alias for backward-compat with old docs.
  trackingId?: string;
  Tracking_ID?: string;

  // Order-specific fields
  orderItems: IOrderItem[];
  pricing: IPricing;
  paymentMethod: {
  type: String,
  enum: ['CASH', 'CREDIT', 'DEBIT', 'UPI', 'PAYPAL', 'CARD']
}
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
  readyAt?: Date;

  // Route info (set by driver)
  routeDistance?: number;
  routeDuration?: number;
  currentLocation?: string;
  statusNotes?: string;

  // Cancellation / Rejection
  cancellationReason?: string;
  rejectionReason?: string;
  // FIX: history of driver re-queues — avoids polluting the main
  // cancellationReason field when a driver releases a booking back to pending.
  driverCancellationHistory?: IDriverCancellationRecord[];

  // Lifecycle timestamps
  requestedAt?: Date;
  acceptedAt?: Date;
  rejectedAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  cancelledAt?: Date;
  pickupCompletedAt?: Date;
  dropoffCompletedAt?: Date;
  paidAt?: Date;

  // Metadata (merchant-initiated delivery, etc.)
  metadata?: Record<string, any>;

  // Virtual properties
  readonly totalItems: number;
  readonly orderSummary: string;
  readonly duration: number | null;
  readonly processingDuration: number | null;

  createdAt: Date;
  updatedAt: Date;
}

// ─── Sub-schemas ───────────────────────────────────────────────────────────────

/** FIX: additionalservice entry — { name: string, price: number } */
const AdditionalServiceSchema = new Schema<IAdditionalService>(
  {
    name:  { type: String, required: true },
    price: { type: Number, required: true, min: 0, default: 0 },
  },
  { _id: false },
);

const OrderItemSchema = new Schema<IOrderItem>(
  {
    itemId:   { type: String, required: true },
    name:     { type: String, required: true },
    category: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    price:    { type: Number, required: true, min: 0 },
    // FIX: per-unit price including selected add-ons
    effectivePrice: { type: Number, min: 0 },
    starchLevel:         { type: String, enum: ["low", "medium", "high"], default: "low" },
    merchantStarchLevel: { type: String, enum: ["low", "medium", "high"], default: "medium" },
    washOnly: { type: Boolean, default: false },
    // FIX: was `{ type: String }` — now an array of AdditionalServiceSchema
    additionalservice: { type: [AdditionalServiceSchema], default: [] },
    // which add-ons the user selected (array of name strings)
    selectedAdditionals: { type: [String], default: [] },
    options: {
      washAndFold:        { type: Boolean, default: false },
      button:             { type: Boolean, default: false },
      zipper:             { type: Boolean, default: false },
      // mirror of selectedAdditionals kept on options for legacy reads
      selectedAdditionals:{ type: [String], default: [] },
    },
  },
  { _id: false },
);

const PricingSchema = new Schema<IPricing>(
  {
    subtotal:       { type: Number, required: true, min: 0 },
    serviceFees:    { type: Number, required: true, min: 0 },
    deliveryCharge: { type: Number, required: true, min: 0 },
    platformFee:    { type: Number, required: true, min: 0 },
    tip:            { type: Number, min: 0 },
    totalAmount:    { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const DriverCancellationRecordSchema = new Schema<IDriverCancellationRecord>(
  {
    driverId:   { type: String, required: true },
    driverName: { type: String, required: true },
    reason:     { type: String },
    cancelledAt:{ type: Date, required: true },
  },
  { _id: false },
);

// ─── Main schema ───────────────────────────────────────────────────────────────

const BookingSchema = new Schema<IBooking>(
  {
    user:      { type: Schema.Types.ObjectId, ref: "User",       required: true },
    driver:    { type: Schema.Types.ObjectId, ref: "Driver" },
    dryCleaner:{ type: Schema.Types.ObjectId, ref: "DryCleaner", required: true },

    pickupAddress:  { type: String, required: true },
    dropoffAddress: { type: String, required: true },
    distance: { type: Number, required: true, min: 0 },
    time:     { type: Number, required: true, min: 0 },
    price:    { type: Number, required: true, min: 0 },
    deliveryCharge: { type: Number, required: true, min: 0 },

    status: {
      type: String,
      enum: [
        'pending', 'accepted', 'active', 'completed', 'cancelled', 'rejected',
        'in_progress', 'pickup_completed', 'en_route_to_dropoff',
        'arrived_at_dropoff', 'dropped_at_center', 'ready_for_delivery',
      ],
      default: 'pending',
      required: true,
    },
    bookingType: {
      type: String,
      enum: ['pickup', 'delivery'],
      required: true,
    },

    message:     { type: String },
    orderNumber: { type: String, unique: true, sparse: true },
    // FIX: canonical lowercase field
    trackingId:  { type: String, unique: true, sparse: true },
    // legacy uppercase alias — kept so old documents still resolve
    Tracking_ID: { type: String, unique: true, sparse: true },

    orderItems: {
      type: [OrderItemSchema],
      required: true,
      validate: {
        validator: (items: IOrderItem[]) => items && items.length > 0,
        message: 'At least one order item is required',
      },
    },

    pricing: {
      type: PricingSchema,
      required: true,
      validate: {
        validator: function (pricing: IPricing) {
          const calculated =
            pricing.subtotal +
            pricing.serviceFees +
            pricing.deliveryCharge +
            pricing.platformFee +
            (pricing.tip || 0);
          return Math.abs(calculated - pricing.totalAmount) < 0.02; // 2-cent tolerance
        },
        message: 'Total amount must equal sum of all pricing components',
      },
    },

    paymentMethod: {
      type: String,
      enum: ['CASH', 'CREDIT', 'DEBIT', 'UPI', 'PAYPAL'],
      required: true,
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded'],
      default: 'pending',
      required: true,
    },
    paymentIntentId: { type: String },

    isScheduled: { type: Boolean, default: false, index: true },
    scheduledPickupDateTime: {
      type: Date,
      validate: {
        validator: function (this: IBooking, value: Date) {
          if (this.isScheduled && !value) return false;
          if (value && value <= new Date()) return false;
          return true;
        },
        message: 'Scheduled pickup date must be in the future',
      },
    },
    scheduledDeliveryDateTime: {
      type: Date,
      validate: {
        validator: function (this: IBooking, value: Date) {
          if (this.scheduledPickupDateTime && value && value <= this.scheduledPickupDateTime)
            return false;
          return true;
        },
        message: 'Scheduled delivery date must be after pickup date',
      },
    },

    // Tracking timestamps
    pickedUpAt:              { type: Date },
    deliveredToDryCleanerAt: { type: Date },
    processingStartedAt:     { type: Date },
    processingCompletedAt:   { type: Date },
    readyForDeliveryAt:      { type: Date },
    readyAt:                 { type: Date },

    // Route / location
    routeDistance:   { type: Number },
    routeDuration:   { type: Number },
    currentLocation: { type: String },
    statusNotes:     { type: String },

    cancellationReason: { type: String },
    rejectionReason:    { type: String },
    driverCancellationHistory: { type: [DriverCancellationRecordSchema], default: [] },

    // Lifecycle timestamps
    requestedAt:      { type: Date },
    acceptedAt:       { type: Date },
    rejectedAt:       { type: Date },
    startedAt:        { type: Date },
    completedAt:      { type: Date },
    cancelledAt:      { type: Date },
    pickupCompletedAt:{ type: Date },
    dropoffCompletedAt:{ type: Date },
    paidAt:           { type: Date },

    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

// ─── Indexes ───────────────────────────────────────────────────────────────────

BookingSchema.index({ user: 1, status: 1, createdAt: -1 });
BookingSchema.index({ driver: 1, status: 1, createdAt: -1 });
BookingSchema.index({ dryCleaner: 1, status: 1, createdAt: -1 });
BookingSchema.index({ isScheduled: 1, status: 1 });
BookingSchema.index({ driver: 1, scheduledPickupDateTime: 1, status: 1 });
BookingSchema.index({ user: 1, paymentStatus: 1 });
BookingSchema.index({ createdAt: -1 });
BookingSchema.index({ bookingType: 1 });
BookingSchema.index({ paymentStatus: 1 });
// Index for the ready_for_delivery driver-pool query
BookingSchema.index({ status: 1, driver: 1 });

// ─── Virtuals ─────────────────────────────────────────────────────────────────

BookingSchema.virtual('totalItems').get(function (this: IBooking) {
  return this.orderItems?.reduce((sum, item) => sum + item.quantity, 0) || 0;
});

BookingSchema.virtual('orderSummary').get(function (this: IBooking) {
  if (!this.orderItems || this.orderItems.length === 0) return 'No items';
  const itemCount = this.orderItems.length;
  const totalQuantity = this.totalItems;
  return `${itemCount} item type${itemCount > 1 ? 's' : ''}, ${totalQuantity} total item${totalQuantity > 1 ? 's' : ''}`;
});

BookingSchema.virtual('duration').get(function (this: IBooking) {
  if (this.startedAt && this.completedAt)
    return this.completedAt.getTime() - this.startedAt.getTime();
  return null;
});

BookingSchema.virtual('processingDuration').get(function (this: IBooking) {
  if (this.processingStartedAt && this.processingCompletedAt)
    return this.processingCompletedAt.getTime() - this.processingStartedAt.getTime();
  return null;
});

// ─── Pre-save middleware ───────────────────────────────────────────────────────

BookingSchema.pre('save', function (this: IBooking, next) {
  const now = new Date();

  if (this.isNew && !this.requestedAt) {
    this.requestedAt = now;
  }

  if (this.isModified('status')) {
    switch (this.status) {
      case 'accepted':
        if (!this.acceptedAt) this.acceptedAt = now;
        break;
      case 'rejected':
        if (!this.rejectedAt) this.rejectedAt = now;
        break;
      case 'active':
      case 'in_progress':
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

  if (this.isModified('paymentStatus') && this.paymentStatus === 'paid') {
    if (!this.paidAt) this.paidAt = now;
  }

  next();
});

BookingSchema.pre('save', function (this: IBooking, next) {
  if (this.isScheduled && !this.scheduledPickupDateTime) {
    return next(new Error('Scheduled pickup date and time is required for scheduled bookings'));
  }
  if (this.scheduledPickupDateTime && !this.isScheduled) {
    this.isScheduled = true;
  }
  if (this.pricing && Math.abs(this.price - this.pricing.totalAmount) > 0.02) {
    return next(new Error('Price must match pricing total amount'));
  }
  next();
});

// ─── Static methods ───────────────────────────────────────────────────────────

BookingSchema.statics.findUserOrders = function (userId: string, status?: string) {
  const query: any = { user: new mongoose.Types.ObjectId(userId) };
  if (status) query.status = status;
  return this.find(query)
    .populate('dryCleaner', 'shopname address phoneNumber')
    .populate('driver', 'firstName lastName phoneNumber')
    .sort({ createdAt: -1 });
};

BookingSchema.statics.findDryCleanerOrders = function (dryCleanerId: string, status?: string) {
  const query: any = { dryCleaner: new mongoose.Types.ObjectId(dryCleanerId) };
  if (status) query.status = status;
  return this.find(query)
    .populate('user', 'firstName lastName phoneNumber')
    .populate('driver', 'firstName lastName phoneNumber')
    .sort({ createdAt: -1 });
};

BookingSchema.statics.findDriverOrders = function (driverId: string, status?: string) {
  const query: any = { driver: new mongoose.Types.ObjectId(driverId) };
  if (status) query.status = status;
  return this.find(query)
    .populate('user', 'firstName lastName phoneNumber')
    .populate('dryCleaner', 'shopname address phoneNumber')
    .sort({ createdAt: -1 });
};

BookingSchema.statics.getDryCleanerAnalytics = function (
  dryCleanerId: string,
  startDate?: Date,
  endDate?: Date,
) {
  const matchCondition: any = { dryCleaner: new mongoose.Types.ObjectId(dryCleanerId) };
  if (startDate && endDate) matchCondition.createdAt = { $gte: startDate, $lte: endDate };

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
              in: { $add: ['$$value', '$$this.quantity'] },
            },
          },
        },
      },
    },
  ]);
};

BookingSchema.statics.findAvailableBookings = function (bookingType?: 'pickup' | 'delivery') {
  const query: any = {
    driver: { $exists: false },
    status: 'accepted',
    paymentStatus: 'paid',
  };
  if (bookingType) query.bookingType = bookingType;
  return this.find(query)
    .populate('user', 'firstName lastName phoneNumber')
    .populate('dryCleaner', 'shopname address phoneNumber')
    .sort({ scheduledPickupDateTime: 1, createdAt: 1 });
};

BookingSchema.statics.getBookingStats = function (
  timeframe: 'today' | 'week' | 'month' | 'year' = 'month',
) {
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
    { $match: { createdAt: { $gte: startDate } } },
    {
      $group: {
        _id: null,
        totalBookings: { $sum: 1 },
        completedBookings: {
          $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] },
        },
        cancelledBookings: {
          $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] },
        },
        totalRevenue: {
          $sum: { $cond: [{ $eq: ['$paymentStatus', 'paid'] }, '$pricing.totalAmount', 0] },
        },
        averageOrderValue: {
          $avg: { $cond: [{ $eq: ['$paymentStatus', 'paid'] }, '$pricing.totalAmount', null] },
        },
      },
    },
  ]);
};

// ─── Serialisation ────────────────────────────────────────────────────────────

BookingSchema.set('toJSON', { virtuals: true });
BookingSchema.set('toObject', { virtuals: true });

export const Booking = mongoose.model<IBooking>('Booking', BookingSchema);