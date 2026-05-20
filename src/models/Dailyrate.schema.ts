// ─────────────────────────────────────────────────────────────────────────────
// src/utils/dailyRate.schema.ts
//
// Shared schema subdocument + pricing engine for time-of-day FLAT-FEE slots.
//
// ── Pricing model ─────────────────────────────────────────────────────────────
//
//  • Merchant defines N slots, each covering a time window with a flat fee.
//  • The moment a booking enters a slot it pays that slot's full flat price —
//    regardless of how many minutes it actually stays inside.
//  • The LAST slot repeats (at its own flat price) for every additional
//    window of the same duration that goes beyond the defined slots.
//  • Multi-day bookings: slots re-apply identically each calendar day.
//
// ── Example ───────────────────────────────────────────────────────────────────
//
//  Slots:
//    Morning   06:00–12:00  ₹200   (6 h window)
//    Afternoon 12:00–18:00  ₹300   (6 h window)
//    Evening   18:00–00:00  ₹400   (6 h window)  ← last slot
//
//  Booking 08:00 → 23:00  (same day)
//    Enters Morning   → ₹200
//    Enters Afternoon → ₹300
//    Enters Evening   → ₹400
//    Total = ₹900
//
//  Booking 08:00 → 03:00  (crosses midnight)
//    Enters Morning   → ₹200
//    Enters Afternoon → ₹300
//    Enters Evening   (18:00–00:00) → ₹400
//    Past 00:00 → last slot repeats as 00:00–06:00 → ₹400
//    Total = ₹1300
//
//  Single slot: Morning 06:00–10:00 ₹200, booking 08:00–15:00
//    Enters Morning (06–10) → ₹200, cursor → 10:00
//    Repeat window  (10–14) → ₹200, cursor → 14:00
//    Repeat window  (14–18) → ₹200, cursor → 15:00 (bookingTo)
//    Total = ₹600
// ─────────────────────────────────────────────────────────────────────────────

import mongoose from "mongoose";

// ── Subdocument interface ─────────────────────────────────────────────────────

export interface IDailyRateSlot {
  _id:      mongoose.Types.ObjectId;
  label:    string;  // e.g. "Morning", "Peak Hours"
  fromTime: string;  // "HH:MM" 24-h inclusive start
  toTime:   string;  // "HH:MM" 24-h exclusive end; "00:00" means midnight (end-of-day)
  price:    number;  // flat fee charged the moment the booking enters this slot
}

// ── Subdocument schema ────────────────────────────────────────────────────────

export const dailyRateSlotSchema = new mongoose.Schema<IDailyRateSlot>(
  {
    label:    { type: String, required: true, trim: true },
    fromTime: { type: String, required: true },
    toTime:   { type: String, required: true },
    price:    { type: Number, required: true, min: 0 },
  },
  { _id: true }
);

// ── Venue-level fields ────────────────────────────────────────────────────────
//
// Spread into parkingLotSchema / garageSchema / residenceSchema:
//
//   ...dailyRateSchemaFields,
//
export const dailyRateSchemaFields = {
  dailyRateEnabled: { type: Boolean, default: false },
  dailyRates:       { type: [dailyRateSlotSchema], default: [] },
};

// ── TypeScript additions for venue interfaces ─────────────────────────────────
//
//   dailyRateEnabled?: boolean;
//   dailyRates?:       IDailyRateSlot[];
//

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** "HH:MM" → minutes since midnight. "00:00" used as an END time = 1440. */
function toMins(hhmm: string, asEnd = false): number {
  const [h, m] = hhmm.split(":").map(Number);
  const v = h * 60 + m;
  return asEnd && v === 0 ? 1440 : v;
}

