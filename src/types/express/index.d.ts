import { IUser } from "../../models/user.model";
import { IDriver } from "../../models/driver.model";
import { IMerchant } from "../../models/merchant.model";

declare global {
  namespace Express {
    interface Request {
      authUser?: {
        user: IUser | IDriver | IMerchant;
        userType: "user" | "driver" | "merchant";
      };
    }
  }
}
