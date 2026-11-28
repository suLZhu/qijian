import type {MemoryLifecycle,MemoryRecord} from './memoryGovernance'
export function fetchAllMemoryRecords(person:string,lifecycle?:MemoryLifecycle,fetchApi?:typeof fetch, options?:{includeEmbedding?:boolean}):Promise<MemoryRecord[]>
export function fetchMemoryRecordsWithin(person:string,lifecycle?:MemoryLifecycle,options?:{signal?:AbortSignal;timeoutMs?:number;fetchApi?:typeof fetch;includeEmbedding?:boolean}):Promise<MemoryRecord[]>
export function rankMemoryRecords<T extends {title:string;content:string;keywords?:string;embedding?:number[];embedModel?:string}>(records:T[],query:string,queryVector:unknown,cosine:(a:unknown,b:unknown)=>number,queryModel?:string):Array<{record:T;score:number}>
