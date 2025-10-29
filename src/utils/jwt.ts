import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.ACCESS_SECRET_TOKEN || "fjdjkfhsfsaf";

export function jwtEncode(
  data: object | string,
  options?: jwt.SignOptions
) {
  const defaultExpiry = process.env.ACCESS_TOKEN_EXPIRY || "1d";

  console.log("JWT Encode - Using expiry:", options?.expiresIn || defaultExpiry); 

  return jwt.sign(data, JWT_SECRET, {
    expiresIn: defaultExpiry,
    ...options,
  } as jwt.SignOptions);
}

export function jwtDecode(token: string) {
  return jwt.verify(token, JWT_SECRET) as object | string;
}