import { IUser } from "../../models/user.model";
import { IDriver } from "../../models/driver.model";
import { IMerchant } from "../../models/merchant.model";

// Define a custom decoded token type (you can adjust this as needed)
interface JwtPayload {
  id: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

// Extend Express types
declare global {
  namespace Express {
    interface Request {
      authUser?: {
        user: IUser | IDriver | IMerchant;
        userType: "user" | "driver" | "merchant";
      };
      user?: JwtPayload;
    }
  }
}

export {};
