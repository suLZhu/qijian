export function observeAuxiliaryRequest(input: {
  storage: Storage
  person: string
  trigger: string
  body: {messages:{role:string;content:string}[]}
  request: () => Promise<Response>
  identify: (response:Response) => {model:string;vendorId:string;vendor:string;subscription:boolean;known?:boolean}
}): Promise<Response>
