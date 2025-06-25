import { Router } from "express";
import { registerUser,verifyOtp } from "../controllers/User.js";  
import { asyncHandler } from "../utils/asynchandler.js";
import { registerDryCleaner } from "../controllers/merchant.drycleaner.controller.js";

import { imageUploadFields } from "../middleware/upload.middleware.js";

const router = Router();

// User routes
router.post("/register", asyncHandler(registerUser));
router.post("/verify-otp", asyncHandler(verifyOtp));

// Dry cleaner registration route with image upload middleware
router.post(
  "/dry-cleaner",
  imageUploadFields,              
  registerDryCleaner
);

// Nested merchant routes

export default router;
