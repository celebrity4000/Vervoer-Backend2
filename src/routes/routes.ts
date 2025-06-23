import { Router } from "express";
import multer from "multer";
const router = Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(), // Store files in memory for Cloudinary upload
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit per file
    files: 11, // Max 11 files (10 images + 1 PDF)
  },
});
import { registerUser,verifyOtp } from "../controllers/User.js";  
import {validateRequest} from "../middleware/validateRequest.js";
import { registerUserSchema } from "../validators/userValidators.js";
import { asyncHandler } from "../utils/asynchandler.js";
import merchantRoute from  "./merchant.routes.js"
import { registerDryCleaner } from "../controllers/merchant.drycleaner.controller.js";



router.post("/register", asyncHandler(registerUser));
router.post("/verify-otp", asyncHandler(verifyOtp));
router.post("/dry-cleaner", registerDryCleaner);

router.use("/merchant", merchantRoute) ;
export default router;