/** Minutes since midnight for a Date (local time). */
function dateMins(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

// ─────────────────────────────────────────────────────────────────────────────
// computeDailyRateCost
// ─────────────────────────────────────────────────────────────────────────────

export interface ISlotBreakdown {
  label:       string;
  fromTime:    string;
  toTime:      string;
  price:       number;
  repetitions: number;
  charged:     number;
}

export interface IDailyRateCostResult {
  totalAmount: number;
  breakdown:   ISlotBreakdown[];
}

export function computeDailyRateCost(
  bookingFrom: Date,
  bookingTo:   Date,
  slots:       IDailyRateSlot[],
): IDailyRateCostResult {

  if (!slots || slots.length === 0) {
    return { totalAmount: 0, breakdown: [] };
  }

  // Sort slots ascending by fromTime
  const sorted = [...slots].sort((a, b) => toMins(a.fromTime) - toMins(b.fromTime));

  const lastSlot     = sorted[sorted.length - 1];
  const lastDurMins  = toMins(lastSlot.toTime, true) - toMins(lastSlot.fromTime);

  // Accumulate charges keyed by slot _id
  const chargeMap = new Map<string, ISlotBreakdown>();

  const charge = (slot: IDailyRateSlot) => {
    const key = slot._id.toString();
    if (chargeMap.has(key)) {
      const entry = chargeMap.get(key)!;
      entry.repetitions += 1;
      entry.charged     += slot.price;
    } else {
      chargeMap.set(key, {
        label:       slot.label,
        fromTime:    slot.fromTime,
        toTime:      slot.toTime,
        price:       slot.price,
        repetitions: 1,
        charged:     slot.price,
      });
    }
  };

  // Safety cap
  const maxDays = Math.ceil(
    (bookingTo.getTime() - bookingFrom.getTime()) / 86_400_000
  ) + 2;
  const maxIter = (sorted.length + 10) * (maxDays + 1);

  let cursor = new Date(bookingFrom);
  let iter   = 0;

  while (cursor < bookingTo && iter++ < maxIter) {

    const dayAnchor = new Date(cursor);
    dayAnchor.setHours(0, 0, 0, 0);

    const cursorMins = dateMins(cursor);

    // ── 1. Cursor falls inside a defined slot ────────────────────────────────
    const matched = sorted.find((s) => {
      const sf = toMins(s.fromTime);
      const st = toMins(s.toTime, true);
      return cursorMins >= sf && cursorMins < st;
    });

    if (matched) {
      const slotEnd = new Date(
        dayAnchor.getTime() + toMins(matched.toTime, true) * 60_000
      );
      charge(matched);
      cursor = slotEnd < bookingTo ? slotEnd : bookingTo;
      continue;
    }

    // ── 2. Cursor is in a gap before a later slot today ──────────────────────
    const nextSlot = sorted.find((s) => toMins(s.fromTime) > cursorMins);

    if (nextSlot) {
      // No charge for the gap — jump straight to the next slot's start
      const nextStart = new Date(
        dayAnchor.getTime() + toMins(nextSlot.fromTime) * 60_000
      );
      cursor = nextStart < bookingTo ? nextStart : bookingTo;
      continue;
    }

    // ── 3. Cursor is past ALL defined slots ──────────────────────────────────
    // Repeat the last slot in successive windows of its own duration,
    // anchored from the cursor's CURRENT position (not from lastSlotFromMins).
    //
    // Why cursor-anchored?
    //   If we anchor to lastSlotFromMins we get a fractional window index
    //   whenever the cursor doesn't land exactly on a window boundary (e.g.
    //   because the booking started mid-slot). That produces wrong repeat
    //   counts and occasionally an infinite loop.
    //
    //   Anchoring to cursor means: "charge once, advance by one slot-width,
    //   repeat." Each iteration is exactly one charge + one full advance.
    //
    // Example — Morning 06:00–10:00 (240 min), booking 08:00–15:00:
    //   Step 1 → 08:00 inside slot → charge ₹200, cursor = 10:00
    //   Step 3 → cursor = 10:00, windowEnd = 10:00 + 240 min = 14:00
    //            charge ₹200, cursor = 14:00
    //   Step 3 → cursor = 14:00, windowEnd = 14:00 + 240 min = 18:00
    //            charge ₹200, cursor = 15:00 (bookingTo)
    //   Total = ₹600  ✓
    const windowEnd = new Date(cursor.getTime() + lastDurMins * 60_000);
    charge(lastSlot);
    cursor = windowEnd < bookingTo ? windowEnd : bookingTo;
  }

  const totalAmount = [...chargeMap.values()].reduce(
    (sum, e) => sum + e.charged,
    0
  );

  return { totalAmount, breakdown: [...chargeMap.values()] };
}