import { Router } from "express";
import { registerUser, verifyOtp,socialRegister, loginUser} from "../controllers/User.js";  
import { asyncHandler } from "../utils/asynchandler.js";
import { registerDryCleaner, updateDryCleanerProfile,editDryCleanerAddress,editDryCleanerService,editDryCleanerHours,updateDryCleanerShopImages,deleteDryCleanerShopImage,getAllDryCleaners , placeOrderToDryCleaner} from "../controllers/merchant.drycleaner.controller.js";
import { createBooking ,bookDriverForDelivery,cancelDriverBooking} from "../controllers/driverBooking.controller.js";
import { imageUploadFields } from "../middleware/upload.middleware.js";
import { authenticate } from "../middleware/auth.middleware.js";
import {registerDriver,} from "../controllers/driver.controller.js";
const router = Router();

// User routes
router.post("/register", asyncHandler(registerUser));
router.post("/verify-otp", asyncHandler(verifyOtp));
router.post("/login", loginUser);
// Dry cleaner registration route with image upload middleware
router.post(
  "/dry-cleaner",  
  authenticate,
  imageUploadFields, 
  registerDryCleaner
);

router.put(
  "/edit-profile-drycleaner/:id", 
  authenticate,
  imageUploadFields, 
  updateDryCleanerProfile
);
router.put("/edit-address-drycleaner/:id", authenticate, editDryCleanerAddress);
router.put("/edit-service-drycleaner/:dryCleanerId", authenticate, editDryCleanerService);
router.put("/edit-hours-drycleaner/:dryCleanerId", authenticate, editDryCleanerHours);
router.put(
  "/update-drycleaner-shop-images/:id",
  authenticate,
  imageUploadFields,
  updateDryCleanerShopImages
);
router.delete(
  "/delete-drycleaner-shop-image/:id",
  authenticate,
  deleteDryCleanerShopImage
);
router.get("/dry-cleaner", authenticate, getAllDryCleaners);
router.post("/place-order/:dryCleanerId", authenticate, placeOrderToDryCleaner);

// Driver registration route
router.post("/register-driver", imageUploadFields, registerDriver);
// user booking route
router.post("/create-booking", authenticate, createBooking);
router.post("/book-driver-for-delivery", authenticate, bookDriverForDelivery);
router.delete("/cancel-driver-booking/:id", authenticate, cancelDriverBooking);

router.post("/social-register", socialRegister);


export default router;
