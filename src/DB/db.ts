import mongoose from "mongoose";
import dotenv from "dotenv" ;
dotenv.config({
    path:".env" 
})
const URI = process.env.MONGODB_URI
export async function connectDB(){
    if(!URI) throw new Error("NO MONGODB URI") ;
    await mongoose.connect(URI).then(()=>{
        console.log("Connected Database") ;
    })
}