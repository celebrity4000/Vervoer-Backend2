import {z} from "zod/v4"

const ParkingData = z.object({
    parkingName? : z.string() ,
    address?    : z.string() ,
    price? : z.number(),
    about? : z.string().optional() ,
    availableSpace? : z.object({[key : z.string()]: z.number() })
})