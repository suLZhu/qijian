import type {MemoryLifecycle,MemoryRecord} from './memoryGovernance'
export function fetchAllMemoryRecords(person:string,lifecycle?:MemoryLifecycle,fetchApi?:typeof fetch):Promise<MemoryRecord[]>
