// Type surface for resize.mjs (the fit → single resize-emit helper).
export interface ResizeMessage {
  type: "resize";
  cols: number;
  rows: number;
}

export declare function resizeMessage(cols: number, rows: number): ResizeMessage;
export declare function resizeFrame(cols: number, rows: number): string;
export declare function emitFit(
  cols: number,
  rows: number,
  send: (frame: string) => void,
  last?: ResizeMessage | null
): { sent: boolean; message: ResizeMessage };
