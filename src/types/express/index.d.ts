// import { IUser } from "../../models/normalUser.model";
// import { IDriver } from "../../models/driver.model";
// import { IMerchant } from "../../models/merchant.model";

// declare global {
//   namespace Express {
//     interface Request {
//       authUser?: {
//         user: IUser | IDriver | IMerchant;
//         userType: "user" | "driver" | "merchant";
//       };
//     }
//   }
// }
import { JwtPayload } from "jsonwebtoken";

declare global {
  namespace Express {
    interface Request {
      user?: string | JwtPayload;
    }
  }
}
