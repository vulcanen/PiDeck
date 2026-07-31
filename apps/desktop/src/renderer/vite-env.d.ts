import type { PideckBridge } from "@pideck/contracts";

declare module "./styles.css" {
  const styles: string;
  export default styles;
}

declare global {
  interface Window {
    pideck: PideckBridge;
  }
}

export {};
