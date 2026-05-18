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
//    Morning   06:00–12:00  $5    (6 h window)
//    Afternoon 12:00–18:00  $8    (6 h window)
//    Evening   18:00–00:00  $10   (6 h window)   ← last slot
//
//  Booking 09:00 → 23:00  (same day)
//    Enters Morning   → $5
//    Enters Afternoon → $8
//    Enters Evening   → $10
//    Total = $23
//
//  Booking 09:00 → 02:00  (crosses midnight)
//    Enters Morning   → $5
//    Enters Afternoon → $8
//    Enters Evening   (18:00–00:00) → $10
//    Stays past 00:00 → last slot repeats as 00:00–06:00 → $10  (same duration)
//    Total = $33
//
//  Booking 22:00 → 14:00 next day
//    Evening   (22:00–00:00) → $10          today
//    Evening   (00:00–06:00) → $10  repeat  tonight  (past midnight)
//    Morning   (06:00–12:00) → $5           tomorrow
//    Afternoon (12:00–14:00) → $8  (entered, full flat fee)
//    Total = $33
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
// Spread into parkingLotSchema / garageSchema / residenceSchema after monthlyRate:
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

/** "HH:MM" → minutes since midnight.  "00:00" used as an END time = 1440. */
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
//
// Replaces  totalHours * basePrice  in every checkout handler when
// dailyRateEnabled === true.
//
// Parameters
//   bookingFrom  – exact booking start (Date)
//   bookingTo    – exact booking end   (Date)
//   slots        – merchant's slot array in any order (sorted internally)
//   (no fallback needed — last slot covers all overflow)
//
// Returns
//   totalAmount  – pre-fee charge
//   breakdown    – per-slot detail for receipts / debugging
// ─────────────────────────────────────────────────────────────────────────────

export interface ISlotBreakdown {
  label:       string;
  fromTime:    string;
  toTime:      string;
  price:       number;
  repetitions: number;  // how many times this slot was charged
  charged:     number;  // price × repetitions
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
  const lastSlot = sorted[sorted.length - 1];

  const lastFromMins = toMins(lastSlot.fromTime);
  const lastToMins   = toMins(lastSlot.toTime, true);
  const slotDurMins  = lastToMins - lastFromMins; // duration of last slot in minutes

  // Track charged slots by _id string for accumulation across days
  const chargeMap = new Map<string, ISlotBreakdown>();

  // Helper: record a charge for a slot
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

  // ── Walk through time, one slot-window at a time ──────────────────────────
  //
  // Strategy: maintain a cursor starting at bookingFrom.
  // At each step, find which slot the cursor falls into (or synthesise a
  // virtual repeat of the last slot if we're past all defined slots).
  // Advance the cursor to the end of that slot window.
  // Charge the flat fee once per slot window entered.
  //
  // "00:00" as toTime is treated as 1440 min (end of the calendar day).
  // All arithmetic is in wall-clock minutes anchored to the cursor's date.

  let cursor = new Date(bookingFrom);

  // Safety valve: max iterations = slots × days + extra repeats
  const maxDays = Math.ceil(
    (bookingTo.getTime() - bookingFrom.getTime()) / 86_400_000
  ) + 2;
  const maxIter = (sorted.length + 10) * (maxDays + 1);
  let iter = 0;

  while (cursor < bookingTo && iter++ < maxIter) {
    // Anchor this iteration to the calendar day the cursor is on
    const dayAnchor = new Date(cursor);
    dayAnchor.setHours(0, 0, 0, 0);

    const cursorMins = dateMins(cursor);

    // Find which defined slot the cursor currently falls into
    const matchedSlot = sorted.find((s) => {
      const sf = toMins(s.fromTime);
      const st = toMins(s.toTime, true);
      return cursorMins >= sf && cursorMins < st;
    });

    if (matchedSlot) {
      // ── Inside a defined slot ─────────────────────────────────────────────
      const slotEnd   = toMins(matchedSlot.toTime, true); // mins since midnight
      const windowEnd = new Date(dayAnchor.getTime() + slotEnd * 60_000);

      // Charge only if booking actually overlaps this window
      if (cursor < bookingTo && cursor < windowEnd) {
        charge(matchedSlot);
      }

      // Advance cursor to the end of this slot (or bookingTo, whichever first)
      cursor = windowEnd > bookingTo ? bookingTo : windowEnd;

    } else {
      // ── Cursor is in a gap between defined slots (or before first / after last)
      //    Find the next slot that starts after the cursor today.
      const nextSlot = sorted.find((s) => toMins(s.fromTime) > cursorMins);

      if (nextSlot) {
        // Jump cursor forward to the start of the next slot
        const nextStart = new Date(dayAnchor.getTime() + toMins(nextSlot.fromTime) * 60_000);
        cursor = nextStart > bookingTo ? bookingTo : nextStart;

      } else {
        // ── Cursor is past all defined slots for today ───────────────────────
        // The LAST slot repeats with the same duration for every overflow window.
        //
        // FIX: the original code always computed lastSlotEndOnThisDay from
        // dayAnchor (midnight of the cursor's *current* calendar day). After
        // crossing midnight, dayAnchor jumps forward 24 h, making overflowMs
        // negative → repeatIndex always 0 → cursor never advances → infinite loop.
        //
        // Correct approach: find the most recent "last slot end" boundary that
        // is at or before the cursor, regardless of which calendar day it falls on.

        // End of the last defined slot on the cursor's current calendar day
        const lastSlotEndToday = new Date(
          dayAnchor.getTime() + lastToMins * 60_000
        );

        // If the cursor is before that boundary, the slot actually ended on the
        // previous calendar day — step back one day.
        const referenceEnd =
          cursor >= lastSlotEndToday
            ? lastSlotEndToday
            : new Date(lastSlotEndToday.getTime() - 86_400_000);

        // How many minutes has the cursor gone past the reference end?
        const overflowMins = (cursor.getTime() - referenceEnd.getTime()) / 60_000;

        // Which repeat window (0-based) does the cursor fall into?
        const repeatIndex = Math.floor(overflowMins / slotDurMins);

        // End of the current repeat window
        const windowEnd = new Date(
          referenceEnd.getTime() + (repeatIndex + 1) * slotDurMins * 60_000
        );

        if (cursor < bookingTo) {
          charge(lastSlot);
        }

        cursor = windowEnd > bookingTo ? bookingTo : windowEnd;
      }
    }
  }

  const totalAmount = [...chargeMap.values()].reduce((s, e) => s + e.charged, 0);

  return {
    totalAmount,
    breakdown: [...chargeMap.values()],
  };
}