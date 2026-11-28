export function executeBackupRestore(input: {storage:Storage; local:Record<string,string>; applyIndexed:()=>Promise<()=>Promise<void>>; syncServer:()=>Promise<void>; markPending:boolean}):Promise<void>

export function needsRestoredSnapshotSync(local:Record<string,string>,kind:string,localMode:boolean,crossMode:boolean):boolean
