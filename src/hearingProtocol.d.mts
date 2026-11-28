import type { Vendor } from './vendors.mjs'
export function recognizeAudio(options: { vendor:Vendor; config:{model:string;path:string;mode:'transcribe'|'understand'}; file:File; signal?:AbortSignal; onAttempt?:()=>void; fetchImpl?:typeof fetch }): Promise<{text:string;usage:any;status:number}>
