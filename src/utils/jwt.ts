import jwt from "jsonwebtoken" ;

const JWT_SECRET = process.env.JWT_SECRET || "fjdjkfhsfsaf" ;

export function jwtEncode(data : object|string , options: jwt.SignOptions = {expiresIn : "30D"}){
    return jwt.sign(data, JWT_SECRET, options)
}

export function jwtDecode(token : string){
    return jwt.verify(token, JWT_SECRET) as object | string ;
}