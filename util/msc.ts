import { EventLog } from "ethers";

export const getEvent = async (result: any, event: string) => {
    const receipt = await result.wait()
    console.log(result)
}