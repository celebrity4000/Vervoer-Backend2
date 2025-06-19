import mongoose from "mongoose";
const URI = process.env.MONGODB_URI

export function connectDB(){
    if(!URI) throw Error("NO MONGODB URI") ;
    mongoose.connect(URI).then(()=>{
        console.log("Connected Database") ;
    })
}