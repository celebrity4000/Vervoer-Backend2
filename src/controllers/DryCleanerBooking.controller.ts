import { Request, Response } from "express";
import { asyncHandler } from "../utils/asynchandler.js";
import { ApiResponse } from "../utils/apirespone.js";
import { DryCleaner } from "../models/merchant.model.js";
import { DryCleanerOrder } from "../models/DryCleanerOrder.model.js";
import { z } from "zod";

const placeOrderSchema = z.object({
  dryCleanerId: z.string().min(1, "DryCleaner ID required"),
  items: z.array(
    z.object({
      serviceId: z.string().min(1, "Service ID required"),
      quantity: z.number().int().positive("Quantity must be > 0"),
    })
  ).nonempty("At least one service must be ordered"),
});

export const PlaceDryCleanerOrder = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    // Validate input
    const parsedData = placeOrderSchema.parse(req.body);
    const { dryCleanerId, items } = parsedData;
    const userId = (req as any).user._id; // set in auth middleware

    // Fetch drycleaner services
    const dryCleaner = await DryCleaner.findById(dryCleanerId).lean();
    if (!dryCleaner) {
      res
        .status(404)
        .json(new ApiResponse(404, null, "DryCleaner not found"));
      return;
    }

    let totalAmount = 0;
    const orderItems = items.map((it) => {
      const service = dryCleaner.services.find(
        (s: any) => s._id.toString() === it.serviceId
      );
      if (!service) {
        throw new Error(`Service with ID ${it.serviceId} not found`);
      }

      const unitPrice = service.price ?? 0;
      const totalPrice = unitPrice * it.quantity;
      totalAmount += totalPrice;

      return {
        service: service._id,
        name: service.name,
        quantity: it.quantity,
        unitPrice,
        totalPrice,
      };
    });

    const order = await DryCleanerOrder.create({
      user: userId,
      dryCleaner: dryCleaner._id,
      items: orderItems,
      totalAmount,
    });

    res
      .status(201)
      .json(new ApiResponse(201, order, "Order placed successfully"));
  }
);
