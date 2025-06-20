export const generateOTP = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

export const getOtpExpiry = (): Date => {
  return new Date(Date.now() + 5 * 60 * 1000);
};
/**
 * 
 * @param startDate 
 * @param stopDate 
 * @param diff in Days
 */
export function getAllDate(startDate:Date , stopDate:Date , diff = 1){
  let r : Date[] = [] ;
  for(let date = startDate ; date <= stopDate ; ){
    r.push(date) ;
    date = new Date(date);
    date.setDate(date.getDate()+ diff) ;
  }
  return r ;
}
