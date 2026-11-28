export function backupStorageMode(payload:any,kind:string):''|'local'|'server'
export function prepareBackupStorage(payload:any,kind:string,local:Record<string,string>,targetLocal:boolean):{local:Record<string,string>;server:any;crossMode:boolean}
